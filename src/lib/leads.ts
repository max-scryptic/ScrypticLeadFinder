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
  /** Grant offer, or for a share allotment the cash it raised once its document is read. */
  amount: number | null
  currency: string | null
  occurredOn: string | null
  firstSeenAt: string
  url: string | null
  grantStatus: string | null
  grantCategory: string | null
  role: string | null
  /**
   * Share allotments only: how reading the SH01 document went ("read",
   * "no-text" for a scan, "unparsed", "no-document"), or null before it is read.
   */
  documentStatus: string | null
  /** True when the filing's figures are ambiguous and the true raise may be far larger than `amount`. */
  amountUncertain: boolean
}

/** A current officer of the company, from its Companies House officers list. */
export type Officer = {
  /** As Companies House shows it: "SMITH, Jane Anne". */
  name: string
  /** "director", "llp-designated-member", "corporate-director", "secretary", ... */
  role: string
  appointedOn: string | null
  occupation: string | null
  /** Companies House's id for the person, the same on every company they are an officer of. */
  officerId: string | null
}

/** A current person with significant control (an owner or controller). */
export type Psc = {
  name: string
  /** "individual-person-with-significant-control", "corporate-entity-person-with-significant-control", ... */
  kind: string
  forename: string | null
  surname: string | null
  /** Such as "ownership-of-shares-75-to-100-percent" or "right-to-appoint-and-remove-directors". */
  naturesOfControl: string[]
  notifiedOn: string | null
}

/** An SH01 in the company's filing history, newest first. */
export type HistoricAllotment = {
  transactionId: string
  filedOn: string
  allottedOn: string | null
  documentUrl: string | null
  /** True when this filing is also one of the lead's signals, whose own document read gives its amount. */
  isSignal: boolean
  /** What its document showed, once read. `status` is an AllotmentReadStatus. */
  read?: { status: string; version: number; raised?: Record<string, number>; uncertain?: boolean }
}

/** Filings that usually accompany a priced round: new articles, new share classes, authority to allot. */
export type RoundPaperwork = { filedOn: string; kind: "articles" | "share-classes" | "allotment-authority" }

export type CompanyFilings = {
  allotments: HistoricAllotment[]
  paperwork: RoundPaperwork[]
  /** True when the history had more filings than one page, so the oldest are missing. */
  truncated: boolean
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
  /** Null until the company's people and filing history are fetched. */
  officers: Officer[] | null
  pscs: Psc[] | null
  filings: CompanyFilings | null
  /** The company's website, null when none was found or before it is looked up. */
  website_url: string | null
  /** What proved the website is the company's: "company-number", "registered-name" or the weaker "brand-name". */
  website_evidence: string | null
  last_found_at: Date
  signals: LeadSignal[]
  status: LeadStatus
}

/** A decision maker: a current director or LLP member, or an individual who controls the company, merged when both. */
export type Person = {
  name: string
  /** "Director", "LLP member", ...; empty for an owner who is not an officer. */
  roles: string[]
  /** How they control the company, such as "owns 75 to 100%", or null. */
  control: string | null
  appointedOn: string | null
  occupation: string | null
}

/** Whether the share allotment the lead was found by is the company's first funding round. */
export type FundingHistory = {
  /**
   * "first": no earlier allotment raised a round's worth of cash. "repeat":
   * one did. "unknown": earlier allotments are scans, not read yet, or past
   * the end of the fetched history.
   */
  kind: "first" | "repeat" | "unknown"
  /** Allotments filed before the current round. */
  earlierCount: number
  /** The most recent earlier allotment that raised a round, if any (GBP). */
  earlierRound: { filedOn: string; raised: number } | null
  /** Round paperwork filed around the current round. */
  paperwork: RoundPaperwork["kind"][]
}

export type Lead = LeadRow & {
  score: number
  reasons: string[]
  /** Why the lead is hidden by default, or null when it is not. */
  exclusion: string | null
  ageYears: number | null
  grantTotal: number
  /** Cash raised by share allotments whose documents were read (GBP), or null when none were. */
  raisedTotal: number | null
  /** True when an allotment's figures were ambiguous, so `raisedTotal` may be too low. */
  raisedUncertain: boolean
  latestSignalOn: string | null
  /** Directors and owners, owners first. Empty until fetched. */
  people: Person[]
  /** Null until the filing history is fetched, or for a lead found by grants only. */
  funding: FundingHistory | null
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

/*
 * Finance and property activities: banking, lending, insurance, fund and
 * asset management, real estate and building development. Companies with
 * these codes do raise money, but to invest or build, not to have software
 * made. Some are fintechs, so they lose points rather than being excluded.
 */
function isFinanceOrPropertySic(code: string) {
  return /^(64|65|66|68)/.test(code) || ["41100", "41201", "41202"].includes(code)
}

/*
 * Words in a company name that mark a vehicle rather than a trading company:
 * an SPV, a fund, a holding or finance company, a property company. A number
 * just before "Limited" ("Pacific Finco 1 Limited") is how SPVs are numbered.
 */
const VEHICLE_NAME =
  /\b(FINCO|BIDCO|TOPCO|MIDCO|HOLDCO|PROPCO|SPV|NOMINEES?|SECURITIES|INVESTMENTS?|CAPITAL|FUNDS?|ASSET MANAGEMENT|WEALTH MANAGEMENT|PROPERT(Y|IES)|REALTY|ESTATES?|DEVELOPMENTS)\b|\b\d+ (LIMITED|LTD)$/

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

type CompanyFacts = Pick<LeadRow, "company_status" | "company_type" | "date_of_creation" | "sic_codes" | "accounts_type">

/**
 * Why a company is almost certainly not a buyer, or null. Also used by the
 * collectors to skip fetching more about such companies.
 */
export function exclusionFor(row: CompanyFacts, now = new Date()): string | null {
  const ageYears = row.date_of_creation ? yearsSince(row.date_of_creation, now) : null
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

// Cash from new shares at least this big is a funding round. Smaller
// allotments are usually founder shares, a new co-founder or options.
const ROUND_MIN_RAISE = 10_000
// Above this, a raise is a later round or a vehicle's funding, not an early
// round that pays for a first product.
const EARLY_ROUND_MAX = 2_000_000
// Above this, an allotment is almost never a startup: it funds an SPV, a fund,
// an acquisition or a property deal.
const IMPLAUSIBLE_RAISE = 10_000_000
// Allotments filed this close before the first one found as a signal are
// tranches of the same round, and paperwork this close to it belongs to it.
const SAME_ROUND_DAYS = 90

const paperworkLabels: Record<RoundPaperwork["kind"], string> = {
  articles: "new articles",
  "share-classes": "new share classes",
  "allotment-authority": "authority to allot shares",
}

const monthYear = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" })

/**
 * Whether the round the lead was found by is the company's first: no
 * allotment filed before it (outside the round's own tranches) raised
 * ROUND_MIN_RAISE in cash. Earlier allotments' amounts come from their SH01
 * documents, read by the collector.
 */
function fundingHistory(row: LeadRow, sh01s: LeadSignal[]): FundingHistory | null {
  if (!row.filings || sh01s.length === 0) return null
  const dates = sh01s.map((signal) => new Date(signal.occurredOn ?? signal.firstSeenAt).getTime()).sort((a, b) => a - b)
  const roundStart = dates[0]
  const roundEnd = dates.at(-1)!
  const window = SAME_ROUND_DAYS * DAY_MS

  const earlier = row.filings.allotments.filter(
    (allotment) => !allotment.isSignal && new Date(allotment.filedOn).getTime() < roundStart - window,
  )
  // Cash raised in GBP, or null when not known: unread, a scan, or only a
  // lower bound that is under the threshold.
  const raisedBy = (allotment: HistoricAllotment) => {
    if (allotment.read?.status !== "read") return null
    const raised = allotment.read.raised?.GBP ?? 0
    return allotment.read.uncertain && raised < ROUND_MIN_RAISE ? null : raised
  }
  // Allotments are newest first, so this is the latest earlier round.
  const round = earlier.find((allotment) => (raisedBy(allotment) ?? 0) >= ROUND_MIN_RAISE)
  const unknown = row.filings.truncated || earlier.some((allotment) => raisedBy(allotment) === null)
  const paperwork = row.filings.paperwork.filter((filing) => {
    const time = new Date(filing.filedOn).getTime()
    return time >= roundStart - window && time <= roundEnd + window
  })

  return {
    kind: round ? "repeat" : unknown ? "unknown" : "first",
    earlierCount: earlier.length,
    earlierRound: round ? { filedOn: round.filedOn, raised: raisedBy(round)! } : null,
    paperwork: [...new Set(paperwork.map((filing) => filing.kind))],
  }
}

const roleLabels: Record<string, string> = {
  director: "Director",
  "corporate-director": "Corporate director",
  "llp-member": "LLP member",
  "llp-designated-member": "LLP designated member",
  "corporate-llp-member": "Corporate LLP member",
  "corporate-llp-designated-member": "Corporate LLP designated member",
}

const titleCase = (text: string) =>
  text.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, separator: string, letter: string) => separator + letter.toUpperCase())

/** Key that matches an officer to a PSC: first forename and surname, letters only. */
const personKey = (forenames: string, surname: string) =>
  `${forenames.trim().split(/\s+/)[0]} ${surname}`.toLowerCase().replace(/[^\p{L} ]/gu, "")

/** The strongest way a PSC controls the company, in words. */
function controlOf(natures: string[]) {
  const band = (prefix: string) => {
    for (const nature of natures) {
      const match = new RegExp(`^${prefix}-(\\d+)-to-(\\d+)-percent`).exec(nature)
      if (match) return `${match[1]} to ${match[2]}%`
    }
    return null
  }
  const shares = band("ownership-of-shares")
  if (shares) return `owns ${shares}`
  const votes = band("voting-rights")
  if (votes) return `${votes} of votes`
  if (natures.some((nature) => nature.startsWith("right-to-appoint-and-remove-"))) return "appoints the board"
  if (natures.some((nature) => nature.startsWith("significant-influence-or-control"))) return "significant influence"
  return null
}

/**
 * The company's decision makers: directors and LLP members (not secretaries
 * or nominees) and individual PSCs, merged by name when one person is both.
 * Owners come first, by stake, then officers by appointment date, so founders
 * lead the list.
 */
function peopleOf(row: LeadRow): Person[] {
  const people = new Map<string, Person>()
  // Size of each person's stake, for the order.
  const ranks = new Map<Person, number>()

  for (const officer of row.officers ?? []) {
    if (/secretary|nominee/.test(officer.role)) continue
    const role = roleLabels[officer.role] ?? titleCase(officer.role.replace(/-/g, " "))
    // Individuals are "SURNAME, Forenames" or "SURNAME, Forenames, Title"
    // (the title is dropped); corporate officers are just the company name.
    const [surname, forenamesPart] = officer.name.split(",")
    const forenames = forenamesPart?.trim() ?? ""
    const key = forenames ? personKey(forenames, surname) : officer.name.toLowerCase()
    const existing = people.get(key)
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role)
      continue
    }
    people.set(key, {
      name: forenames ? `${forenames} ${titleCase(surname)}` : officer.name,
      roles: [role],
      control: null,
      appointedOn: officer.appointedOn,
      occupation: officer.occupation,
    })
  }

  for (const psc of row.pscs ?? []) {
    if (!psc.kind.startsWith("individual")) continue
    const control = controlOf(psc.naturesOfControl)
    const rank = control ? Number(/\d+/.exec(control)?.[0] ?? 1) : 0
    const key = psc.forename && psc.surname ? personKey(psc.forename, psc.surname) : psc.name.toLowerCase()
    const person = people.get(key)
    if (person) {
      person.control = control
      ranks.set(person, rank)
      // The PSC register has the surname in its proper case ("McDonald", not "MCDONALD").
      if (psc.surname) person.name = `${person.name.slice(0, person.name.lastIndexOf(" "))} ${psc.surname}`
    } else {
      const name = psc.forename && psc.surname ? `${psc.forename} ${psc.surname}` : psc.name
      const owner = { name, roles: [], control, appointedOn: null, occupation: null }
      people.set(key, owner)
      ranks.set(owner, rank)
    }
  }

  return [...people.values()]
    .sort(
      (a, b) =>
        (ranks.get(b) ?? 0) - (ranks.get(a) ?? 0) || (a.appointedOn ?? "9999").localeCompare(b.appointedOn ?? "9999"),
    )
}

/** Scores one lead. Points add up to at most 100; every rule that fired is listed in `reasons`. */
export function scoreLead(row: LeadRow, now = new Date()): Lead {
  const ageYears = row.date_of_creation ? yearsSince(row.date_of_creation, now) : null
  const sh01s = row.signals.filter((signal) => signal.sourceId === SH01_SOURCE)
  const grants = row.signals.filter((signal) => signal.sourceId === GRANT_SOURCE)
  const grantTotal = grants.reduce((sum, grant) => sum + (grant.amount ?? 0), 0)
  // Only GBP counts towards the raise bands; a non-GBP raise shows on the signal but scores nothing.
  const readSh01s = sh01s.filter((signal) => signal.documentStatus === "read")
  const raisedTotal =
    readSh01s.length > 0
      ? readSh01s.reduce((sum, signal) => sum + (signal.currency === "GBP" ? Number(signal.amount ?? 0) : 0), 0)
      : null
  const raisedUncertain = readSh01s.some((signal) => signal.amountUncertain)
  const funding = fundingHistory(row, sh01s)

  let score = 0
  const reasons: string[] = []
  const add = (points: number, reason: string) => {
    score += points
    reasons.push(reason)
  }

  if (sh01s.length > 0) {
    add(20, sh01s.length > 1 ? `Filed ${sh01s.length} share allotments` : "Filed a share allotment")
    const latest = sh01s.map((signal) => signal.occurredOn).filter(Boolean).sort().at(-1)
    if (latest && now.getTime() - new Date(latest).getTime() <= 30 * DAY_MS) add(5, "Share allotment filed in the last 30 days")

    // What the allotments raised, from their documents. Most SH01s are cap
    // table changes (founder shares, a new co-founder, options) for a few
    // pounds; a raise of thousands is a funding round. Seed-sized rounds
    // score best: much bigger ones are later rounds or not startups at all.
    if (raisedTotal !== null) {
      const raised = `Raised ${raisedUncertain ? "at least " : ""}${money.format(raisedTotal)} in cash from new shares`
      if (raisedTotal >= IMPLAUSIBLE_RAISE) {
        add(-20, `${raised}: far more than an early round, so likely a fund, SPV or acquisition vehicle`)
      } else if (raisedTotal > EARLY_ROUND_MAX) add(10, `${raised}, a later-stage round`)
      else if (raisedTotal >= 250_000) add(25, raised)
      else if (raisedTotal >= 50_000) add(20, raised)
      else if (raisedTotal >= 10_000) add(10, raised)
      // Only when every allotment was read and its figures are clear: an
      // unread or ambiguous one could still be the round.
      else if (raisedTotal < 1_000 && !raisedUncertain && readSh01s.length === sh01s.length) {
        add(-15, raisedTotal === 0 ? "No cash raised from new shares" : `Only ${money.format(raisedTotal)} raised, so not a funding round`)
      }
    }

    // A first round is the moment a company has money and no product team
    // yet; a company that raised before has usually built something already.
    if (funding?.kind === "first" && raisedTotal !== null && raisedTotal >= ROUND_MIN_RAISE && raisedTotal <= EARLY_ROUND_MAX) {
      add(15, `First funding round: no earlier allotment raised ${money.format(ROUND_MIN_RAISE)} or more`)
    }
    if (funding?.earlierRound) {
      const { raised, filedOn } = funding.earlierRound
      add(-10, `Raised ${money.format(raised)} in an earlier round (${monthYear.format(new Date(filedOn))})`)
    }
    if (funding && funding.paperwork.length > 0) {
      const filed = funding.paperwork.map((kind) => paperworkLabels[kind])
      const list = filed.length > 1 ? `${filed.slice(0, -1).join(", ")} and ${filed.at(-1)}` : filed[0]
      add(5, `Filed ${list} around the allotment, as priced rounds do`)
    }
  }
  if (grants.length > 0) {
    add(25, grants.length > 1 ? `Won ${grants.length} Innovate UK grants` : "Won an Innovate UK grant")
    if (grantTotal >= 100_000) add(10, `Grant offers total ${money.format(grantTotal)}`)
    if (grants.some((grant) => grant.grantStatus === "Active")) add(5, "Grant project is active")
    if (grants.some((grant) => grant.role === "LEAD_PARTICIPANT")) add(5, "Leads the grant project")
  }
  if (sh01s.length > 0 && grants.length > 0) add(15, "Both issued shares and won a grant")

  if (ageYears !== null) {
    if (ageYears < 1) add(15, "Under a year old")
    else if (ageYears < 3) add(10, "Under 3 years old")
    else if (ageYears < 5) add(5, "Under 5 years old")
  }
  const sic = row.sic_codes ?? []
  if (sic.some((code) => PRODUCT_SIC.has(code))) add(10, "Software, data or R&D SIC code")
  const financeSic = sic.filter(isFinanceOrPropertySic)
  if (financeSic.length > 0 && financeSic.length === sic.length) {
    add(-25, `Only finance or property SIC codes (${financeSic.join(", ")})`)
  } else if (financeSic.length > 0) {
    add(-10, `Has a finance or property SIC code (${financeSic.join(", ")})`)
  }
  const vehicleWord = row.company_name ? VEHICLE_NAME.exec(row.company_name.toUpperCase())?.[0] : undefined
  if (vehicleWord) add(-15, `Name suggests a fund, SPV, finance or property company ("${vehicleWord}")`)

  const latestSignalOn =
    row.signals
      .map((signal) => signal.occurredOn ?? signal.firstSeenAt.slice(0, 10))
      .sort()
      .at(-1) ?? null

  return {
    ...row,
    score: Math.max(0, Math.min(score, 100)),
    reasons,
    exclusion: exclusionFor(row, now),
    ageYears,
    grantTotal,
    raisedTotal,
    raisedUncertain,
    latestSignalOn,
    people: peopleOf(row),
    funding,
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
