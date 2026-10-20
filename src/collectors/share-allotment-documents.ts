import { extractText, getDocumentProxy } from "unpdf"

import { db } from "@/lib/db"

import { basicAuth, eachRequest, REST_URL, restKeyError } from "./companies-house"
import type { CollectorContext } from "./types"

/*
 * How much money a share allotment actually raised, read from the SH01
 * document itself. The filing event only carries the nominal statement of
 * capital, which says nothing about the price paid. The document lists each
 * batch of shares allotted with its number, the amount paid per share
 * (including premium) and whether it was paid in cash, so
 * cash raised = number allotted x amount paid, over the cash batches.
 *
 * Electronically filed SH01s (most of them) are generated PDFs with a text
 * layer. Paper filings are scans with no text and are marked "no-text": the
 * amount stays unknown rather than guessed.
 *
 * The result goes on the signal: `amount` and `currency` hold the cash raised,
 * and `data.allotment` holds the parsed batches and how the read went.
 *
 * Docs: https://developer-specs.company-information.service.gov.uk/document-api/reference
 */

const DOCUMENT_API = "https://document-api.company-information.service.gov.uk/document"

// Bump when parseAllotmentText() changes, so stored results are read again.
export const ALLOTMENT_PARSER_VERSION = 1

// A document not generated yet is looked for again after this long, for this many days.
const NO_DOCUMENT_RETRY_HOURS = 6
const NO_DOCUMENT_GIVE_UP_DAYS = 14

export type AllotmentBatch = {
  shareClass: string
  currency: string
  numberAllotted: number
  nominalValue: number
  amountPaidPerShare: number
  cash: boolean
  /** Cash raised by this batch (0 for a non-cash batch). */
  raised: number
  /**
   * Set when the filer seems to have typed the batch total into the
   * per-share field, so `raised` is that figure rather than number x figure.
   * "certain" or "likely", from the two tell-tale signs in parseAllotmentText().
   */
  totalEnteredAsPerShare?: "certain" | "likely"
}

export type AllotmentReadStatus = "read" | "no-text" | "unparsed" | "no-document"

export type Allotment = {
  status: AllotmentReadStatus
  version: number
  checkedAt: string
  batches?: AllotmentBatch[]
  /** Cash raised per currency, across all batches. */
  raised?: Record<string, number>
  /** True when a batch's amount was only likely entered as a total, so the true raise may be far larger. */
  uncertain?: boolean
}

// A per-share price that would make one batch raise more than this, and value
// the whole company above the second figure, is taken to be the batch total
// typed into the wrong box.
const MAX_PLAUSIBLE_BATCH_RAISE = 100_000_000
const MAX_PLAUSIBLE_COMPANY_VALUE = 1_000_000_000

const num = (text: string) => Number(text.replace(/,/g, ""))
const round2 = (value: number) => Math.round(value * 100) / 100

/** The allotted batches in an SH01's text, or null when the text is not an SH01 this can read. */
export function parseAllotmentText(text: string): AllotmentBatch[] | null {
  // The allotment comes first; "Statement of Capital" starts the company's
  // totals after the allotment, which must not be counted.
  const start = text.search(/Shares Allotted/i)
  if (start === -1) return null
  const end = text.indexOf("Statement of Capital", start)
  const section = text.slice(start, end === -1 ? undefined : end)

  // Shares in issue after the allotment, per currency, from the totals.
  const sharesInIssue: Record<string, number> = {}
  for (const [, currency, total] of text.matchAll(/Currency:\s*([A-Z]{3})\s+Total number of shares:\s*([\d,]+)/g)) {
    sharesInIssue[currency] = num(total)
  }

  const batches: AllotmentBatch[] = []
  for (const block of section.split(/Class of Shares:/i).slice(1)) {
    const currency = /Currency:\s*([A-Z]{3})/.exec(block)?.[1]
    const numberAllotted = /Number allotted\s+([\d,.]+)/i.exec(block)?.[1]
    const nominalValue = /Nominal value of each share\s+([\d,.]+)/i.exec(block)?.[1]
    const amountPaid = /Amount paid:\s*([\d,.]+)/i.exec(block)?.[1]
    if (!currency || !numberAllotted || !nominalValue || !amountPaid) return null

    const batch = {
      shareClass: block.slice(0, block.search(/Currency:/)).replace(/\s+/g, " ").trim(),
      currency,
      numberAllotted: num(numberAllotted),
      nominalValue: num(nominalValue),
      amountPaidPerShare: num(amountPaid),
      cash: !/Non-cash consideration/i.test(block),
    }
    if ([batch.numberAllotted, batch.nominalValue, batch.amountPaidPerShare].some(Number.isNaN)) return null

    // The "amount paid" box is per share, but some filers type the batch
    // total. Two signs give that away. Certain: the figure is exactly the
    // batch's aggregate nominal value (90 shares of £1 "paid 90"). Likely:
    // reading it per share gives an implausible raise and company value
    // (4,046 shares "paid 139,991.60" each would be £566m raised, valuing the
    // 120,909 shares in issue at £17bn). Both size tests are needed: big
    // listed companies do have a £1bn+ value, but issue small batches. It is
    // only "likely" because a few real rounds are that big (1.9m shares at
    // £64.36), so a lead never loses points over such an amount.
    const aggregateNominal = round2(batch.numberAllotted * batch.nominalValue)
    const raisedPerShareReading = batch.numberAllotted * batch.amountPaidPerShare
    const valuePerShareReading = batch.amountPaidPerShare * (sharesInIssue[currency] ?? 0)
    const totalEnteredAsPerShare =
      batch.numberAllotted <= 1
        ? undefined
        : batch.amountPaidPerShare === aggregateNominal
          ? ("certain" as const)
          : raisedPerShareReading > MAX_PLAUSIBLE_BATCH_RAISE && valuePerShareReading > MAX_PLAUSIBLE_COMPANY_VALUE
            ? ("likely" as const)
            : undefined
    const raised = !batch.cash ? 0 : totalEnteredAsPerShare ? batch.amountPaidPerShare : round2(raisedPerShareReading)
    batches.push({ ...batch, raised, ...(totalEnteredAsPerShare && { totalEnteredAsPerShare }) })
  }
  return batches.length > 0 ? batches : null
}

export function totalRaised(batches: AllotmentBatch[]) {
  const raised: Record<string, number> = {}
  for (const batch of batches) raised[batch.currency] = round2((raised[batch.currency] ?? 0) + batch.raised)
  return raised
}

/** Reads a PDF's text, or "" for a scan with no text layer. */
export async function pdfText(bytes: Uint8Array) {
  // verbosity 0: pdf.js otherwise warns on every slightly malformed scan.
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 })
  const { text } = await extractText(pdf, { mergePages: true })
  return text.trim()
}

/** The allotment read from a downloaded SH01, as stored on the signal. */
export async function readAllotment(bytes: Uint8Array): Promise<Allotment> {
  const text = await pdfText(bytes)
  const base = { version: ALLOTMENT_PARSER_VERSION, checkedAt: new Date().toISOString() }
  if (!text) return { ...base, status: "no-text" }
  const batches = parseAllotmentText(text)
  if (!batches) return { ...base, status: "unparsed" }
  const uncertain = batches.some((batch) => batch.cash && batch.totalEnteredAsPerShare === "likely")
  return { ...base, status: "read", batches, raised: totalRaised(batches), ...(uncertain && { uncertain }) }
}

/** The Document API metadata URL, whichever host the filing event linked it on. */
export function documentUrl(link: string) {
  const id = link.split("/document/")[1]
  return id ? `${DOCUMENT_API}/${id}` : null
}

/**
 * Asks for a filing's PDF. The content endpoint redirects to a signed download
 * URL, which must be fetched without the Companies House key, so the redirect
 * is followed by hand in downloadDocument().
 */
export function requestDocument(key: string, link: string) {
  return fetch(`${documentUrl(link)}/content`, {
    headers: { Authorization: basicAuth(key), Accept: "application/pdf" },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  })
}

/** The PDF behind a requestDocument() response, "missing" when there is none, or why to try again later. */
export async function downloadDocument(
  key: string,
  response: Response,
): Promise<{ pdf: Uint8Array } | "missing" | { retry: string }> {
  await response.body?.cancel()
  if (response.status === 401) throw restKeyError(key)
  if (response.status === 404) return "missing"
  const location = response.headers.get("location")
  if (!location) return { retry: `HTTP ${response.status}` }
  const download = await fetch(location, { signal: AbortSignal.timeout(30_000) })
  if (!download.ok) {
    await download.body?.cancel()
    return { retry: `download HTTP ${download.status}` }
  }
  const pdf = new Uint8Array(await download.arrayBuffer())
  if (new TextDecoder().decode(pdf.subarray(0, 5)) !== "%PDF-") return { retry: "download was not a PDF" }
  return { pdf }
}

/** readAllotment(), but a PDF pdf.js cannot open is "unparsed": it is no more readable next run. */
export async function readAllotmentOrUnparsed(ctx: CollectorContext, label: string, pdf: Uint8Array): Promise<Allotment> {
  try {
    return await readAllotment(pdf)
  } catch (error) {
    ctx.log(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    return { status: "unparsed", version: ALLOTMENT_PARSER_VERSION, checkedAt: new Date().toISOString() }
  }
}

type PendingRow = { id: number; company_number: string; transaction_id: string; document_url: string | null }

async function saveAllotment(id: number, allotment: Allotment) {
  // The currency with the most raised is the one shown; GBP when nothing was.
  const [currency, amount] = Object.entries(allotment.raised ?? {}).sort((a, b) => b[1] - a[1])[0] ?? ["GBP", 0]
  await db().query(
    `UPDATE signals
        SET amount = $2, currency = $3, data = data || jsonb_build_object('allotment', $4::jsonb)
      WHERE id = $1`,
    [id, allotment.status === "read" ? amount : null, allotment.status === "read" ? currency : null, JSON.stringify(allotment)],
  )
}

/**
 * Reads the SH01 documents of this source's signals that have not been read
 * yet (newest first), until the time runs out. A filing whose event carried
 * no document link is looked up in the company's filing history first.
 */
export async function readAllotmentDocuments(ctx: CollectorContext, key: string, deadline: number) {
  const sql = db()
  const pending = (await sql.query(
    `SELECT id, company_number, data->>'transactionId' AS transaction_id, data->>'documentMetadata' AS document_url
       FROM signals
      WHERE source_id = $1 AND company_number IS NOT NULL
        AND (data->'allotment' IS NULL
             OR (data->'allotment'->>'version')::int < $2
             OR (data->'allotment'->>'status' = 'no-document'
                 AND (data->'allotment'->>'checkedAt')::timestamptz < now() - make_interval(hours => $3)
                 AND first_seen_at > now() - make_interval(days => $4)))
      ORDER BY first_seen_at DESC
      LIMIT 1000`,
    [ctx.sourceId, ALLOTMENT_PARSER_VERSION, NO_DOCUMENT_RETRY_HOURS, NO_DOCUMENT_GIVE_UP_DAYS],
  )) as PendingRow[]

  const counts: Record<AllotmentReadStatus, number> = { read: 0, "no-text": 0, unparsed: 0, "no-document": 0 }
  const noDocument = () => ({ status: "no-document" as const, version: ALLOTMENT_PARSER_VERSION, checkedAt: new Date().toISOString() })

  // Filings whose event had no document link: find it in the filing history.
  const unlinked = pending.filter((row) => !row.document_url)
  const linksPass = await eachRequest(
    unlinked,
    deadline,
    (row) =>
      fetch(`${REST_URL}/company/${encodeURIComponent(row.company_number)}/filing-history/${encodeURIComponent(row.transaction_id)}`, {
        headers: { Authorization: basicAuth(key) },
        signal: AbortSignal.timeout(15_000),
      }),
    async (row, response) => {
      if (response.status === 401) throw restKeyError(key)
      const item = response.ok ? ((await response.json()) as { links?: { document_metadata?: string } }) : null
      if (!response.ok) await response.body?.cancel()
      const link = item?.links?.document_metadata
      if (link) {
        row.document_url = link
        await sql.query(
          `UPDATE signals SET data = data || jsonb_build_object('documentMetadata', $2::text) WHERE id = $1`,
          [row.id, link],
        )
      } else if (response.ok || response.status === 404) {
        await saveAllotment(row.id, noDocument())
        counts["no-document"]++
      }
    },
  )

  const linked = pending.filter((row) => row.document_url && documentUrl(row.document_url))
  const documentsPass = await eachRequest(
    linked,
    deadline,
    (row) => requestDocument(key, row.document_url!),
    async (row, response) => {
      const label = `SH01 document for ${row.company_number}`
      const result = await downloadDocument(key, response)
      if (result === "missing") {
        await saveAllotment(row.id, noDocument())
        counts["no-document"]++
        return
      }
      if ("retry" in result) {
        ctx.log(`${label}: ${result.retry}, will retry next run.`)
        return
      }
      const allotment = await readAllotmentOrUnparsed(ctx, label, result.pdf)
      await saveAllotment(row.id, allotment)
      counts[allotment.status]++
    },
  )

  const done = linksPass.done + documentsPass.done
  const remaining = unlinked.length + linked.length - done
  const stopReason = documentsPass.stopReason === "nothing to do" ? linksPass.stopReason : documentsPass.stopReason
  ctx.log(
    `Read ${counts.read} SH01 documents (${counts["no-text"]} scanned with no text, ${counts.unparsed} not understood, ${counts["no-document"]} with no document yet, ${remaining} left). Stopped: ${stopReason}.`,
  )
  return { ...counts, remaining, stopReason }
}
