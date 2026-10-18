import { db } from "@/lib/db"

import { collectors } from "./index"
import { getState, saveSignals, setState } from "./store"
import { CollectorConfigError, type CollectorResult } from "./types"

export type RunTrigger = "cron" | "manual" | "cli"

export type RunOutcome = {
  sourceId: string
  runId: number | null
  status: "success" | "error" | "skipped"
  message?: string
  itemsSeen: number
  itemsNew: number
}

// A run still marked "running" after this long crashed or timed out.
const STALE_RUN_MS = 30 * 60 * 1000

/**
 * Runs one collector and records the run. Never throws: failures are stored on
 * the run row and returned, so one broken source cannot stop the others.
 */
export async function runCollector(
  sourceId: string,
  { trigger, budgetMs }: { trigger: RunTrigger; budgetMs: number },
): Promise<RunOutcome> {
  const collector = collectors[sourceId as keyof typeof collectors]
  if (!collector) {
    return { sourceId, runId: null, status: "error", message: "No collector for this source.", itemsSeen: 0, itemsNew: 0 }
  }

  const sql = db()

  await sql.query(
    `UPDATE collector_runs SET status = 'error', finished_at = now(), message = 'Run did not finish (timed out or crashed).'
      WHERE source_id = $1 AND status = 'running' AND started_at < now() - ($2 || ' milliseconds')::interval`,
    [sourceId, String(STALE_RUN_MS)],
  )
  const running = (await sql.query(
    "SELECT id FROM collector_runs WHERE source_id = $1 AND status = 'running' LIMIT 1",
    [sourceId],
  )) as { id: number }[]
  if (running.length > 0) {
    return { sourceId, runId: null, status: "skipped", message: "Another run is still in progress.", itemsSeen: 0, itemsNew: 0 }
  }

  const missing = collector.requiredEnv.filter((name) => !process.env[name])
  const [{ id: runId }] = (await sql.query(
    "INSERT INTO collector_runs (source_id, trigger) VALUES ($1, $2) RETURNING id",
    [sourceId, trigger],
  )) as { id: number }[]

  const logs: string[] = []
  let result: CollectorResult | undefined
  let error: string | undefined

  try {
    if (missing.length > 0) {
      throw new CollectorConfigError(`Missing environment variables: ${missing.join(", ")}.`)
    }
    result = await collector.run({
      sourceId: collector.sourceId,
      deadline: Date.now() + budgetMs,
      log: (message) => {
        logs.push(message)
        if (trigger !== "manual") console.log(`[${sourceId}] ${message}`)
      },
      saveSignals: (signals) => saveSignals(sourceId, signals),
      getState: async <T extends Record<string, unknown>>() => (await getState(sourceId)) as Partial<T>,
      setState: (state) => setState(sourceId, state),
    })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }

  const status = error ? "error" : "success"
  const message = error ?? result?.message ?? null
  await sql.query(
    `UPDATE collector_runs
        SET status = $2, finished_at = now(), items_seen = $3, items_new = $4, message = $5, stats = $6::jsonb
      WHERE id = $1`,
    [
      runId,
      status,
      result?.itemsSeen ?? 0,
      result?.itemsNew ?? 0,
      message,
      JSON.stringify({ ...result?.stats, log: logs.slice(-50) }),
    ],
  )

  return {
    sourceId,
    runId,
    status,
    message: message ?? undefined,
    itemsSeen: result?.itemsSeen ?? 0,
    itemsNew: result?.itemsNew ?? 0,
  }
}
