import type { MetadataRoute } from "next"

import { absoluteUrl, isIndexable, siteUrl } from "@/lib/site"

/*
 * AI crawlers are named explicitly even though "*" already allows them: some
 * hosts and CDNs block unknown bots by default, and an explicit group makes the
 * policy obvious to whoever edits this file next.
 *
 * Answer engines fetch pages to cite them in answers. Blocking these removes
 * the site from ChatGPT search, Claude, Perplexity and similar.
 */
const AI_SEARCH_AGENTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "DuckAssistBot",
  "MistralAI-User",
]

/*
 * Model training crawlers. Allowing them is what gets the brand into the
 * models' own knowledge; flip ALLOW_AI_TRAINING to opt out without touching
 * search or answer-engine visibility.
 */
const ALLOW_AI_TRAINING = true
const AI_TRAINING_AGENTS = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot",
  "meta-externalagent",
  "CCBot",
  "cohere-ai",
]

// Paths with nothing worth indexing. Pages that should be crawled but not
// listed belong in the page registry with noIndex instead: a disallowed URL
// is never fetched, so its noindex tag is never seen.
const DISALLOW = ["/api/"]

export default function robots(): MetadataRoute.Robots {
  if (!isIndexable) {
    return { rules: { userAgent: "*", disallow: "/" } }
  }

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      { userAgent: AI_SEARCH_AGENTS, allow: "/", disallow: DISALLOW },
      ALLOW_AI_TRAINING
        ? { userAgent: AI_TRAINING_AGENTS, allow: "/", disallow: DISALLOW }
        : { userAgent: AI_TRAINING_AGENTS, disallow: "/" },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteUrl.host,
  }
}
