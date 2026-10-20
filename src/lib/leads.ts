/*
 * Leads: one row per company, combining its signals from every source. A
 * company is keyed by its Companies House number, or by name when a source
 * gave no number and the name could not be matched.
 *
 * Each lead gets a score (higher means more likely to need an MVP built, with
 * the reasons listed) and, when one applies, an exclusion: a reason it is
 * almost certainly not a buyer (dissolved, dormant, a holding or property
 * company, too old, too big). Excluded leads are hidden by default.
 * The rules are plain code below so they are easy to read and tune. This file
 * has no database access, so client components can import it; the query is
 * getLeads() in src/lib/queries.ts.
 */

export const leadStatuses = ["new", "contacted", "qualified", "rejected"] as const
export type LeadStatus = (typeof leadStatuses)[number]

export const SH01_SOURCE = "companies-house-sh01"
export const GRANT_SOURCE = "ukri-innovate-uk-grants"

export type LeadSignal = {
  sourceId: string
  title: string
  amount: number | null
  currency: string | null
  occurredOn: string | null
  firstSeenAt: string
  url: string | null
  grantStatus: string | null
  grantCategory: string | null
  role: string | null
}

export type LeadRow = {
  lead_key: string
  company_number: string | null
  company_name: string | null
  company_status: string | null
  company_type: string | null
  date_of_creation: Date | null
  sic_codes: string[] | null
  locality: string | null
  postcode: string | null
  accounts_type: string | null
  company_found: boolean | null
  last_found_at: Date
  signals: LeadSignal[]
  status: LeadStatus
}

export type Lead = LeadRow & {
  score: number
  reasons: string[]
  /** Why the lead is hidden by default, or null when it is not. */
  exclusion: string | null
  ageYears: number | null
  grantTotal: number
  latestSignalOn: string | null
}

/*
 * SIC codes of companies that hold assets rather than trade: holding
 * companies, property and investment vehicles, non-trading and dormant
 * companies. These file plenty of SH01s and are almost never MVP buyers.
 */
const NON_TRADING_SIC: Record<string, string> = {
  "41100": "development of building projects",
  "64201": "holding company",
  "64202": "holding company",
  "64203": "holding company",
  "64204": "holding company",
  "64205": "holding company",
  "64209": "holding company",
  "64301": "investment trust",
  "64302": "unit trust",
  "64303": "venture capital company",
  "64304": "investment company",
  "64305": "property unit trust",
  "64306": "real estate investment trust",
  "68100": "buying and selling own property",
  "68201": "letting property",
  "68202": "letting property",
  "68209": "letting property",
  "68310": "estate agency",
  "68320": "property management",
  "70100": "head office",
  "74990": "non-trading company",
  "99999": "dormant company",
}

// Software, data and R&D activities: the companies most likely to have a product to build.
const PRODUCT_SIC = new Set(["58210", "58290", "62011", "62012", "62090", "63110", "63120", "72110", "72190"])

// Accounts types that mean a large company or part of a group, not a startup.
const LARGE_ACCOUNTS: Record<string, string> = {
  full: "files full accounts",
  group: "files group accounts",
  medium: "files medium-sized accounts",
  "audit-exemption-subsidiary": "is a subsidiary of a group",
  "filing-exemption-subsidiary": "is a subsidiary of a group",
}

const MAX_AGE_YEARS = 10
const DAY_MS = 24 * 60 * 60 * 1000
const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 })

function yearsSince(date: Date | string, now: Date) {
  return (now.getTime() - new Date(date).getTime()) / (365.25 * DAY_MS)
}

function exclusionFor(row: LeadRow, ageYears: number | null): string | null {
  if (row.company_status && row.company_status !== "active") {
    return `Company is ${row.company_status.replace(/-/g, " ")}`
  }
  if (row.accounts_type === "dormant") return "Dormant company"
  const sic = row.sic_codes ?? []
  if (sic.length > 0 && sic.every((code) => code in NON_TRADING_SIC)) {
    const kinds = [...new Set(sic.map((code) => NON_TRADING_SIC[code]))]
    return `Not a trading company: ${kinds.join(", ")} (SIC ${sic.join(", ")})`
  }
  if (row.company_type === "plc") return "Public limited company"
  if (row.accounts_type && row.accounts_type in LARGE_ACCOUNTS) {
    return `Large company: ${LARGE_ACCOUNTS[row.accounts_type]}`
  }
  if (ageYears !== null && ageYears > MAX_AGE_YEARS) {
    return `Incorporated ${Math.floor(ageYears)} years ago`
  }
  return null
}

/** Scores one lead. Points add up to at most 100; every rule that fired is listed in `reasons`. */
export function scoreLead(row: LeadRow, now = new Date()): Lead {
  const ageYears = row.date_of_creation ? yearsSince(row.date_of_creation, now) : null
  const sh01s = row.signals.filter((signal) => signal.sourceId === SH01_SOURCE)
  const grants = row.signals.filter((signal) => signal.sourceId === GRANT_SOURCE)
  const grantTotal = grants.reduce((sum, grant) => sum + (grant.amount ?? 0), 0)

  let score = 0
  const reasons: string[] = []
  const add = (points: number, reason: string) => {
    score += points
    reasons.push(reason)
  }

  if (sh01s.length > 0) {
    add(30, sh01s.length > 1 ? `Filed ${sh01s.length} share allotments` : "Filed a share allotment")
    const latest = sh01s.map((signal) => signal.occurredOn).filter(Boolean).sort().at(-1)
    if (latest && now.getTime() - new Date(latest).getTime() <= 30 * DAY_MS) add(10, "Share allotment filed in the last 30 days")
  }
  if (grants.length > 0) {
    add(25, grants.length > 1 ? `Won ${grants.length} Innovate UK grants` : "Won an Innovate UK grant")
    if (grantTotal >= 100_000) add(10, `Grant offers total ${money.format(grantTotal)}`)
    if (grants.some((grant) => grant.grantStatus === "Active")) add(5, "Grant project is active")
    if (grants.some((grant) => grant.role === "LEAD_PARTICIPANT")) add(5, "Leads the grant project")
  }
  if (sh01s.length > 0 && grants.length > 0) add(15, "Both raised money and won a grant")

  if (ageYears !== null) {
    if (ageYears < 1) add(20, "Under a year old")
    else if (ageYears < 3) add(15, "Under 3 years old")
    else if (ageYears < 5) add(5, "Under 5 years old")
  }
  if ((row.sic_codes ?? []).some((code) => PRODUCT_SIC.has(code))) add(10, "Software, data or R&D SIC code")

  const latestSignalOn =
    row.signals
      .map((signal) => signal.occurredOn ?? signal.firstSeenAt.slice(0, 10))
      .sort()
      .at(-1) ?? null

  return {
    ...row,
    score: Math.min(score, 100),
    reasons,
    exclusion: exclusionFor(row, ageYears),
    ageYears,
    grantTotal,
    latestSignalOn,
  }
}

/* Filters, shared by the Leads page and its CSV export so both show the same list. */

export const leadSourceFilters = {
  any: "Any source",
  sh01: "Share allotments",
  grants: "Grants",
  both: "Both",
} as const
export type LeadSourceFilter = keyof typeof leadSourceFilters

export const leadWindows = [30, 90, 365] as const

export type LeadFilters = {
  status: LeadStatus | "all"
  source: LeadSourceFilter
  /** Only leads with a signal found in the last this many days. */
  days: (typeof leadWindows)[number]
  showExcluded: boolean
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams

function param(params: Params, name: string) {
  const value = params instanceof URLSearchParams ? params.get(name) : params[name]
  return (Array.isArray(value) ? value[0] : value) ?? undefined
}

export function parseLeadFilters(params: Params): LeadFilters {
  const status = param(params, "status")
  const source = param(params, "source")
  const days = Number(param(params, "days"))
  return {
    status: status === "all" || leadStatuses.includes(status as LeadStatus) ? (status as LeadStatus | "all") : "new",
    source: source && source in leadSourceFilters ? (source as LeadSourceFilter) : "any",
    days: leadWindows.find((window) => window === days) ?? 90,
    showExcluded: param(params, "excluded") === "1",
  }
}

/** Query string for a set of filters, leaving out defaults. */
export function leadFiltersQuery(filters: LeadFilters) {
  const query = new URLSearchParams()
  if (filters.status !== "new") query.set("status", filters.status)
  if (filters.source !== "any") query.set("source", filters.source)
  if (filters.days !== 90) query.set("days", String(filters.days))
  if (filters.showExcluded) query.set("excluded", "1")
  const text = query.toString()
  return text ? `?${text}` : ""
}

export function matchesSource(lead: Lead, source: LeadSourceFilter) {
  const hasSh01 = lead.signals.some((signal) => signal.sourceId === SH01_SOURCE)
  const hasGrant = lead.signals.some((signal) => signal.sourceId === GRANT_SOURCE)
  if (source === "sh01") return hasSh01
  if (source === "grants") return hasGrant
  if (source === "both") return hasSh01 && hasGrant
  return true
}
