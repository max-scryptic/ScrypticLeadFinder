"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"

import { runSourceNow, type RunNowState } from "../actions"

export function RunNowButton({ sourceId }: { sourceId: string }) {
  const [state, action, pending] = useActionState<RunNowState, FormData>(runSourceNow, {})
  const outcome = state.outcome

  return (
    <form action={action} className="flex flex-col items-end gap-1.5">
      <input type="hidden" name="sourceId" value={sourceId} />
      <Button type="submit" disabled={pending}>
        {pending ? "Running (up to a minute)..." : "Run now"}
      </Button>
      <p className="max-w-xs text-right text-xs text-muted-foreground" aria-live="polite">
        {state.error ??
          (outcome
            ? outcome.status === "success"
              ? `Done. ${outcome.message ?? ""}`
              : outcome.status === "skipped"
                ? outcome.message
                : `Failed. ${outcome.message ?? ""}`
            : "")}
      </p>
    </form>
  )
}
