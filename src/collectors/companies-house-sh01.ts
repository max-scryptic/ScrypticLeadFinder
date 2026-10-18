import { db } from "@/lib/db"

import { CollectorConfigError, type Collector, type CollectorContext, type SignalInput } from "./types"

/*
 * SH01 (return of allotment of shares) filings from Companies House.
 *
 * There is no REST endpoint to search filings across companies, so this reads
 * the filing history Streaming API, which emits every new filing. The stream
 * is resumable: each event has a timepoint, and reconnecting with the last one
 * replays whatever was missed (Companies House keeps a limited backlog and
 * answers 416 when the timepoint is too old).
 *
 * Each run has two phases inside its time budget:
 *   1. Stream: read events from the saved timepoint, keep the SH01s.
 *   2. Enrich: look up each new company once through the REST API (age, status,
 *      SIC codes), cached in the companies table.
 *
 * Docs: https://developer-specs.company-information.service.gov.uk/streaming-api/guides/overview
 */

const STREAM_URL = "https://stream.companieshouse.gov.uk/filings"
const REST_URL = "https://api.company-information.service.gov.uk"

// Share of the run's time budget spent reading the stream; the rest enriches.
const STREAM_SHARE = 0.6
// The REST API allows 600 requests per 5 minutes; stay just under it.
const REST_SPACING_MS = 550
const FLUSH_EVERY = 100

type FilingEvent = {
  resource_kind?: string
  resource_uri?: string
  resource_id?: string
  data?: {
    type?: string
    category?: string
    date?: string
    description?: string
    transaction_id?: string
    description_values?: {
      date?: string
      capital?: { currency?: string; figure?: string }[]
    }
    links?: { self?: string; document_metadata?: string }
  }
  event?: { type?: string; timepoint?: number; published_at?: string }
}

type CompanyProfile = {
  company_number: string
  company_name?: string
  company_status?: string
  type?: string
  date_of_creation?: string
  sic_codes?: string[]
  registered_office_address?: { locality?: string; postal_code?: string }
}

function basicAuth(key: string) {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`
}

/** Reads a key, dropping the whitespace and quotes a copy-paste into a dashboard tends to add. */
function readKey(name: string) {
  return (process.env[name] ?? "").trim().replace(/^["']+|["']+$/g, "").trim()
}

/** Length and shape only, so a run log can show what a key looks like without exposing it. */
function describeKey(key: string) {
  const uuid = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(key)
  return `${key.length} characters, ${uuid ? "key format looks right" : "not in the usual key format"}`
}

async function restStatus(key: string) {
  // Company 00000006 is a long-dissolved company that always exists, so any
  // valid key gets 200; an invalid one gets 401.
  const response = await fetch(`${REST_URL}/company/00000006`, {
    headers: { Authorization: basicAuth(key) },
    signal: AbortSignal.timeout(15_000),
  })
  await response.body?.cancel()
  return response.status
}

async function streamStatus(key: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(STREAM_URL, { headers: { Authorization: basicAuth(key) }, signal: controller.signal })
    return response.status
  } finally {
    clearTimeout(timer)
    // Close the connection straight away: the account is limited to two.
    controller.abort()
  }
}

/**
 * Works out why the stream rejected its key by trying each key against both
 * APIs, so the run log can say exactly what to change.
 */
async function diagnoseStreamKey(apiKey: string, streamKey: string) {
  const [streamKeyOnRest, apiKeyOnStream, apiKeyOnRest] = await Promise.all([
    restStatus(streamKey).catch(() => 0),
    streamStatus(apiKey).catch(() => 0),
    restStatus(apiKey).catch(() => 0),
  ])

  const facts = `Stream key: ${describeKey(streamKey)}. REST key: ${describeKey(apiKey)}, ${
    apiKeyOnRest === 200 ? "accepted by the REST API" : `REST API answered HTTP ${apiKeyOnRest}`
  }.`

  if (streamKey === apiKey) {
    return `Both variables hold the same key. Create a separate Streaming key in the Companies House developer hub and put it in COMPANIES_HOUSE_STREAM_KEY. ${facts}`
  }
  if (apiKeyOnStream === 200 && streamKeyOnRest === 200) {
    return `The two keys are swapped. Put the Streaming key in COMPANIES_HOUSE_STREAM_KEY and the REST key in COMPANIES_HOUSE_API_KEY. ${facts}`
  }
  if (streamKeyOnRest === 200) {
    return `COMPANIES_HOUSE_STREAM_KEY holds a REST key. Create a key of type "Streaming" in the developer hub and use that instead. ${facts}`
  }
  return `Companies House rejected the stream key (HTTP 401). Check it is a "Streaming" key from a Live application, pasted without quotes or spaces. ${facts}`
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const FILING_PATH = /\/company\/([A-Z0-9]+)\/filing-history\/([^/?]+)/i

export function toSignal(event: FilingEvent): SignalInput | null {
  const filing = event.data
  if (!filing || filing.type !== "SH01" || event.event?.type === "deleted") return null

  const path = event.resource_uri ?? filing.links?.self ?? ""
  const match = FILING_PATH.exec(path)
  if (!match) return null
  const [, companyNumber, filingId] = match
  const transactionId = filing.transaction_id ?? filingId

  const capital = filing.description_values?.capital ?? []
  const capitalText = capital
    .filter((line) => line.figure)
    .map((line) => `${line.currency ?? ""} ${line.figure}`.trim())
    .join(", ")
  const allotmentDate = filing.description_values?.date ?? null

  return {
    externalId: `${companyNumber}:${transactionId}`,
    companyNumber: companyNumber.toUpperCase(),
    title: "Share allotment (SH01)",
    summary: [
      allotmentDate ? `Shares allotted on ${allotmentDate}.` : "Shares allotted.",
      capitalText ? `Statement of capital after allotment: ${capitalText} (nominal value, not the amount raised).` : null,
    ]
      .filter(Boolean)
      .join(" "),
    occurredOn: filing.date ?? allotmentDate,
    url: `https://find-and-update.company-information.service.gov.uk/company/${companyNumber.toUpperCase()}/filing-history`,
    data: {
      transactionId,
      allotmentDate,
      capital,
      publishedAt: event.event?.published_at,
      timepoint: event.event?.timepoint,
      documentMetadata: filing.links?.document_metadata,
    },
  }
}

async function openStream(key: string, timepoint: number | undefined, signal: AbortSignal) {
  const url = new URL(STREAM_URL)
  if (timepoint !== undefined) url.searchParams.set("timepoint", String(timepoint))
  return fetch(url, { headers: { Authorization: basicAuth(key) }, signal })
}

/** Phase 1: read the stream until the deadline or until it goes quiet. */
async function readStream(ctx: CollectorContext, key: string, apiKey: string, deadline: number) {
  const state = await ctx.getState<{ timepoint: number }>()
  let timepoint = typeof state.timepoint === "number" ? state.timepoint : undefined
  const startTimepoint = timepoint

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()))

  let eventsRead = 0
  let matches: SignalInput[] = []
  let found = 0
  let inserted = 0
  let lastPublishedAt: string | undefined
  let stopReason = "time budget used up"
  let warning: string | undefined

  const flush = async () => {
    if (matches.length > 0) {
      const result = await ctx.saveSignals(matches)
      inserted += result.inserted
      matches = []
    }
    if (timepoint !== undefined) await ctx.setState({ timepoint })
  }

  try {
    let response = await openStream(key, timepoint, controller.signal)
    if (response.status === 416) {
      warning = "Saved stream position was too old, so filings in the gap were missed. Restarted from now."
      ctx.log(warning)
      await response.body?.cancel()
      timepoint = undefined
      response = await openStream(key, undefined, controller.signal)
    }
    if (response.status === 401) {
      await response.body?.cancel()
      throw new CollectorConfigError(await diagnoseStreamKey(apiKey, key))
    }
    if (response.status === 429) {
      await response.body?.cancel()
      return { eventsRead, found, inserted, startTimepoint, timepoint, stopReason: "rate limited (HTTP 429)", warning }
    }
    if (!response.ok || !response.body) {
      throw new Error(`Companies House stream returned HTTP ${response.status}.`)
    }

    ctx.log(timepoint === undefined ? "Connected to the stream from now." : `Connected to the stream from timepoint ${timepoint}.`)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    reading: while (true) {
      const { done, value } = await reader.read()
      if (done) {
        stopReason = "stream closed by Companies House"
        break
      }
      buffer += decoder.decode(value, { stream: true })

      let newline: number
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)

        // A blank line is a heartbeat: the backlog is drained and nothing new has arrived.
        if (!line) {
          stopReason = "caught up with the stream"
          break reading
        }

        let event: FilingEvent
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        eventsRead++
        if (typeof event.event?.timepoint === "number") timepoint = event.event.timepoint
        lastPublishedAt = event.event?.published_at ?? lastPublishedAt

        const signal = toSignal(event)
        if (signal) {
          matches.push(signal)
          found++
        }
        if (matches.length >= FLUSH_EVERY) await flush()
      }
    }
    await reader.cancel().catch(() => {})
  } catch (error) {
    // The deadline aborting the request is the normal way a busy stream ends.
    if (!(error instanceof Error && error.name === "AbortError")) throw error
  } finally {
    clearTimeout(timer)
    await flush()
  }

  ctx.log(`Read ${eventsRead} filings, ${found} SH01 (${inserted} new). Stopped: ${stopReason}. Last published ${lastPublishedAt ?? "n/a"}.`)
  return { eventsRead, found, inserted, startTimepoint, timepoint, stopReason, warning, lastPublishedAt }
}

/** Phase 2: fetch profiles for companies not yet in the cache. */
async function enrichCompanies(ctx: CollectorContext, key: string, deadline: number) {
  const sql = db()
  const pending = (await sql.query(
    `SELECT DISTINCT s.company_number
       FROM signals s LEFT JOIN companies c ON c.company_number = s.company_number
      WHERE s.source_id = $1 AND s.company_number IS NOT NULL AND c.company_number IS NULL
      LIMIT 2000`,
    [ctx.sourceId],
  )) as { company_number: string }[]

  let fetched = 0
  let notFound = 0
  let stopReason = pending.length === 0 ? "nothing to enrich" : "all companies enriched"

  for (const { company_number: number } of pending) {
    if (Date.now() + REST_SPACING_MS > deadline) {
      stopReason = "time budget used up"
      break
    }
    const started = Date.now()
    const response = await fetch(`${REST_URL}/company/${encodeURIComponent(number)}`, {
      headers: { Authorization: basicAuth(key) },
      signal: AbortSignal.timeout(15_000),
    })

    if (response.status === 429) {
      stopReason = "rate limited (HTTP 429)"
      break
    }
    if (response.status === 401) {
      throw new CollectorConfigError(
        `Companies House rejected the REST API key (HTTP 401). Check COMPANIES_HOUSE_API_KEY is a "REST" key from a Live application. Key: ${describeKey(key)}.`,
      )
    }
    if (response.status === 404) {
      await sql.query(
        "INSERT INTO companies (company_number, found) VALUES ($1, false) ON CONFLICT (company_number) DO NOTHING",
        [number],
      )
      notFound++
    } else if (response.ok) {
      const profile = (await response.json()) as CompanyProfile
      await sql.query(
        `INSERT INTO companies (company_number, name, status, type, date_of_creation, sic_codes, locality, postcode, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (company_number) DO UPDATE SET
           name = EXCLUDED.name, status = EXCLUDED.status, type = EXCLUDED.type,
           date_of_creation = EXCLUDED.date_of_creation, sic_codes = EXCLUDED.sic_codes,
           locality = EXCLUDED.locality, postcode = EXCLUDED.postcode, found = true, fetched_at = now()`,
        [
          number,
          profile.company_name ?? null,
          profile.company_status ?? null,
          profile.type ?? null,
          profile.date_of_creation ?? null,
          profile.sic_codes ?? [],
          profile.registered_office_address?.locality ?? null,
          profile.registered_office_address?.postal_code ?? null,
        ],
      )
      fetched++
    } else {
      ctx.log(`Company ${number}: HTTP ${response.status}, will retry next run.`)
    }

    const wait = REST_SPACING_MS - (Date.now() - started)
    if (wait > 0) await sleep(wait)
  }

  await sql.query(
    `UPDATE signals s SET company_name = c.name
       FROM companies c
      WHERE c.company_number = s.company_number AND s.source_id = $1
        AND s.company_name IS NULL AND c.name IS NOT NULL`,
    [ctx.sourceId],
  )

  const remaining = pending.length - fetched - notFound
  ctx.log(`Enriched ${fetched} companies (${notFound} not found, ${remaining} left). Stopped: ${stopReason}.`)
  return { fetched, notFound, remaining, stopReason }
}

export const companiesHouseSh01Collector: Collector = {
  sourceId: "companies-house-sh01",
  requiredEnv: ["COMPANIES_HOUSE_STREAM_KEY", "COMPANIES_HOUSE_API_KEY"],
  async run(ctx) {
    const streamKey = readKey("COMPANIES_HOUSE_STREAM_KEY")
    const apiKey = readKey("COMPANIES_HOUSE_API_KEY")
    const budget = ctx.deadline - Date.now()

    const stream = await readStream(ctx, streamKey, apiKey, Date.now() + budget * STREAM_SHARE)
    const enrich = await enrichCompanies(ctx, apiKey, ctx.deadline)

    const parts = [
      `${stream.inserted} new SH01 from ${stream.eventsRead} filings`,
      `${enrich.fetched} companies looked up`,
    ]
    if (enrich.remaining > 0) parts.push(`${enrich.remaining} still to look up`)
    if (stream.warning) parts.push(stream.warning)

    return {
      itemsSeen: stream.found,
      itemsNew: stream.inserted,
      message: `${parts.join(", ")}.`,
      stats: { stream, enrich },
    }
  },
}
