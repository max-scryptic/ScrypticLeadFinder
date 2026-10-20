import { enrichCompanies, matchCompanyNames, readKey } from "./companies-house"
import type { Collector, SignalInput } from "./types"

/*
 * Innovate UK projects from UKRI's Gateway to Research API.
 *
 * GtR has no "changed since" filter, so each run reads the newest projects by
 * start date and upserts them; anything already stored just gets its
 * last_seen_at bumped. Each project lists its participants with their grant
 * offer, so one request per page is enough.
 *
 * Grant records name the company but carry no company number. When a
 * Companies House REST key is set, each run then matches names to numbers
 * (exact registered name only) and looks the companies up, the same way the
 * SH01 collector does, so grants get the company's age, status and SIC codes.
 *
 * API reference: https://gtr.ukri.org/resources/api.html
 */

const API = "https://gtr.ukri.org/gtr/api/projects"
const PAGE_SIZE = 100
const MAX_PAGES = 5

// Universities and other research bodies take part in many projects; only
// companies are leads.
const COMPANY_NAME = /\b(LTD|LIMITED|PLC|LLP|L\.?T\.?D\.?)\b/i

type GtrParticipant = {
  organisationId: string
  organisationName: string
  role: string
  projectCost: number | null
  grantOffer: number | null
}

type GtrProject = {
  id: string
  title: string
  status: string
  grantCategory: string
  leadFunder: string
  abstractText: string | null
  created: number | null
  identifiers?: { identifier?: { value: string; type: string }[] }
  links?: { link?: { href: string; rel: string; start: number | null; end: number | null }[] }
  participantValues?: { participant?: GtrParticipant[] }
}

type GtrPage = { totalPages: number; totalSize: number; project?: GtrProject[] }

function isoDate(epochMs: number | null | undefined) {
  return epochMs ? new Date(epochMs).toISOString().slice(0, 10) : null
}

function truncate(text: string | null, length: number) {
  if (!text) return null
  const clean = text.replace(/\s+/g, " ").trim()
  return clean.length > length ? `${clean.slice(0, length - 1).trimEnd()}...` : clean
}

/** Picks the company a project is a lead for: the lead participant if it is a company, else the biggest grant. */
export function toSignal(project: GtrProject): SignalInput | null {
  const participants = project.participantValues?.participant ?? []
  const companies = participants.filter((p) => COMPANY_NAME.test(p.organisationName))
  if (companies.length === 0) return null

  const company =
    companies.find((p) => p.role === "LEAD_PARTICIPANT") ??
    [...companies].sort((a, b) => (b.grantOffer ?? 0) - (a.grantOffer ?? 0))[0]

  const fund = project.links?.link?.find((link) => link.rel === "FUND")
  const reference = project.identifiers?.identifier?.[0]?.value

  return {
    externalId: project.id,
    companyName: company.organisationName,
    title: project.title,
    summary: truncate(project.abstractText, 600),
    amount: company.grantOffer,
    currency: "GBP",
    occurredOn: isoDate(fund?.start),
    url: reference
      ? `https://gtr.ukri.org/projects?ref=${encodeURIComponent(reference)}`
      : `https://gtr.ukri.org/projects?ref=${project.id}`,
    data: {
      reference,
      grantCategory: project.grantCategory,
      status: project.status,
      role: company.role,
      projectCost: company.projectCost,
      endsOn: isoDate(fund?.end),
      addedToGtrOn: isoDate(project.created),
      participants: participants.map((p) => ({
        name: p.organisationName,
        role: p.role,
        grantOffer: p.grantOffer,
        isCompany: COMPANY_NAME.test(p.organisationName),
      })),
    },
  }
}

async function fetchPage(page: number): Promise<GtrPage> {
  const url = new URL(API)
  url.searchParams.set("q", "Innovate UK")
  url.searchParams.set("f", "pro.lf")
  url.searchParams.set("sf", "pro.sd")
  url.searchParams.set("so", "D")
  url.searchParams.set("s", String(PAGE_SIZE))
  url.searchParams.set("p", String(page))

  const response = await fetch(url, {
    headers: { Accept: "application/vnd.rcuk.gtr.json-v7" },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`Gateway to Research returned HTTP ${response.status} for page ${page}.`)
  }
  return response.json()
}

export const ukriGrantsCollector: Collector = {
  sourceId: "ukri-innovate-uk-grants",
  requiredEnv: [],
  async run(ctx) {
    let itemsSeen = 0
    let itemsNew = 0
    let skippedNoCompany = 0
    let pagesRead = 0

    for (let page = 1; page <= MAX_PAGES; page++) {
      if (Date.now() > ctx.deadline) {
        ctx.log(`Stopped after page ${page - 1}: time budget used up.`)
        break
      }

      const result = await fetchPage(page)
      pagesRead++
      const projects = result.project ?? []
      const signals = projects.map(toSignal).filter((signal) => signal !== null)
      skippedNoCompany += projects.length - signals.length

      const { inserted } = await ctx.saveSignals(signals)
      itemsSeen += signals.length
      itemsNew += inserted
      ctx.log(`Page ${page}: ${projects.length} projects, ${signals.length} with a company, ${inserted} new.`)

      if (page >= result.totalPages) break
      // Past the first page, a page with nothing new means the rest is old news.
      if (page > 1 && inserted === 0) break
    }

    const parts = [`${itemsNew} new grant${itemsNew === 1 ? "" : "s"} from ${pagesRead} page${pagesRead === 1 ? "" : "s"}`]
    let match: Awaited<ReturnType<typeof matchCompanyNames>> | undefined
    let enrich: Awaited<ReturnType<typeof enrichCompanies>> | undefined

    const apiKey = readKey("COMPANIES_HOUSE_API_KEY")
    if (apiKey) {
      // Half the time left matches names; enriching gets the rest, including
      // whatever matching did not need.
      match = await matchCompanyNames(ctx, apiKey, Date.now() + (ctx.deadline - Date.now()) / 2)
      enrich = await enrichCompanies(ctx, apiKey, ctx.deadline)
      parts.push(`${match.matched} of ${match.searched} names matched at Companies House`)
      parts.push(`${enrich.fetched} companies looked up`)
      const left = match.remaining + enrich.remaining
      if (left > 0) parts.push(`${left} still to match or look up`)
    } else {
      parts.push("COMPANIES_HOUSE_API_KEY is not set, so companies were not matched at Companies House")
    }

    return {
      itemsSeen,
      itemsNew,
      message: `${parts.join(", ")}.`,
      stats: { pagesRead, skippedNoCompany, match, enrich },
    }
  },
}
