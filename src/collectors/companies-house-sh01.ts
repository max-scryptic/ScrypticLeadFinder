import { basicAuth, describeKey, enrichCompanies, readKey, REST_URL } from "./companies-house"
import { enrichCompanyHistory } from "./company-history"
import { readAllotmentDocuments } from "./share-allotment-documents"
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
 * Each run has four phases inside its time budget:
 *   1. Stream: read events from the saved timepoint, keep the SH01s.
 *   2. Enrich: look up each new company once through the REST API (age, status,
 *      SIC codes, accounts type), cached in the companies table.
 *   3. History: fetch each lead's officers, PSCs and filing history, and read
 *      its earlier allotments, to name its decision makers and tell whether
 *      this is its first round (see company-history.ts).
 *   4. Documents: read each SH01 document for the cash the allotment raised
 *      (see share-allotment-documents.ts).
 *
 * Docs: https://developer-specs.company-information.service.gov.uk/streaming-api/guides/overview
 */

const STREAM_URL = "https://stream.companieshouse.gov.uk/filings"

// Points in the run's time budget where the stream, enrich and history phases
// stop; the rest reads documents. A phase that finishes early hands its time
// to the next.
const STREAM_SHARE = 0.5
const ENRICH_SHARE = 0.65
const HISTORY_SHARE = 0.8
const FLUSH_EVERY = 100

// When the stream phase counts as caught up during busy hours, when live
// filings keep coming and no heartbeat arrives: a filing published this close
// to now, or this long with nothing new after a backlog that arrives in one
// continuous burst. Live filings already trail now by about a minute (the
// 15:39 run on 2026-10-20 was 75 s behind at its deadline), and stopping a
// little early only leaves those filings for the next run.
const LIVE_MARGIN_MS = 120_000
const IDLE_MS = 10_000

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

/**
 * published_at has no time zone ("2026-10-20T15:27:54") but is UTC: runs that
 * reached live filings at 15:43 UTC on a BST day logged 15:42.
 */
function publishedTime(publishedAt: string | undefined) {
  if (!publishedAt) return undefined
  const time = Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(publishedAt) ? publishedAt : `${publishedAt}Z`)
  return Number.isNaN(time) ? undefined : time
}

/** Reads the next chunk, or resolves null when nothing arrives within `ms`. */
async function readWithin(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const idle = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([reader.read(), idle])
  } finally {
    clearTimeout(timer)
  }
}

async function openStream(key: string, timepoint: number | undefined, signal: AbortSignal) {
  const url = new URL(STREAM_URL)
  if (timepoint !== undefined) url.searchParams.set("timepoint", String(timepoint))
  return fetch(url, { headers: { Authorization: basicAuth(key) }, signal })
}

/** Phase 1: read the stream until the deadline or until it reaches live filings. */
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

    // published_at is not in timepoint order (it can jump back minutes), so
    // compare the newest one seen so far.
    let newestPublished = 0

    reading: while (true) {
      // Wait without a limit until the first filing: connecting can be slow.
      const chunk = eventsRead === 0 ? await reader.read() : await readWithin(reader, IDLE_MS)
      if (!chunk) {
        stopReason = `reached live filings (none for ${IDLE_MS / 1000} s)`
        break
      }
      const { done, value } = chunk
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

        // The timepoint already points past this filing, so the next run
        // resumes right after it.
        newestPublished = Math.max(newestPublished, publishedTime(event.event?.published_at) ?? 0)
        if (Date.now() - newestPublished <= LIVE_MARGIN_MS) {
          stopReason = `reached live filings (published within ${LIVE_MARGIN_MS / 60_000} minutes)`
          break reading
        }
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

export const companiesHouseSh01Collector: Collector = {
  sourceId: "companies-house-sh01",
  requiredEnv: ["COMPANIES_HOUSE_STREAM_KEY", "COMPANIES_HOUSE_API_KEY"],
  async run(ctx) {
    const streamKey = readKey("COMPANIES_HOUSE_STREAM_KEY")
    const apiKey = readKey("COMPANIES_HOUSE_API_KEY")
    const start = Date.now()
    const budget = ctx.deadline - start

    const stream = await readStream(ctx, streamKey, apiKey, start + budget * STREAM_SHARE)
    const enrich = await enrichCompanies(ctx, apiKey, start + budget * ENRICH_SHARE)
    const history = await enrichCompanyHistory(ctx, apiKey, start + budget * HISTORY_SHARE)
    const documents = await readAllotmentDocuments(ctx, apiKey, ctx.deadline)

    const parts = [
      `${stream.inserted} new SH01 from ${stream.eventsRead} filings`,
      `${enrich.fetched} companies looked up`,
      `${history.fetched} filing histories fetched`,
      `${documents.read + history.documents.read} documents read`,
    ]
    if (enrich.remaining > 0) parts.push(`${enrich.remaining} companies still to look up`)
    if (history.remaining > 0) parts.push(`${history.remaining} filing histories still to fetch`)
    if (documents.remaining > 0) parts.push(`${documents.remaining} documents still to read`)
    if (stream.warning) parts.push(stream.warning)

    return {
      itemsSeen: stream.found,
      itemsNew: stream.inserted,
      message: `${parts.join(", ")}.`,
      stats: { stream, enrich, history, documents },
    }
  },
}
