/*
 * Every lead source the app knows about, built or not. The Sources gallery
 * renders this list; a source with status "live" also has a collector in
 * src/collectors that the cron job runs.
 */

export type SourceStatus = "live" | "planned"

export type Source = {
  /** URL slug and the source_id stored on every signal and run. */
  id: string
  name: string
  /** Who publishes the data. */
  provider: string
  status: SourceStatus
  /** One sentence: what a signal from this source tells you about a company. */
  signal: string
  /** How the data is fetched, or would be. */
  access: string
  /** What the collector keeps, or the idea for one. */
  details: string
  homepage: string
}

export const sources = [
  {
    id: "companies-house-sh01",
    name: "Companies House share allotments",
    provider: "Companies House",
    status: "live",
    signal:
      "A young company filed an SH01, meaning it issued new shares. That usually means it just raised money.",
    access: "Companies House Streaming API (filing history), enriched through the REST API.",
    details:
      "Reads every new SH01 filing from the stream, then looks up each company's age, status and SIC codes. Companies incorporated in the last three years are shown by default.",
    homepage: "https://developer.company-information.service.gov.uk/",
  },
  {
    id: "ukri-innovate-uk-grants",
    name: "Innovate UK grant awards",
    provider: "UKRI Gateway to Research",
    status: "live",
    signal:
      "A company won Innovate UK funding for an innovation project, which often has software that has to be built.",
    access: "Gateway to Research public API. No key needed.",
    details:
      "Pulls the newest Innovate UK projects by start date and keeps the ones with a company (not only a university) taking part, with each company's grant offer.",
    homepage: "https://gtr.ukri.org/",
  },
  {
    id: "accelerator-cohorts",
    name: "Accelerator cohorts",
    provider: "YC, Techstars, Antler, Entrepreneur First, Seedcamp",
    status: "planned",
    signal: "Funded early-stage founders, often non-technical, often building an MVP.",
    access: "Scheduled checks of public cohort and portfolio pages.",
    details: "Watch each programme's portfolio page and record companies the first time they appear.",
    homepage: "https://www.ycombinator.com/companies",
  },
  {
    id: "hiring-posts",
    name: "Founding engineer job posts",
    provider: "Wellfound, HN Who's Hiring, job boards",
    status: "planned",
    signal:
      "A company is hiring its first developer or a technical co-founder, the exact problem an MVP studio solves.",
    access: "Job board APIs and the monthly Hacker News thread. LinkedIn only by hand.",
    details: "Match posts for founding engineer, first developer, technical co-founder or a freelance MVP build.",
    homepage: "https://wellfound.com/jobs",
  },
  {
    id: "reddit-communities",
    name: "Founder communities",
    provider: "Reddit, Indie Hackers",
    status: "planned",
    signal: "Founders asking how to get their MVP built.",
    access: "Reddit API, filtered by keyword and then by an LLM.",
    details: "Watch r/startups, r/SaaS and r/Entrepreneur for non-technical founders looking for a build partner.",
    homepage: "https://www.reddit.com/r/startups/",
  },
  {
    id: "companies-house-incorporations",
    name: "New incorporations",
    provider: "Companies House",
    status: "planned",
    signal: "A company now exists. Noisy on its own; best as a starting list to combine with other signals.",
    access: "Companies House REST API advanced search, by incorporation date and SIC code.",
    details: "Daily list of new companies with software and tech SIC codes, checked for a live website.",
    homepage: "https://developer.company-information.service.gov.uk/",
  },
  {
    id: "public-tenders",
    name: "Public sector tenders",
    provider: "Contracts Finder, Find a Tender",
    status: "planned",
    signal: "A public body is buying digital work. Bigger deals with a slower process.",
    access: "Contracts Finder and Find a Tender APIs.",
    details: "Filter notices by software and digital service CPV codes and contract value.",
    homepage: "https://www.contractsfinder.service.gov.uk/",
  },
  {
    id: "startup-databases",
    name: "Startup funding databases",
    provider: "Beauhurst, Crunchbase, Dealroom",
    status: "planned",
    signal: "Pre-filtered funding rounds and startup profiles.",
    access: "Paid APIs.",
    details: "Worth adding once the free sources have proven which signals convert.",
    homepage: "https://www.beauhurst.com/",
  },
] as const satisfies readonly Source[]

export type SourceId = (typeof sources)[number]["id"]

export function getSource(id: string): Source | undefined {
  return sources.find((source) => source.id === id)
}
