import { db } from "@/lib/db"

import { CollectorConfigError, type CollectorContext } from "./types"

/*
 * Companies House REST API helpers shared by the collectors: looking up
 * company profiles (age, status, SIC codes, accounts type) into the companies
 * table, and matching company names from other sources to a company number.
 *
 * Docs: https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference
 */

export const REST_URL = "https://api.company-information.service.gov.uk"

// The REST API allows 600 requests per 5 minutes; stay just under it.
export const REST_SPACING_MS = 550

// Bump when enrichCompanies() starts storing a new profile field, so cached
// companies are fetched again to fill it in.
const PROFILE_VERSION = 2

// A name with no match is searched for again after this long, in case the
// company has since been registered or renamed.
const NO_MATCH_RETRY_DAYS = 30

type CompanyProfile = {
  company_number: string
  company_name?: string
  company_status?: string
  type?: string
  date_of_creation?: string
  sic_codes?: string[]
  registered_office_address?: { locality?: string; postal_code?: string }
  accounts?: { last_accounts?: { type?: string } }
}

type SearchItem = {
  company_number: string
  title?: string
  company_status?: string
}

export function basicAuth(key: string) {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`
}

/** Reads a key, dropping the whitespace and quotes a copy-paste into a dashboard tends to add. */
export function readKey(name: string) {
  return (process.env[name] ?? "").trim().replace(/^["']+|["']+$/g, "").trim()
}

/** Length and shape only, so a run log can show what a key looks like without exposing it. */
export function describeKey(key: string) {
  const uuid = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(key)
  return `${key.length} characters, ${uuid ? "key format looks right" : "not in the usual key format"}`
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function restKeyError(key: string) {
  return new CollectorConfigError(
    `Companies House rejected the REST API key (HTTP 401). Check COMPANIES_HOUSE_API_KEY is a "REST" key from a Live application. Key: ${describeKey(key)}.`,
  )
}

/**
 * Calls the REST API once per item, spaced to stay inside the rate limit,
 * until the items or the time run out. `handle` gets each response; returning
 * false stops early.
 */
export async function eachRequest<T>(
  items: T[],
  deadline: number,
  request: (item: T) => Promise<Response>,
  handle: (item: T, response: Response) => Promise<void>,
) {
  let done = 0
  let stopReason = items.length === 0 ? "nothing to do" : "all done"

  for (const item of items) {
    if (Date.now() + REST_SPACING_MS > deadline) {
      stopReason = "time budget used up"
      break
    }
    const started = Date.now()
    const response = await request(item)
    if (response.status === 429) {
      await response.body?.cancel()
      stopReason = "rate limited (HTTP 429)"
      break
    }
    await handle(item, response)
    done++

    const wait = REST_SPACING_MS - (Date.now() - started)
    if (wait > 0) await sleep(wait)
  }

  return { done, stopReason }
}

/**
 * A GET for work that makes several REST requests per item: each call waits
 * until REST_SPACING_MS has passed since the one before.
 */
export function pacedGet(key: string) {
  let last = 0
  return async (path: string) => {
    const wait = last + REST_SPACING_MS - Date.now()
    if (wait > 0) await sleep(wait)
    last = Date.now()
    return fetch(`${REST_URL}${path}`, { headers: { Authorization: basicAuth(key) }, signal: AbortSignal.timeout(15_000) })
  }
}

/**
 * Reduces a company name to the form Companies House would register it under,
 * so "Acme Ltd." from a grant record and "ACME LIMITED" from the register
 * compare equal.
 */
export function normalizeCompanyName(name: string) {
  return name
    .toUpperCase()
    .replace(/[&+]/g, " AND ")
    .replace(/[.,'’"()]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/^THE /, "")
    .replace(/ (LTD|CYFYNGEDIG|CYF)$/, " LIMITED")
    .replace(/ (PUBLIC LIMITED COMPANY|CWMNI CYHOEDDUS CYFYNGEDIG|CCC)$/, " PLC")
}

/** The search result registered under exactly this name, preferring an active company. */
export function pickNameMatch(name: string, items: SearchItem[]) {
  const target = normalizeCompanyName(name)
  const exact = items.filter((item) => item.title && normalizeCompanyName(item.title) === target)
  return exact.find((item) => item.company_status === "active") ?? exact[0] ?? null
}

/**
 * Finds the company number for signals that only carry a name, by searching
 * Companies House and accepting only an exact name match. Results, including
 * "no match", are cached in company_name_matches.
 */
export async function matchCompanyNames(ctx: CollectorContext, key: string, deadline: number) {
  const sql = db()
  const pending = (await sql.query(
    `SELECT DISTINCT s.company_name
       FROM signals s LEFT JOIN company_name_matches m ON m.name = s.company_name
      WHERE s.source_id = $1 AND s.company_number IS NULL AND s.company_name IS NOT NULL
        AND (m.name IS NULL
             OR (m.company_number IS NULL AND m.searched_at < now() - make_interval(days => $2)))
      LIMIT 1000`,
    [ctx.sourceId, NO_MATCH_RETRY_DAYS],
  )) as { company_name: string }[]

  let matched = 0
  const { done, stopReason } = await eachRequest(
    pending.map((row) => row.company_name),
    deadline,
    (name) => {
      const url = new URL(`${REST_URL}/search/companies`)
      url.searchParams.set("q", name.replace(/[\s,.;]+$/, ""))
      url.searchParams.set("items_per_page", "20")
      return fetch(url, { headers: { Authorization: basicAuth(key) }, signal: AbortSignal.timeout(15_000) })
    },
    async (name, response) => {
      if (response.status === 401) throw restKeyError(key)
      if (!response.ok) {
        await response.body?.cancel()
        ctx.log(`Search for "${name}": HTTP ${response.status}, will retry next run.`)
        return
      }
      const { items = [] } = (await response.json()) as { items?: SearchItem[] }
      const match = pickNameMatch(name, items)
      if (match) matched++
      await sql.query(
        `INSERT INTO company_name_matches (name, company_number, searched_at) VALUES ($1, $2, now())
         ON CONFLICT (name) DO UPDATE SET company_number = EXCLUDED.company_number, searched_at = now()`,
        [name, match?.company_number ?? null],
      )
    },
  )

  await sql.query(
    `UPDATE signals s SET company_number = m.company_number
       FROM company_name_matches m
      WHERE m.name = s.company_name AND m.company_number IS NOT NULL
        AND s.company_number IS NULL AND s.source_id = $1`,
    [ctx.sourceId],
  )
  // A lead triaged before its company was matched keeps its status under the new key.
  await sql.query(
    `UPDATE lead_status l SET lead_key = m.company_number
       FROM company_name_matches m
      WHERE l.lead_key = 'name:' || m.name AND m.company_number IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM lead_status x WHERE x.lead_key = m.company_number)`,
  )

  const remaining = pending.length - done
  ctx.log(`Searched ${done} company names, ${matched} matched (${remaining} left). Stopped: ${stopReason}.`)
  return { searched: done, matched, remaining, stopReason }
}

/** Fetches profiles for this source's companies that are not cached yet, or were cached by an older version. */
export async function enrichCompanies(ctx: CollectorContext, key: string, deadline: number) {
  const sql = db()
  const pending = (await sql.query(
    `SELECT DISTINCT s.company_number
       FROM signals s LEFT JOIN companies c ON c.company_number = s.company_number
      WHERE s.source_id = $1 AND s.company_number IS NOT NULL
        AND (c.company_number IS NULL OR (c.found AND c.profile_version < $2))
      LIMIT 2000`,
    [ctx.sourceId, PROFILE_VERSION],
  )) as { company_number: string }[]

  let fetched = 0
  let notFound = 0
  const { done, stopReason } = await eachRequest(
    pending.map((row) => row.company_number),
    deadline,
    (number) =>
      fetch(`${REST_URL}/company/${encodeURIComponent(number)}`, {
        headers: { Authorization: basicAuth(key) },
        signal: AbortSignal.timeout(15_000),
      }),
    async (number, response) => {
      if (response.status === 401) throw restKeyError(key)
      if (response.status === 404) {
        await response.body?.cancel()
        await sql.query(
          "INSERT INTO companies (company_number, found) VALUES ($1, false) ON CONFLICT (company_number) DO NOTHING",
          [number],
        )
        notFound++
      } else if (response.ok) {
        const profile = (await response.json()) as CompanyProfile
        await sql.query(
          `INSERT INTO companies (company_number, name, status, type, date_of_creation, sic_codes, locality, postcode,
                                  accounts_type, profile_version, fetched_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
           ON CONFLICT (company_number) DO UPDATE SET
             name = EXCLUDED.name, status = EXCLUDED.status, type = EXCLUDED.type,
             date_of_creation = EXCLUDED.date_of_creation, sic_codes = EXCLUDED.sic_codes,
             locality = EXCLUDED.locality, postcode = EXCLUDED.postcode, accounts_type = EXCLUDED.accounts_type,
             profile_version = EXCLUDED.profile_version, found = true, fetched_at = now()`,
          [
            number,
            profile.company_name ?? null,
            profile.company_status ?? null,
            profile.type ?? null,
            profile.date_of_creation ?? null,
            profile.sic_codes ?? [],
            profile.registered_office_address?.locality ?? null,
            profile.registered_office_address?.postal_code ?? null,
            profile.accounts?.last_accounts?.type ?? null,
            PROFILE_VERSION,
          ],
        )
        fetched++
      } else {
        await response.body?.cancel()
        ctx.log(`Company ${number}: HTTP ${response.status}, will retry next run.`)
      }
    },
  )

  await sql.query(
    `UPDATE signals s SET company_name = c.name
       FROM companies c
      WHERE c.company_number = s.company_number AND s.source_id = $1
        AND s.company_name IS NULL AND c.name IS NOT NULL`,
    [ctx.sourceId],
  )

  const remaining = pending.length - done
  ctx.log(`Enriched ${fetched} companies (${notFound} not found, ${remaining} left). Stopped: ${stopReason}.`)
  return { fetched, notFound, remaining, stopReason }
}
