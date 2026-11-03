import type { Page } from "@/collectors/company-websites"
import type { SiteDetails, SocialKind, SocialLink } from "@/lib/leads"

/*
 * What a lead company's website says beyond proving it is theirs: how to
 * contact them, where else they are online, what the site is built with and
 * whether the product has launched. Read from the HTML of the pages
 * company-websites.ts fetched (the homepage first), which is not kept, so it
 * is worked out while the pages are in hand. Plain functions, no fetching.
 */

const MAX_EMAILS = 5
const MAX_PHONES = 3
const MAX_SOCIALS_PER_KIND = 2
// The founders' own profiles are often linked from an about or team page.
const MAX_LINKEDIN = 5
const MAX_APP_LINKS = 2

const EMAIL = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?![a-z0-9-])/gi
// "photo@2x.png" and bundled file names look like addresses.
const FILE_ENDING = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|js|css|map|woff2?)$/i
// Addresses of the site's own tools (error trackers, builders) and template placeholders.
const NOT_THE_COMPANY_DOMAINS = [
  "sentry.io", "wixpress.com", "wix.com", "squarespace.com", "webflow.com", "godaddy.com", "framer.com",
  "example.com", "example.org", "example.co.uk", "domain.com", "yourdomain.com", "yourcompany.com", "company.com",
  "email.com", "mysite.com", "website.com",
  // Regulators named on privacy pages.
  "ico.org.uk", "inforegulator.org.za",
]
// Addresses for something other than a sales conversation, listed last.
const BACK_OFFICE_LOCAL = /^(?:privacy|dpo|gdpr|data|security|legal|compliance|abuse|careers|jobs|accounts|invoices|billing|noreply|no-reply)\b/i
const PLACEHOLDER_LOCAL = /^(?:name|your\.?name|you|user(?:name)?|first\.?last|firstname(?:\.?lastname)?|john\.?doe|jane\.?doe|email|example|test)$/i

// A UK number: +44 or 0, then the 9 or 10 digits of the national number, in any grouping.
const UK_PHONE = /(?<![\d+])(?:\+44\s?(?:\(0\)\s?)?|\(?0)\d[\d\s)-]{7,13}\d(?!\d)/g
// The ICO's helpline, on most privacy pages.
const NOT_THE_COMPANY_PHONES = new Set(["0303 123 1113"])

const SOCIAL_HOSTS: [SocialKind, RegExp][] = [
  ["linkedin", /^(?:[a-z]{2}\.)?linkedin\.com$/],
  ["x", /^(?:mobile\.)?(?:x|twitter)\.com$/],
  ["github", /^github\.com$/],
  ["facebook", /^(?:m\.)?facebook\.com$/],
  ["instagram", /^instagram\.com$/],
  ["youtube", /^(?:m\.)?youtube\.com$/],
  ["tiktok", /^tiktok\.com$/],
]
// Share buttons, tracking and the network's own pages, not a profile.
const NOT_A_PROFILE =
  /^\/(?:share|sharer|sharing|shareArticle|intent|home|login|signup|dialog|plugins|tr|hashtag|search|explore|watch|embed|legal|about|policies|help|privacy|terms)(?:[/.?]|$)/i
// The part of a path that names a profile: /company/acme on LinkedIn, /@acme
// or /channel/... on YouTube, the first segment elsewhere ("/acme/status/1"
// is acme's post). LinkedIn's posts and feeds have no profile part.
const PROFILE_PATH: Partial<Record<SocialKind, RegExp>> = {
  linkedin: /^\/(?:company|in|school|showcase)\/[^/]+/i,
  youtube: /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)/i,
}
const FIRST_SEGMENT = /^\/[^/]+/
// Builders' own profiles, left in a site template's footer.
const BUILDER_HANDLES = new Set([
  "wix", "wix-com", "wixcom", "squarespace", "webflow", "webflowapp", "framer", "framerapp", "godaddy", "wordpress",
  "wordpressdotcom", "shopify", "elementor", "hubspot", "carrd", "hostinger", "weebly",
])

const APP_STORE = /^(?:apps|itunes)\.apple\.com$/
const PLAY_STORE = /^play\.google\.com$/

const LOGIN_TEXT = /^(?:log ?in|sign ?in|member log ?in|client log ?in|customer log ?in|my account)$/i
const LOGIN_PATH = /^\/(?:log-?in|sign-?in|account\/log-?in|auth|dashboard|app)(?:[/?#]|$)/i
const APP_SUBDOMAIN = /^(?:app|dashboard|portal|my|platform|console)\./i

/**
 * What the site is built with, from tell-tale asset hosts and markup, no-code
 * builders first: a company on Bubble or a Wix page has no product team yet.
 * Checked against the homepage's HTML and its generator tag.
 */
const BUILDERS: [string, RegExp][] = [
  ["Bubble", /\bbubble_(?:page_name|version|session_uid)\b|\.bubbleapps\.io\b|\bcdn\.bubble\.io\b/i],
  ["Webflow", /\bdata-wf-(?:site|page)\b|\bwebsite-files\.com\b/i],
  ["Framer", /\bframerusercontent\.com\b|\bdata-framer-/i],
  ["Wix", /\bstatic\.wixstatic\.com\b|\bwix\.com website builder\b/i],
  ["Squarespace", /\bstatic1\.squarespace\.com\b|\bsquarespace-cdn\.com\b/i],
  ["Shopify", /\bcdn\.shopify\.com\b|\bShopify\.theme\b/],
  ["Carrd", /\bcarrd\.co\b/i],
  ["Notion", /\bnotion\.site\b|\bsuper\.so\b/i],
  ["Softr", /\bsoftr\.io\b/i],
  ["GoDaddy", /\bimg1\.wsimg\.com\b/i],
  ["Hostinger", /\bzyrosite\.com\b/i],
  ["Weebly", /\beditmysite\.com\b|\bweebly\.com\b/i],
  ["Duda", /\bmultiscreensite\.com\b|\bcdn-website\.com\b/i],
  ["Ghost", /\bghost\.(?:io|org)\b/i],
  ["WordPress", /\/wp-content\/|\/wp-includes\//i],
  ["Next.js", /\/_next\/static\/|__NEXT_DATA__/],
  ["Nuxt", /\/_nuxt\/|__NUXT__/],
  ["Gatsby", /___gatsby/],
  ["Astro", /<astro-island\b/i],
]

// Phrases a site uses before the product is out. The strong ones count
// anywhere on the homepage; the weak ones ("coming soon" can be about one
// feature) only on a short homepage or in its title.
const PRE_LAUNCH_STRONG =
  /\b(launching soon|under construction|join (?:the|our) wait ?list|wait ?list|(?:get|request|apply for) early access)\b/i
const PRE_LAUNCH_WEAK = /\b(coming soon|stay tuned|be the first to (?:know|hear|try))\b/i
const SHORT_HOMEPAGE_CHARS = 2000

type Anchor = { href: URL; text: string }

/** Every link on a page, resolved against it, with its visible text. */
function anchors(page: Page) {
  const found: Anchor[] = []
  for (const match of page.html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[1])
    const raw = href?.[1] ?? href?.[2]
    if (!raw) continue
    try {
      found.push({ href: new URL(raw.trim().replace(/&amp;/gi, "&"), page.url), text: match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() })
    } catch {
      // A malformed href.
    }
  }
  return found
}

/** An address hidden by Cloudflare's email obfuscation: hex bytes, XORed with the first. */
function decodeCloudflareEmail(hex: string) {
  const key = parseInt(hex.slice(0, 2), 16)
  let decoded = ""
  for (let i = 2; i + 1 < hex.length; i += 2) decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key)
  return decoded
}

/** A percent-encoded part of a link, or the part as it is when its encoding is broken. */
function decoded(part: string) {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

function hostOf(url: URL) {
  return url.hostname.toLowerCase().replace(/^www\./, "")
}

/** True for the domain itself and its subdomains. */
function onDomain(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`)
}

function isCompanyEmail(email: string) {
  const [local, domain] = email.split("@")
  if (!local || !domain || FILE_ENDING.test(email) || PLACEHOLDER_LOCAL.test(local)) return false
  return !NOT_THE_COMPANY_DOMAINS.some((tool) => onDomain(domain, tool))
}

/**
 * Addresses shown or linked on the pages. Only those on the site's own domain
 * when it has any; otherwise others, since a small company often uses a Gmail
 * address or one from a new name. Privacy pages name other companies' (a
 * data protection officer, a processor), which this leaves out when the
 * company has its own.
 */
export function emailsIn(pages: Page[], siteDomain: string) {
  const candidates: string[] = []
  for (const page of pages) {
    for (const anchor of anchors(page)) {
      if (anchor.href.protocol === "mailto:") candidates.push(decoded(anchor.href.pathname))
      const protectedHash = /\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/i.exec(anchor.href.href)
      if (protectedHash) candidates.push(decodeCloudflareEmail(protectedHash[1]))
    }
    for (const match of page.html.matchAll(/\bdata-cfemail\s*=\s*["']([0-9a-f]+)["']/gi)) {
      candidates.push(decodeCloudflareEmail(match[1]))
    }
    // "hello [at] example [dot] com"
    const text = page.text.replace(/\s*[[(]\s*at\s*[\])]\s*/gi, "@").replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, ".")
    candidates.push(...(text.match(EMAIL) ?? []))
  }
  const emails = [
    ...new Set(
      candidates
        .flatMap((candidate) => candidate.match(EMAIL) ?? [])
        .map((email) => email.toLowerCase())
        .filter(isCompanyEmail),
    ),
  ]
  // cfpsychology.co.uk on cfpsychology.com is the same company.
  const label = siteDomain.split(".")[0]
  const onSite = (email: string) => {
    const domain = email.split("@")[1]
    return onDomain(domain, siteDomain) || domain.split(".")[0] === label
  }
  const own = emails.filter(onSite)
  const kept = own.length > 0 ? own : emails
  const backOffice = (email: string) => BACK_OFFICE_LOCAL.test(email)
  return [...kept.filter((email) => !backOffice(email)), ...kept.filter(backOffice)].slice(0, MAX_EMAILS)
}

/** A UK number in national format ("020 7946 0000", "07700 900123"), or null when it is not one. */
export function ukPhone(raw: string) {
  const digits = raw.replace(/\D/g, "")
  const national = digits.startsWith("44") && raw.trim().startsWith("+") ? digits.slice(2).replace(/^0/, "") : digits.replace(/^0/, "")
  if (!(digits.startsWith("0") || raw.trim().startsWith("+44"))) return null
  if (national.length !== 10 && !(national.length === 9 && national.startsWith("1"))) return null
  if (!/^[12378]/.test(national)) return null
  const number = `0${national}`
  if (national.startsWith("2")) return `${number.slice(0, 3)} ${number.slice(3, 7)} ${number.slice(7)}`
  if (/^(?:1\d1|11\d|3|8)/.test(national)) return `${number.slice(0, 4)} ${number.slice(4, 7)} ${number.slice(7)}`
  return `${number.slice(0, 5)} ${number.slice(5)}`
}

/** UK phone numbers linked (tel:) or shown on the pages, linked ones first. */
export function phonesIn(pages: Page[]) {
  const linked = pages.flatMap((page) =>
    anchors(page)
      .filter((anchor) => anchor.href.protocol === "tel:")
      .map((anchor) => decoded(anchor.href.pathname)),
  )
  const shown = pages.flatMap((page) => page.text.match(UK_PHONE) ?? [])
  const phones = [...linked, ...shown].map(ukPhone).filter((phone): phone is string => phone !== null)
  return [...new Set(phones)].filter((phone) => !NOT_THE_COMPANY_PHONES.has(phone)).slice(0, MAX_PHONES)
}

/** Profile links on the pages: the company's (or its founders') LinkedIn, X, GitHub and so on. */
export function socialsIn(pages: Page[]) {
  const socials: SocialLink[] = []
  const seen = new Set<string>()
  for (const anchor of pages.flatMap(anchors)) {
    if (!/^https?:$/.test(anchor.href.protocol)) continue
    const host = hostOf(anchor.href)
    const kind = SOCIAL_HOSTS.find(([, pattern]) => pattern.test(host))?.[0]
    if (!kind || NOT_A_PROFILE.test(anchor.href.pathname)) continue
    const path = (PROFILE_PATH[kind] ?? FIRST_SEGMENT).exec(anchor.href.pathname.replace(/(?:%20|\s)+/g, ""))?.[0]
    if (!path || BUILDER_HANDLES.has(path.split("/").at(-1)!.replace(/^@/, "").toLowerCase())) continue
    // Facebook pages without a name are /profile.php?id=...
    const id = path === "/profile.php" ? anchor.href.searchParams.get("id") : null
    if (path === "/profile.php" && !id) continue
    const canonicalHost = host.replace(/^[a-z]{2}\.linkedin/, "linkedin").replace(/^(?:mobile|m)\./, "").replace(/^twitter\.com$/, "x.com")
    const url = `https://${canonicalHost}${path}${id ? `?id=${encodeURIComponent(id)}` : ""}`
    const key = url.toLowerCase()
    const limit = kind === "linkedin" ? MAX_LINKEDIN : MAX_SOCIALS_PER_KIND
    if (seen.has(key) || socials.filter((social) => social.kind === kind).length >= limit) continue
    seen.add(key)
    socials.push({ kind, url })
  }
  return socials
}

/** App Store and Google Play listings linked from the pages. */
export function appLinksIn(pages: Page[]) {
  const links = pages.flatMap(anchors).flatMap(({ href }) => {
    const host = hostOf(href)
    if (APP_STORE.test(host) && /\/app\//.test(href.pathname)) return [`https://apps.apple.com${href.pathname.replace(/\/+$/, "")}`]
    const id = href.searchParams.get("id")
    if (PLAY_STORE.test(host) && href.pathname.startsWith("/store/apps/details") && id) {
      return [`https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}`]
    }
    return []
  })
  return [...new Set(links)].slice(0, MAX_APP_LINKS)
}

/** A link to log in to the product, which a company with something live usually has. */
export function loginUrlIn(pages: Page[], siteDomain: string) {
  for (const { href, text } of pages.flatMap(anchors)) {
    if (!/^https?:$/.test(href.protocol)) continue
    const host = hostOf(href)
    const ownSite = onDomain(host, siteDomain)
    if (LOGIN_TEXT.test(text) || (ownSite && (LOGIN_PATH.test(href.pathname) || APP_SUBDOMAIN.test(host)))) {
      if (SOCIAL_HOSTS.some(([, pattern]) => pattern.test(host))) continue
      href.hash = ""
      return href.href
    }
  }
  return null
}

/** What the homepage is built with, or null when nothing gives it away. */
export function builderOf(home: Page) {
  const generator =
    /<meta\b[^>]*\bname\s*=\s*["']generator["'][^>]*\bcontent\s*=\s*["']([^"']+)/i.exec(home.html)?.[1] ??
    /<meta\b[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bname\s*=\s*["']generator["']/i.exec(home.html)?.[1]
  const named = generator && BUILDERS.find(([name]) => new RegExp(`\\b${name.replace(".", "\\.")}\\b`, "i").test(generator))
  if (named) return named[0]
  return BUILDERS.find(([, pattern]) => pattern.test(home.html))?.[0] ?? null
}

/** The phrase on the homepage that says the product is not out yet, such as "coming soon", or null. */
export function preLaunchPhrase(home: Page, title: string | null) {
  const strong = PRE_LAUNCH_STRONG.exec(home.text)?.[1]
  if (strong) return strong.toLowerCase()
  const weak = PRE_LAUNCH_WEAK.exec(title ?? "")?.[1] ?? (home.text.length <= SHORT_HOMEPAGE_CHARS ? PRE_LAUNCH_WEAK.exec(home.text)?.[1] : null)
  return weak ? weak.toLowerCase() : null
}

/** Everything above for a site, from its pages (the homepage first) and the domain it was registered under. */
export function siteDetails(pages: Page[], siteDomain: string, title: string | null): SiteDetails {
  const home = pages[0]
  return {
    emails: emailsIn(pages, siteDomain),
    phones: phonesIn(pages),
    socials: socialsIn(pages),
    appLinks: appLinksIn(pages),
    loginUrl: loginUrlIn(pages, siteDomain),
    builder: builderOf(home),
    preLaunch: preLaunchPhrase(home, title),
  }
}
