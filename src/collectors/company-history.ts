import { db } from "@/lib/db"
import {
  exclusionFor,
  SH01_SOURCE,
  type CompanyFilings,
  type HistoricAllotment,
  type Officer,
  type Psc,
  type RoundPaperwork,
} from "@/lib/leads"

import { eachRequest, pacedGet, REST_SPACING_MS, restKeyError } from "./companies-house"
import {
  ALLOTMENT_PARSER_VERSION,
  documentUrl,
  downloadDocument,
  readAllotmentOrUnparsed,
  requestDocument,
} from "./share-allotment-documents"
import type { CollectorContext } from "./types"

/*
 * Who runs each lead's company and whether its round is its first, from three
 * Companies House REST endpoints per company:
 *   - officers: the current directors and LLP members, with role,
 *     appointment date and occupation
 *   - persons with significant control: who owns or controls the company
 *   - filing history (capital, resolution and incorporation filings): every
 *     earlier share allotment, plus the new articles, share classes and
 *     allotment authorities that come with a priced round
 * Then each earlier allotment's SH01 document is read for the cash it raised,
 * with the same parser as the signals' own documents. src/lib/leads.ts turns
 * all this into the first-round flag and the decision makers on the Leads page.
 *
 * Only companies the lead rules do not exclude are fetched. A company is
 * fetched again when it gets a new signal, since its history has then changed.
 * Dates of birth and addresses are left out: they are not needed to reach anyone.
 *
 * Docs: https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference
 */

// Bump when what is stored changes, so companies are fetched again.
const HISTORY_VERSION = 1

// Earlier allotments whose documents are read, per company, newest first. A
// company with more than this is rarely raising for the first time, and its
// flag says "unknown" rather than guess.
const MAX_ALLOTMENT_DOCUMENTS = 12

const REQUESTS_PER_COMPANY = 3

type Listing<T> = { items?: T[]; total_count?: number }

type OfficerItem = {
  name?: string
  officer_role?: string
  appointed_on?: string
  resigned_on?: string
  occupation?: string
  links?: { officer?: { appointments?: string } }
}

type PscItem = {
  name?: string
  kind?: string
  name_elements?: { forename?: string; surname?: string }
  natures_of_control?: string[]
  notified_on?: string
  ceased_on?: string
  ceased?: boolean
}

type FilingItem = {
  date?: string
  description?: string
  description_values?: { date?: string }
  transaction_id?: string
  paper_filed?: boolean
  links?: { document_metadata?: string }
  resolutions?: { description?: string }[]
  associated_filings?: { description?: string }[]
}

// Filing descriptions (from Companies House's filing_history_descriptions
// enumeration) that usually accompany a priced round. A resolution filing
// lists its resolutions separately, so those are checked too.
const PAPERWORK: [RoundPaperwork["kind"], RegExp][] = [
  ["articles", /^(resolution-(adopt|alteration)-(memorandum-and-)?articles|resolution-memorandum(-and-articles)?|memorandum-articles)$/],
  ["share-classes", /^capital-(name-of-class-of-shares|variation-of-(rights-attached-to-shares|class-rights)|alter-shares-.*subdivision)/],
  ["allotment-authority", /^((ordinary|special|written|extraordinary)-)?resolution-(securities|removal-pre-emption)$/],
]

export function toOfficers(items: OfficerItem[]): Officer[] {
  return items
    .filter((item) => item.name && !item.resigned_on)
    .map((item) => ({
      name: item.name!,
      role: item.officer_role ?? "unknown",
      appointedOn: item.appointed_on ?? null,
      occupation: item.occupation ?? null,
      officerId: /\/officers\/([^/]+)\//.exec(item.links?.officer?.appointments ?? "")?.[1] ?? null,
    }))
}

export function toPscs(items: PscItem[]): Psc[] {
  return items
    .filter((item) => item.name && !item.ceased_on && !item.ceased)
    .map((item) => ({
      name: item.name!,
      kind: item.kind ?? "unknown",
      forename: item.name_elements?.forename ?? null,
      surname: item.name_elements?.surname ?? null,
      naturesOfControl: item.natures_of_control ?? [],
      notifiedOn: item.notified_on ?? null,
    }))
}

/**
 * The allotments and round paperwork in a filing history. Documents already
 * read for the previous copy are kept; a paper filing is a scan with no text,
 * so it is marked as such without downloading it.
 */
export function toFilings(listing: Listing<FilingItem>, signalTransactions: Set<string>, previous: CompanyFilings | null): CompanyFilings {
  const items = listing.items ?? []
  const previousReads = new Map(
    (previous?.allotments ?? []).flatMap((allotment) => (allotment.read ? [[allotment.transactionId, allotment.read]] : [])),
  )
  const allotments: HistoricAllotment[] = []
  const paperwork: RoundPaperwork[] = []

  for (const item of items) {
    if (!item.date) continue
    if (item.description === "capital-allotment-shares" && item.transaction_id) {
      const read =
        previousReads.get(item.transaction_id) ??
        (item.paper_filed ? { status: "no-text", version: ALLOTMENT_PARSER_VERSION } : undefined)
      allotments.push({
        transactionId: item.transaction_id,
        filedOn: item.date,
        allottedOn: item.description_values?.date ?? null,
        documentUrl: item.links?.document_metadata ?? null,
        isSignal: signalTransactions.has(item.transaction_id),
        ...(read && { read }),
      })
    }
    const descriptions = [
      item.description,
      ...(item.resolutions ?? []).map((resolution) => resolution.description),
      ...(item.associated_filings ?? []).map((filing) => filing.description),
    ]
    for (const [kind, pattern] of PAPERWORK) {
      if (descriptions.some((description) => description && pattern.test(description))) {
        paperwork.push({ filedOn: item.date, kind })
      }
    }
  }

  allotments.sort((a, b) => b.filedOn.localeCompare(a.filedOn))
  return { allotments, paperwork, truncated: (listing.total_count ?? items.length) > items.length }
}

/** One listing, or why it could not be had. Having none of something is a 404, not an empty list. */
async function getListing(
  get: ReturnType<typeof pacedGet>,
  key: string,
  path: string,
): Promise<{ data: Listing<unknown> } | "rate-limited" | { retry: string }> {
  const response = await get(path)
  if (response.status === 401) throw restKeyError(key)
  if (response.ok) return { data: (await response.json()) as Listing<unknown> }
  await response.body?.cancel()
  if (response.status === 429) return "rate-limited"
  if (response.status === 404) return { data: {} }
  return { retry: `HTTP ${response.status} for ${path.split("?")[0]}` }
}

type PendingCompany = {
  company_number: string
  company_status: string | null
  company_type: string | null
  date_of_creation: Date | null
  sic_codes: string[] | null
  accounts_type: string | null
  filings: CompanyFilings | null
  signal_transactions: string[]
}

/**
 * Fetches officers, PSCs and filing history for this source's companies that
 * have none yet or have had a new signal since, newest first, then reads the
 * earlier allotments' documents, until the time runs out.
 */
export async function enrichCompanyHistory(ctx: CollectorContext, key: string, deadline: number) {
  const sql = db()
  // Signals from the last year: the longest window the Leads page shows.
  const pending = (await sql.query(
    `SELECT c.company_number, c.status AS company_status, c.type AS company_type, c.date_of_creation, c.sic_codes,
            c.accounts_type, c.filings,
            coalesce(array_agg(s.data->>'transactionId') FILTER (WHERE s.source_id = $2), '{}') AS signal_transactions
       FROM companies c JOIN signals s ON s.company_number = c.company_number
      WHERE c.found
        AND c.company_number IN (SELECT company_number FROM signals
                                  WHERE source_id = $1 AND first_seen_at > now() - interval '365 days')
      GROUP BY c.company_number
     HAVING c.history_fetched_at IS NULL OR c.history_version < $3 OR max(s.first_seen_at) > c.history_fetched_at
      ORDER BY max(s.first_seen_at) DESC
      LIMIT 1000`,
    [ctx.sourceId, SH01_SOURCE, HISTORY_VERSION],
  )) as PendingCompany[]

  const get = pacedGet(key)
  let fetched = 0
  let excluded = 0
  let done = 0
  let stopReason = pending.length === 0 ? "nothing to do" : "all done"

  for (const company of pending) {
    // Excluded leads are hidden, so nothing more is fetched for them. Marking
    // them as fetched keeps them off the next run's list until a new signal.
    if (exclusionFor(company)) {
      await sql.query("UPDATE companies SET history_version = $2, history_fetched_at = now() WHERE company_number = $1", [
        company.company_number,
        HISTORY_VERSION,
      ])
      excluded++
      done++
      continue
    }
    if (Date.now() + REQUESTS_PER_COMPANY * REST_SPACING_MS > deadline) {
      stopReason = "time budget used up"
      break
    }

    const number = encodeURIComponent(company.company_number)
    const paths = [
      `/company/${number}/officers?items_per_page=100`,
      `/company/${number}/persons-with-significant-control?items_per_page=100`,
      `/company/${number}/filing-history?category=capital,resolution,incorporation&items_per_page=100`,
    ]
    const listings: Listing<unknown>[] = []
    let failure: Exclude<Awaited<ReturnType<typeof getListing>>, { data: unknown }> | undefined
    for (const path of paths) {
      const result = await getListing(get, key, path)
      if (result !== "rate-limited" && "data" in result) listings.push(result.data)
      else {
        failure = result
        break
      }
    }
    if (failure === "rate-limited") {
      stopReason = "rate limited (HTTP 429)"
      break
    }
    done++
    if (failure) {
      ctx.log(`Company ${company.company_number}: ${failure.retry}, will retry next run.`)
      continue
    }

    const [officers, pscs, filings] = listings as [Listing<OfficerItem>, Listing<PscItem>, Listing<FilingItem>]
    await sql.query(
      `UPDATE companies
          SET officers = $2::jsonb, pscs = $3::jsonb, filings = $4::jsonb, history_version = $5, history_fetched_at = now()
        WHERE company_number = $1`,
      [
        company.company_number,
        JSON.stringify(toOfficers(officers.items ?? [])),
        JSON.stringify(toPscs(pscs.items ?? [])),
        JSON.stringify(toFilings(filings, new Set(company.signal_transactions), company.filings)),
        HISTORY_VERSION,
      ],
    )
    fetched++
  }

  const remaining = pending.length - done
  ctx.log(
    `Fetched people and filing history for ${fetched} companies (${excluded} excluded, ${remaining} left). Stopped: ${stopReason}.`,
  )
  const documents = await readEarlierAllotments(ctx, key, deadline)
  return { fetched, excluded, remaining, stopReason, documents }
}

type PendingDocument = { company_number: string; idx: number; transaction_id: string; document_url: string }

/** Reads the SH01 documents of allotments that are in a filing history but are not signals. */
async function readEarlierAllotments(ctx: CollectorContext, key: string, deadline: number) {
  const sql = db()
  const pending = (
    (await sql.query(
      `SELECT c.company_number, (a.ordinality - 1)::int AS idx, a.value->>'transactionId' AS transaction_id,
              a.value->>'documentUrl' AS document_url
         FROM companies c, jsonb_array_elements(c.filings->'allotments') WITH ORDINALITY AS a(value, ordinality)
        WHERE c.filings IS NOT NULL AND a.ordinality <= $1
          AND NOT (a.value->>'isSignal')::boolean AND a.value->>'documentUrl' IS NOT NULL
          AND (a.value->'read' IS NULL OR (a.value->'read'->>'version')::int < $2)
        ORDER BY c.history_fetched_at DESC, a.ordinality
        LIMIT 1000`,
      [MAX_ALLOTMENT_DOCUMENTS, ALLOTMENT_PARSER_VERSION],
    )) as PendingDocument[]
  ).filter((row) => documentUrl(row.document_url))

  // The index locates the allotment; the transaction id guards against the
  // history having been fetched again (and reordered) since.
  const save = (row: PendingDocument, read: NonNullable<HistoricAllotment["read"]>) =>
    sql.query(
      `UPDATE companies SET filings = jsonb_set(filings, ARRAY['allotments', $2, 'read'], $3::jsonb)
        WHERE company_number = $1 AND filings->'allotments'->($4::int)->>'transactionId' = $5`,
      [row.company_number, String(row.idx), JSON.stringify(read), row.idx, row.transaction_id],
    )

  let read = 0
  let unreadable = 0
  const { done, stopReason } = await eachRequest(
    pending,
    deadline,
    (row) => requestDocument(key, row.document_url),
    async (row, response) => {
      const label = `Earlier SH01 document for ${row.company_number}`
      const result = await downloadDocument(key, response)
      if (result !== "missing" && "retry" in result) {
        ctx.log(`${label}: ${result.retry}, will retry next run.`)
        return
      }
      const allotment =
        result === "missing"
          ? { status: "no-document" as const, version: ALLOTMENT_PARSER_VERSION }
          : await readAllotmentOrUnparsed(ctx, label, result.pdf)
      await save(row, {
        status: allotment.status,
        version: allotment.version,
        ...("raised" in allotment && allotment.raised && { raised: allotment.raised }),
        ...("uncertain" in allotment && allotment.uncertain && { uncertain: true }),
      })
      if (allotment.status === "read") read++
      else unreadable++
    },
  )

  const remaining = pending.length - done
  ctx.log(`Read ${read} earlier SH01 documents (${unreadable} unreadable, ${remaining} left). Stopped: ${stopReason}.`)
  return { read, unreadable, remaining, stopReason }
}
