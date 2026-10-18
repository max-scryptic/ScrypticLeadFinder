import { companiesHouseSh01Collector } from "./companies-house-sh01"
import type { Collector } from "./types"
import { ukriGrantsCollector } from "./ukri-grants"

/** Collectors by source id. A source in src/lib/sources.ts with status "live" must have one. */
export const collectors = {
  [companiesHouseSh01Collector.sourceId]: companiesHouseSh01Collector,
  [ukriGrantsCollector.sourceId]: ukriGrantsCollector,
} satisfies Record<string, Collector>
