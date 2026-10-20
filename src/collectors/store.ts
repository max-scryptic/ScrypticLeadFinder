import { db } from "@/lib/db"

import type { SignalInput } from "./types"

/*
 * Signals are upserted in one round trip by passing the batch as a single
 * JSON parameter. `xmax = 0` is true only for rows this statement inserted,
 * which is how new signals are counted apart from ones seen before.
 *
 * A signal seen again keeps what was added to it after it was stored, such as
 * the amount read from an SH01 document: `data` is merged rather than
 * replaced, and a null amount does not overwrite a known one.
 */
export async function saveSignals(sourceId: string, signals: SignalInput[]) {
  if (signals.length === 0) return { inserted: 0 }

  const rows = signals.map((signal) => ({
    source_id: sourceId,
    external_id: signal.externalId,
    company_name: signal.companyName ?? null,
    company_number: signal.companyNumber ?? null,
    title: signal.title,
    summary: signal.summary ?? null,
    amount: signal.amount ?? null,
    currency: signal.currency ?? null,
    occurred_on: signal.occurredOn ?? null,
    url: signal.url ?? null,
    data: signal.data ?? {},
  }))

  const result = (await db().query(
    `INSERT INTO signals (source_id, external_id, company_name, company_number, title, summary,
                          amount, currency, occurred_on, url, data)
     SELECT DISTINCT ON (r.source_id, r.external_id)
            r.source_id, r.external_id, r.company_name, r.company_number, r.title, r.summary,
            r.amount, r.currency, r.occurred_on, r.url, coalesce(r.data, '{}'::jsonb)
       FROM jsonb_to_recordset($1::jsonb) AS r(
              source_id text, external_id text, company_name text, company_number text,
              title text, summary text, amount numeric, currency text, occurred_on date,
              url text, data jsonb)
     ON CONFLICT (source_id, external_id) DO UPDATE SET
       company_name   = coalesce(EXCLUDED.company_name, signals.company_name),
       company_number = coalesce(EXCLUDED.company_number, signals.company_number),
       title          = EXCLUDED.title,
       summary        = EXCLUDED.summary,
       amount         = coalesce(EXCLUDED.amount, signals.amount),
       currency       = coalesce(EXCLUDED.currency, signals.currency),
       occurred_on    = EXCLUDED.occurred_on,
       url            = EXCLUDED.url,
       data           = signals.data || EXCLUDED.data,
       last_seen_at   = now()
     RETURNING (xmax = 0) AS inserted`,
    [JSON.stringify(rows)],
  )) as { inserted: boolean }[]

  return { inserted: result.filter((row) => row.inserted).length }
}

export async function getState(sourceId: string) {
  const rows = (await db()
    .query("SELECT state FROM collector_state WHERE source_id = $1", [sourceId])) as {
    state: Record<string, unknown>
  }[]
  return rows[0]?.state ?? {}
}

export async function setState(sourceId: string, state: Record<string, unknown>) {
  await db().query(
    `INSERT INTO collector_state (source_id, state, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (source_id) DO UPDATE SET state = collector_state.state || EXCLUDED.state,
                                           updated_at = now()`,
    [sourceId, JSON.stringify(state)],
  )
}
