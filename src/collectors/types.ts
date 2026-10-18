import type { SourceId } from "@/lib/sources"

/** A signal as a collector produces it, before it is stored. */
export type SignalInput = {
  externalId: string
  companyName?: string | null
  companyNumber?: string | null
  title: string
  summary?: string | null
  amount?: number | null
  currency?: string | null
  /** ISO date (YYYY-MM-DD). */
  occurredOn?: string | null
  url?: string | null
  data?: Record<string, unknown>
}

export type CollectorContext = {
  sourceId: SourceId
  /** Epoch ms by which the collector should return. */
  deadline: number
  log: (message: string) => void
  /** Upserts signals and returns how many were new. */
  saveSignals: (signals: SignalInput[]) => Promise<{ inserted: number }>
  getState: <T extends Record<string, unknown>>() => Promise<Partial<T>>
  setState: (state: Record<string, unknown>) => Promise<void>
}

export type CollectorResult = {
  itemsSeen: number
  itemsNew: number
  /** One line shown next to the run, such as a warning or what was skipped. */
  message?: string
  stats?: Record<string, unknown>
}

export type Collector = {
  sourceId: SourceId
  /** Environment variables the collector cannot run without. */
  requiredEnv: string[]
  run: (ctx: CollectorContext) => Promise<CollectorResult>
}

/** Thrown when a collector cannot run at all, such as a missing key. */
export class CollectorConfigError extends Error {}
