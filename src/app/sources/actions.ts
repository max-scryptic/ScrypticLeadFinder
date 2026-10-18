"use server"

import { revalidatePath } from "next/cache"

import { collectors } from "@/collectors"
import { runCollector, type RunOutcome } from "@/collectors/runner"

// Manual runs happen inside a request, so they get a short budget. The cron
// job gives each collector several minutes.
const MANUAL_BUDGET_MS = 45_000

export type RunNowState = { outcome?: RunOutcome; error?: string }

export async function runSourceNow(_previous: RunNowState, formData: FormData): Promise<RunNowState> {
  // TODO: check the signed-in user here once the app has auth. Server Actions
  // are reachable by direct POST, so anyone who can load the app can trigger a run.
  const sourceId = String(formData.get("sourceId") ?? "")
  if (!(sourceId in collectors)) return { error: "This source has no collector yet." }

  const outcome = await runCollector(sourceId, { trigger: "manual", budgetMs: MANUAL_BUDGET_MS })
  revalidatePath(`/sources/${sourceId}`)
  revalidatePath("/sources")
  return { outcome }
}
