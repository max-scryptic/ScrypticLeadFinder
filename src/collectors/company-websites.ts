import { promises as dns } from "node:dns"

import { db } from "@/lib/db"
import { siteUrl } from "@/lib/site"

/*
 * Each lead company's website, which Companies House does not record. Two ways
 * to find one, cheapest first:
 *   1. Guess domains from the registered name ("Pyroptik Instruments Limited"
 *      gives pyroptikinstruments.co.uk, pyroptik.com, ...), keep the ones that
 *      resolve in DNS and read them.
 *   2. Search Brave for the name and read the top results that are not
 *      directories or social networks.
 * A site only counts when one of its pages (the homepage, then its privacy,
 * terms, about or contact pages) proves it is the company's, strongest first:
 *   - "company-number": the company number, which UK companies must show on
 *     their websites
 *   - "registered-name": the name followed by "Ltd" or "Limited", as in a
 *     copyright line
 *   - "brand-name": the domain spells the whole name ("EnergyBid Limited" on
 *     energybid.io) and the page shows it. Pre-launch sites often show
 *     nothing more. Weaker, so the Leads page marks it as likely.
 * So a guessed domain that belongs to someone else, or a parked one, is not taken.
 *
 * Only companies the lead rules do not exclude are looked up: those whose
 * officers have been fetched (company-history.ts leaves excluded ones null).
 * A company with no site found is looked up again after RECHECK_DAYS, since
 * many get one after raising.
 *
 * Brave: https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
 */

// Bump when what is stored changes, so companies are looked up again.
const FINDER_VERSION = 1

const RECHECK_DAYS = 60

// Brave gives $5 of credit a month, about 1,000 searches. Staying under it
// keeps the account free. BRAVE_MONTHLY_SEARCHES overrides.
const DEFAULT_MONTHLY_SEARCHES = 900

// Brave's lowest plan allows one request a second.
const SEARCH_SPACING_MS = 1100

// Companies looked up at once. Each waits mostly on DNS and slow sites.
const CONCURRENCY = 4

const FETCH_TIMEOUT_MS = 8000
const DNS_TIMEOUT_MS = 3000
const MAX_HTML_CHARS = 1_000_000
// Kept per company for judging fit later; a homepage and a few legal pages fit easily.
const MAX_PAGE_TEXT_CHARS = 20_000
// A slow company takes about a minute: several sites and their legal pages at the fetch timeout.
const COMPANY_RESERVE_MS = 60_000

const GUESS_TLDS = ["co.uk", "com", "io", "ai", "uk"]
const SEARCH_RESULTS_READ = 4

// Shorter names ("Waer", "Acme") are too likely to be someone else's brand.
const MIN_BRAND_LABEL = 6

// Country domains a UK company plausibly uses. A brand match on any other
// (jagfinance.com.au, microendo.com.mx) is a namesake abroad.
const HOME_COUNTRY_TLDS = new Set(["uk", "io", "ai", "co", "me", "tv", "gg", "je", "im"])

// Second-level labels that make a three-part registrable domain: example.co.uk, example.com.au.
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "ltd", "plc", "me"])

const USER_AGENT = `Mozilla/5.0 (compatible; ScrypticLeadFinder/1.0; +${siteUrl.origin})`

// Words dropped from the end of a name to get its brand: "Acme Technologies UK" is acme.com.
const GENERIC_WORDS = new Set([
  "uk", "gb", "group", "holdings", "holding", "company", "co", "international", "global",
  "technologies", "technology", "tech", "solutions", "services", "labs", "ventures", "enterprises",
])

// Search results on these hosts are about the company, not by it.
const DIRECTORY_HOSTS = [
  "gov.uk", "opencorporates.com", "endole.co.uk", "companycheck.co.uk", "bizdb.co.uk", "ukbizdb.com",
  "companiesintheuk.co.uk", "checkcompany.co.uk", "companieslist.co.uk", "northdata.com", "northdata.de", "dnb.com",
  "zoominfo.com", "rocketreach.co", "apollo.io", "crunchbase.com", "pitchbook.com", "cbinsights.com", "tracxn.com",
  "beauhurst.com", "dealroom.co", "thegazette.co.uk", "ukri.org", "linkedin.com", "facebook.com", "instagram.com",
  "x.com", "twitter.com", "youtube.com", "tiktok.com", "reddit.com", "medium.com", "github.com", "wikipedia.org",
  "bloomberg.com", "glassdoor.com", "glassdoor.co.uk", "indeed.com", "indeed.co.uk", "yell.com", "trustpilot.com",
  "amazon.com", "amazon.co.uk",
]

// A domain for sale or parked by a registrar says nothing about who owns it.
// "Launching soon" placeholders are kept: they are usually the company's own.
const FOR_SALE =
  /\b(this )?domain\b.{0,40}\b(is|may be) for sale\b|\bbuy (this|the) domain\b|\bdomain (name )?(is )?parked\b|\bparked (free|domain)\b|\b(hugedomains|afternic|sedo|dan\.com|undeveloped\.com)\b/i

// Links on a homepage worth reading for the company number.
const LEGAL_LINK = /privacy|terms|legal|imprint|impressum|contact|about|company/i
const LEGAL_PAGES_READ = 3

export const evidenceKinds = ["company-number", "registered-name", "brand-name"] as const
export type Evidence = (typeof evidenceKinds)[number]

type Company = { company_number: string; name: string }

type Page = { url: string; html: string; text: string }

export type FoundSite = { url: string; title: string | null; evidence: Evidence; pageText: string }

/** The registered name without its legal suffix: "Pyroptik Instruments Limited" is "Pyroptik Instruments". */
export function baseName(name: string) {
  return name
    .trim()
    .replace(/[\s,.]+(limited|ltd\.?|llp|l\.l\.p\.?|plc|cic|c\.i\.c\.?)$/i, "")
    .trim()
}

/** The name as lower-case domain words: "The Bright & Co UK Ltd" is bright, and, co, uk. */
function nameWords(name: string) {
  const words = baseName(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  while (words.length > 1 && (words[0] === "the" || words[0] === "and")) words.shift()
  return words
}

/** Domain labels that spell the whole name, with or without a trailing "UK". */
function fullNameLabels(name: string) {
  const words = nameWords(name)
  const withoutCountry = words.length > 1 && /^(uk|gb)$/.test(words[words.length - 1]) ? words.slice(0, -1) : words
  return [...new Set([words.join(""), withoutCountry.join(""), words.join("-"), withoutCountry.join("-")])]
}

/** Domains to try for a company, most likely first. */
export function guessDomains(name: string) {
  const brand = nameWords(name)
  while (brand.length > 1 && GENERIC_WORDS.has(brand[brand.length - 1])) brand.pop()
  const labels = [...fullNameLabels(name), brand.join(""), brand.join("-")]
  if (brand.length > 1 && brand[0].length >= 4) labels.push(brand[0])
  const unique = [...new Set(labels)].filter((label) => label.length >= 3 && label.length <= 63)
  return unique.flatMap((label) => GUESS_TLDS.map((tld) => `${label}.${tld}`))
}

const ENTITIES: Record<string, string> = {
  amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", copy: "(c)", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'",
}

/** The visible text of an HTML page, whitespace collapsed. */
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === "#") {
        const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : " "
      }
      return ENTITIES[code.toLowerCase()] ?? entity
    })
    .replace(/\s+/g, " ")
    .trim()
}

/** The domain a host was registered under: docs.example.co.uk is example.co.uk. */
export function registrableDomain(host: string) {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".")
  const parts = labels.length >= 3 && labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!) ? 3 : 2
  return labels.slice(-parts).join(".")
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * What on a page, found at `host`, shows it is the company's (see the top of
 * this file). The number may be written with spaces ("1234 5678") or without
 * its leading zeros.
 */
export function evidenceIn(text: string, company: Company, host: string): Evidence | null {
  const joined = text.replace(/(?<=\d)\s+(?=\d)/g, "")
  const [, prefix = "", digits = ""] = /^([A-Z]{2})?0*(\d+)$/i.exec(company.company_number.trim()) ?? []
  if (digits.length >= 5) {
    const number = new RegExp(`(?<![A-Za-z0-9])${prefix ? `${prefix}\\s*` : ""}0*${digits}(?!\\d)`, "i")
    if (number.test(joined)) return "company-number"
  }

  const words = baseName(company.name)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (/^(&|and)$/i.test(word) ? "(?:&|and)" : escapeRegExp(word)))
  if (words.length === 0) return null
  const name = `(?<![a-z0-9])${words.join("[\\s-]*")}`
  if (new RegExp(`${name}\\s*,?\\s*(?:ltd|limited)(?![a-z])`, "i").test(text)) return "registered-name"

  // The domain must be the company's whole name, either before the ending
  // (energybid.io) or running into it (oceanos.earth for Oceanos Earth),
  // and the page must show that name, or the part before the ending.
  const domain = registrableDomain(host)
  const [label, ...ending] = domain.split(".")
  const tld = ending.at(-1)
  if (!tld || (tld.length === 2 && !HOME_COUNTRY_TLDS.has(tld)) || label.replace(/-/g, "").length < MIN_BRAND_LABEL) {
    return null
  }
  const labels = fullNameLabels(company.name)
  if (labels.includes(label)) return new RegExp(`${name}(?![a-z0-9])`, "i").test(text) ? "brand-name" : null
  const shown = new RegExp(`(?<![a-z0-9])${escapeRegExp(label)}(?![a-z0-9])`, "i")
  return ending.length === 1 && labels.includes(label + ending[0]) && shown.test(text) ? "brand-name" : null
}

function strongest(a: Evidence | null, b: Evidence | null) {
  if (!a || !b) return a ?? b
  return evidenceKinds.indexOf(a) <= evidenceKinds.indexOf(b) ? a : b
}

function titleOf(html: string) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = match ? htmlToText(match[1]) : ""
  return title || null
}

/** Same-site links from a page to its privacy, terms, about or contact pages. */
function legalLinks(page: Page) {
  const base = new URL(page.url)
  const links = new Set<string>()
  for (const match of page.html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)/gi)) {
    let link: URL
    try {
      link = new URL(match[1], base)
    } catch {
      continue
    }
    if (link.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue
    if (!/^https?:$/.test(link.protocol) || !LEGAL_LINK.test(link.pathname)) continue
    link.search = ""
    if (link.href !== page.url) links.add(link.href)
  }
  return [...links].slice(0, LEGAL_PAGES_READ)
}

/** A page's HTML, following redirects and one meta refresh (how many domain forwards work). */
async function fetchPage(url: string, refreshes = 1): Promise<Page | null> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    })
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("html")) {
      await response.body?.cancel()
      return null
    }
    const html = (await response.text()).slice(0, MAX_HTML_CHARS)
    const refresh = /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']\s*\d*\s*;?\s*url\s*=\s*([^"'>\s]+)/i.exec(html)
    if (refresh && refreshes > 0) return fetchPage(new URL(refresh[1], response.url).href, refreshes - 1)
    return { url: response.url, html, text: htmlToText(html) }
  } catch {
    // Unreachable, timed out, bad certificate: not this company's site, or not one we can read.
    return null
  }
}

/** Reads a site's homepage, then its legal pages until one shows the company number. */
async function checkSite(startUrl: string, company: Company): Promise<FoundSite | null> {
  const home = await fetchPage(startUrl)
  if (!home || FOR_SALE.test(home.text)) return null
  const host = new URL(home.url).hostname
  const pages = [home]
  let evidence = evidenceIn(home.text, company, host)
  if (evidence !== "company-number") {
    for (const link of legalLinks(home)) {
      const page = await fetchPage(link)
      if (!page) continue
      pages.push(page)
      evidence = strongest(evidence, evidenceIn(page.text, company, host))
      if (evidence === "company-number") break
    }
  }
  if (!evidence) return null
  return {
    url: new URL(home.url).origin,
    title: titleOf(home.html),
    evidence,
    pageText: pages.map((page) => `[${page.url}] ${page.text}`).join("\n\n").slice(0, MAX_PAGE_TEXT_CHARS),
  }
}

async function resolves(host: string) {
  try {
    await Promise.race([
      dns.lookup(host),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), DNS_TIMEOUT_MS)),
    ])
    return true
  } catch {
    return false
  }
}

/** The first guessed domain whose site proves it is the company's. Tried in order, DNS first. */
async function findByGuess(company: Company, tried: Set<string>) {
  const domains = guessDomains(company.name)
  const reachable = await Promise.all(
    domains.map(async (domain) => ((await resolves(domain)) ? domain : (await resolves(`www.${domain}`)) ? `www.${domain}` : null)),
  )
  for (const host of reachable) {
    if (!host) continue
    tried.add(host.replace(/^www\./, ""))
    const site = await checkSite(`https://${host}/`, company)
    if (site) return site
  }
  return null
}

function isDirectory(host: string) {
  return DIRECTORY_HOSTS.some((directory) => host === directory || host.endsWith(`.${directory}`))
}

// Fails the run rather than one company: every search after it would fail too.
class BadSearchKey extends Error {}

type SearchOutcome = { hosts: string[] } | { stop: string } | { retry: string }

async function braveSearch(key: string, query: string): Promise<SearchOutcome> {
  const params = new URLSearchParams({ q: query, country: "GB", count: "10" })
  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { accept: "application/json", "x-subscription-token": key },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  // A spending limit set in the Brave dashboard, the monthly credit running
  // out and the per-second limit all end searching for this run. Which status
  // a spent quota gets is not documented, so its error code decides.
  if ([401, 402, 403, 429].includes(response.status)) {
    const body = await response.text()
    const code = /"code"\s*:\s*"([A-Z_]+)"/.exec(body)?.[1] ?? "no error code"
    if (response.status !== 401 && (response.status !== 403 || /LIMIT|QUOTA/.test(code))) {
      return { stop: `Brave returned HTTP ${response.status} (${code})` }
    }
    throw new BadSearchKey(`Brave rejected BRAVE_SEARCH_API_KEY (HTTP ${response.status}, ${code}).`)
  }
  if (!response.ok) {
    await response.body?.cancel()
    return { retry: `Brave search failed (HTTP ${response.status})` }
  }
  const body = (await response.json()) as { web?: { results?: { url?: string }[] } }
  const hosts: string[] = []
  for (const result of body.web?.results ?? []) {
    let host: string
    try {
      host = new URL(result.url ?? "").hostname.toLowerCase().replace(/^www\./, "")
    } catch {
      continue
    }
    if (!isDirectory(host) && !hosts.includes(host)) hosts.push(host)
  }
  return { hosts }
}

/**
 * Looks up websites for lead companies with none checked yet, newest signal
 * first, until the deadline. Searches Brave only when BRAVE_SEARCH_API_KEY is
 * set and this month's searches are under the allowance.
 */
export async function findCompanyWebsites(log: (message: string) => void, deadline: number) {
  const sql = db()
  const key = process.env.BRAVE_SEARCH_API_KEY || null
  const allowance = Number(process.env.BRAVE_MONTHLY_SEARCHES) || DEFAULT_MONTHLY_SEARCHES
  const [{ used }] = (await sql.query(
    "SELECT count(*)::int AS used FROM company_websites WHERE searched_at >= date_trunc('month', now())",
  )) as { used: number }[]
  let searchesLeft = key ? Math.max(0, allowance - used) : 0
  if (!key) log("BRAVE_SEARCH_API_KEY is not set: guessing domains only.")
  else if (searchesLeft === 0) log(`This month's ${allowance} Brave searches are used: guessing domains only.`)

  // A company with no site that was never searched for (no key yet, or the
  // allowance was used up) is looked up again as soon as searching is possible.
  const pending = (await sql.query(
    `SELECT c.company_number, c.name
       FROM companies c
       JOIN (SELECT company_number, max(first_seen_at) AS last_seen FROM signals
              WHERE first_seen_at > now() - interval '365 days' GROUP BY company_number) s
         ON s.company_number = c.company_number
       LEFT JOIN company_websites w ON w.company_number = c.company_number
      WHERE c.found AND c.officers IS NOT NULL AND c.name IS NOT NULL
        AND (w.company_number IS NULL OR w.finder_version < $1
             OR (w.url IS NULL AND w.checked_at < now() - make_interval(days => $2))
             OR (w.url IS NULL AND w.searched_at IS NULL AND $3))
      ORDER BY (w.company_number IS NULL) DESC, s.last_seen DESC
      LIMIT 1000`,
    [FINDER_VERSION, RECHECK_DAYS, searchesLeft > 0],
  )) as Company[]

  const counts = { guess: 0, search: 0, none: 0, failed: 0, searches: 0 }
  let next = 0
  let done = 0
  let nextSearchAt = 0
  let stopped = false
  let stopReason = pending.length === 0 ? "nothing to do" : "all done"

  // Waits for this worker's turn at Brave. Slots are handed out before any
  // wait, so concurrent workers stay a spacing apart.
  async function search(query: string) {
    const slot = Math.max(Date.now(), nextSearchAt)
    nextSearchAt = slot + SEARCH_SPACING_MS
    await new Promise((resolve) => setTimeout(resolve, slot - Date.now()))
    return braveSearch(key!, query)
  }

  async function lookUp(company: Company) {
    const tried = new Set<string>()
    let site = await findByGuess(company, tried)
    let method: "guess" | "search" | null = site ? "guess" : null
    let searched = false

    if (!site && searchesLeft > 0) {
      searchesLeft--
      const outcome = await search(`"${baseName(company.name)}"`)
      if ("stop" in outcome) {
        if (!stopped) log(`${outcome.stop}: no more searches this run.`)
        stopped = true
        searchesLeft = 0
      } else if ("retry" in outcome) {
        log(`${company.company_number}: ${outcome.retry}, will retry next run.`)
        return
      } else {
        searched = true
        counts.searches++
        // A result on docs.example.com or a single page is checked from the
        // site's own homepage first, then from where the result was.
        // Hosts guessing already read are skipped, but not their subdomains.
        const domains = [...new Set(outcome.hosts.map(registrableDomain))]
        for (const domain of domains.slice(0, SEARCH_RESULTS_READ)) {
          const hosts = [domain, ...outcome.hosts.filter((host) => host !== domain && registrableDomain(host) === domain)]
          for (const host of hosts.filter((host) => !tried.has(host))) {
            site = await checkSite(`https://${host}/`, company)
            if (site) break
          }
          // Proved on help.example.com: the homepage, when it loads, is the better link.
          if (site && registrableDomain(new URL(site.url).hostname) === domain && new URL(site.url).hostname !== domain) {
            const home = await fetchPage(`https://${domain}/`)
            if (home && registrableDomain(new URL(home.url).hostname) === domain) {
              site = {
                ...site,
                url: new URL(home.url).origin,
                title: titleOf(home.html) ?? site.title,
                pageText: `[${home.url}] ${home.text}\n\n${site.pageText}`.slice(0, MAX_PAGE_TEXT_CHARS),
              }
            }
          }
          if (site) {
            method = "search"
            break
          }
        }
      }
    }

    await sql.query(
      `INSERT INTO company_websites (company_number, url, method, evidence, title, page_text, finder_version, checked_at, searched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), CASE WHEN $8 THEN now() END)
       ON CONFLICT (company_number) DO UPDATE
          SET url = EXCLUDED.url, method = EXCLUDED.method, evidence = EXCLUDED.evidence, title = EXCLUDED.title,
              page_text = EXCLUDED.page_text, finder_version = EXCLUDED.finder_version, checked_at = now(),
              searched_at = coalesce(EXCLUDED.searched_at, company_websites.searched_at)`,
      [
        company.company_number,
        site?.url ?? null,
        method,
        site?.evidence ?? null,
        site?.title ?? null,
        site?.pageText ?? null,
        FINDER_VERSION,
        searched,
      ],
    )
    counts[method ?? "none"]++
  }

  async function worker() {
    while (next < pending.length) {
      if (Date.now() + COMPANY_RESERVE_MS > deadline) {
        stopReason = "time budget used up"
        return
      }
      const company = pending[next++]
      try {
        await lookUp(company)
      } catch (error) {
        // One company's failure (a rejected write, a broken page) should not end the run.
        if (error instanceof BadSearchKey) throw error
        counts.failed++
        log(`${company.company_number}: lookup failed, will retry next run. ${error instanceof Error ? error.message : error}`)
      }
      done++
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const remaining = pending.length - done
  log(
    `Found websites for ${counts.guess + counts.search} companies (${counts.guess} by guessing, ${counts.search} by search, ` +
      `${counts.none} none found, ${counts.failed} failed, ${counts.searches} searches, ${remaining} left). Stopped: ${stopReason}.`,
  )
  return { ...counts, remaining, stopReason }
}
