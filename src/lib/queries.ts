import { connection } from "next/server"

import { db } from "@/lib/db"
import { matchesSource, scoreLead, type Lead, type LeadFilters, type LeadRow, type LeadStatus } from "@/lib/leads"
import { PAGE_SIZE } from "@/lib/pagination"

/*
 * Reads for the Sources and Leads pages. Each calls connection() so the page
 * renders per request instead of being prerendered with build-time data.
 */

export type RunRow = {
  id: number
  source_id: string
  trigger: string
  status: "running" | "success" | "error"
  started_at: Date
  finished_at: Date | null
  items_seen: number
  items_new: number
  message: string | null
}

export type SourceSummary = {
  source_id: string
  total: number
  new_this_week: number
  last_run: RunRow | null
}

export type SignalRow = {
  id: number
  external_id: string
  company_name: string | null
  company_number: string | null
  title: string
  summary: string | null
  amount: string | null
  currency: string | null
  occurred_on: Date | null
  url: string | null
  data: Record<string, unknown>
  first_seen_at: Date
  company_status: string | null
  date_of_creation: Date | null
  sic_codes: string[] | null
  locality: string | null
  company_found: boolean | null
}

export async function getSourceSummaries(): Promise<Record<string, SourceSummary>> {
  await connection()
  const rows = (await db().query(`
    WITH counts AS (
      SELECT source_id,
             count(*)::int AS total,
             count(*) FILTER (WHERE first_seen_at > now() - interval '7 days')::int AS new_this_week
        FROM signals GROUP BY source_id
    ),
    last_runs AS (
      SELECT DISTINCT ON (source_id) * FROM collector_runs ORDER BY source_id, started_at DESC
    )
    SELECT coalesce(c.source_id, r.source_id) AS source_id,
           coalesce(c.total, 0) AS total,
           coalesce(c.new_this_week, 0) AS new_this_week,
           CASE WHEN r.id IS NULL THEN NULL ELSE to_jsonb(r) END AS last_run
      FROM counts c FULL JOIN last_runs r ON r.source_id = c.source_id
  `)) as (Omit<SourceSummary, "last_run"> & { last_run: (Omit<RunRow, "started_at" | "finished_at"> & { started_at: string; finished_at: string | null }) | null })[]

  return Object.fromEntries(
    rows.map((row) => [
      row.source_id,
      {
        ...row,
        last_run: row.last_run
          ? {
              ...row.last_run,
              started_at: new Date(row.last_run.started_at),
              finished_at: row.last_run.finished_at ? new Date(row.last_run.finished_at) : null,
            }
          : null,
      },
    ]),
  )
}

/** One page of a list, and how many rows the whole list has. */
export type Page<Row> = { rows: Row[]; total: number }

export async function getRecentRuns(sourceId: string, page = 1): Promise<Page<RunRow>> {
  await connection()
  const [rows, [{ total }]] = await Promise.all([
    db().query(
      `SELECT id, source_id, trigger, status, started_at, finished_at, items_seen, items_new, message
         FROM collector_runs WHERE source_id = $1 ORDER BY started_at DESC LIMIT $2 OFFSET $3`,
      [sourceId, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    ),
    db().query(`SELECT count(*)::int AS total FROM collector_runs WHERE source_id = $1`, [sourceId]),
  ])
  return { rows: rows as RunRow[], total }
}

export async function getRecentSignals(
  sourceId: string,
  { maxCompanyAgeYears, page = 1 }: { maxCompanyAgeYears?: number; page?: number } = {},
): Promise<Page<SignalRow>> {
  await connection()
  // Companies not looked up yet have no age, so they stay in the list until they do.
  const ageFilter = maxCompanyAgeYears
    ? `AND (c.company_number IS NULL OR c.date_of_creation >= current_date - make_interval(years => $2))`
    : ""
  const where = `FROM signals s LEFT JOIN companies c ON c.company_number = s.company_number
      WHERE s.source_id = $1 ${ageFilter}`
  const params: unknown[] = [sourceId]
  if (maxCompanyAgeYears) params.push(maxCompanyAgeYears)

  const [rows, [{ total }]] = await Promise.all([
    db().query(
      `SELECT s.id, s.external_id, coalesce(s.company_name, c.name) AS company_name, s.company_number,
              s.title, s.summary, s.amount, s.currency, s.occurred_on, s.url, s.data, s.first_seen_at,
              c.status AS company_status, c.date_of_creation, c.sic_codes, c.locality, c.found AS company_found
         ${where}
        ORDER BY s.occurred_on DESC NULLS LAST, s.first_seen_at DESC, s.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    ),
    db().query(`SELECT count(*)::int AS total ${where}`, params),
  ])
  return { rows: rows as SignalRow[], total }
}

export type LeadList = {
  leads: Lead[]
  /** Leads per status, after the source and exclusion filters. */
  statusCounts: Record<LeadStatus | "all", number>
  /** Leads the exclusion rules hid, after the status and source filters. */
  excludedCount: number
}

/** Scores every lead in the window and applies the filters, best first. */
export async function getLeads(filters: LeadFilters): Promise<LeadList> {
  const scored = (await getLeadRows(filters.days)).map((row) => scoreLead(row))
  const visible = scored.filter(
    (lead) => matchesSource(lead, filters.source) && (filters.showExcluded || !lead.exclusion),
  )

  const statusCounts = { all: visible.length, new: 0, contacted: 0, qualified: 0, rejected: 0 }
  for (const lead of visible) statusCounts[lead.status]++

  const inStatus = (lead: Lead) => filters.status === "all" || lead.status === filters.status
  const excludedCount = scored.filter(
    (lead) => lead.exclusion && inStatus(lead) && matchesSource(lead, filters.source),
  ).length

  const leads = visible
    .filter(inStatus)
    .sort(
      (a, b) =>
        Number(Boolean(a.exclusion)) - Number(Boolean(b.exclusion)) ||
        b.score - a.score ||
        (b.latestSignalOn ?? "").localeCompare(a.latestSignalOn ?? ""),
    )

  return { leads, statusCounts, excludedCount }
}

async function getLeadRows(days: number) {
  await connection()
  // Every signal of a company counts towards its score, but only companies
  // with a signal found inside the window are listed.
  return (await db().query(
    `WITH keyed AS (
       SELECT coalesce(s.company_number, 'name:' || s.company_name) AS lead_key, s.*
         FROM signals s
        WHERE s.company_number IS NOT NULL OR s.company_name IS NOT NULL
     ),
     grouped AS (
       SELECT lead_key,
              max(company_number) AS company_number,
              max(company_name) AS signal_company_name,
              max(first_seen_at) AS last_found_at,
              json_agg(json_build_object(
                'sourceId', source_id, 'title', title, 'amount', amount, 'currency', currency,
                'occurredOn', occurred_on, 'firstSeenAt', first_seen_at, 'url', url,
                'grantStatus', data->>'status', 'grantCategory', data->>'grantCategory', 'role', data->>'role',
                'documentStatus', data->'allotment'->>'status',
                'amountUncertain', coalesce((data->'allotment'->>'uncertain')::boolean, false)
              ) ORDER BY coalesce(occurred_on, first_seen_at::date) DESC) AS signals
         FROM keyed
        GROUP BY lead_key
       HAVING max(first_seen_at) > now() - make_interval(days => $1)
     )
     SELECT g.lead_key, g.company_number, coalesce(c.name, g.signal_company_name) AS company_name,
            c.status AS company_status, c.type AS company_type, c.date_of_creation, c.sic_codes,
            c.locality, c.postcode, c.accounts_type, c.found AS company_found, c.officers, c.pscs, c.filings,
            w.url AS website_url, w.evidence AS website_evidence,
            g.last_found_at, g.signals, coalesce(ls.status, 'new') AS status
       FROM grouped g
       LEFT JOIN companies c ON c.company_number = g.company_number
       LEFT JOIN company_websites w ON w.company_number = g.company_number
       LEFT JOIN lead_status ls ON ls.lead_key = g.lead_key`,
    [days],
  )) as LeadRow[]
}

export async function saveLeadStatus(leadKey: string, status: LeadStatus) {
  await db().query(
    `INSERT INTO lead_status (lead_key, status, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (lead_key) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
    [leadKey, status],
  )
}
