"use client"

import { useState, useTransition } from "react"

import { leadStatuses, type LeadStatus } from "@/lib/leads"

import { setLeadStatus } from "./actions"

const labels: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  rejected: "Rejected",
}

export function LeadStatusSelect({
  leadKey,
  status,
  companyName,
}: {
  leadKey: string
  status: LeadStatus
  companyName: string
}) {
  const [value, setValue] = useState(status)
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label={`Status of ${companyName}`}
        value={value}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value as LeadStatus
          const previous = value
          setValue(next)
          setError(undefined)
          startTransition(async () => {
            const result = await setLeadStatus(leadKey, next)
            if (result.error) {
              setValue(previous)
              setError(result.error)
            }
          })
        }}
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
      >
        {leadStatuses.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
