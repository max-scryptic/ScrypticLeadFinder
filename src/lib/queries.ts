import { connection } from "next/server"

import { db } from "@/lib/db"

/*
 * Reads for the Sources pages. Each calls connection() so the page renders
 * per request instead of being prerendered with build-time data.
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

export async function getRecentRuns(sourceId: string, limit = 10) {
  await connection()
  return (await db().query(
    `SELECT id, source_id, trigger, status, started_at, finished_at, items_seen, items_new, message
       FROM collector_runs WHERE source_id = $1 ORDER BY started_at DESC LIMIT $2`,
    [sourceId, limit],
  )) as RunRow[]
}

export async function getRecentSignals(
  sourceId: string,
  { maxCompanyAgeYears, limit = 100 }: { maxCompanyAgeYears?: number; limit?: number } = {},
) {
  await connection()
  // Companies not looked up yet have no age, so they stay in the list until they do.
  const ageFilter = maxCompanyAgeYears
    ? `AND (c.company_number IS NULL OR c.date_of_creation >= current_date - make_interval(years => $3))`
    : ""
  const params: unknown[] = [sourceId, limit]
  if (maxCompanyAgeYears) params.push(maxCompanyAgeYears)

  return (await db().query(
    `SELECT s.id, s.external_id, coalesce(s.company_name, c.name) AS company_name, s.company_number,
            s.title, s.summary, s.amount, s.currency, s.occurred_on, s.url, s.data, s.first_seen_at,
            c.status AS company_status, c.date_of_creation, c.sic_codes, c.locality, c.found AS company_found
       FROM signals s LEFT JOIN companies c ON c.company_number = s.company_number
      WHERE s.source_id = $1 ${ageFilter}
      ORDER BY s.occurred_on DESC NULLS LAST, s.first_seen_at DESC
      LIMIT $2`,
    params,
  )) as SignalRow[]
}
