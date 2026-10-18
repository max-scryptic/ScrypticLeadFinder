/*
 * Single source of truth for who the site is and where it lives. Metadata,
 * the sitemap, robots.txt, llms.txt, the web manifest, generated icons and
 * JSON-LD all read from here, so rebranding is an edit to this file (plus the
 * mark in brand-logo.tsx) rather than a hunt through the app.
 */

export const siteConfig = {
  name: "Acme Inc.",
  shortName: "Acme",
  // Used as the default meta description, og:description and the llms.txt
  // summary. Aim for one plain sentence of 120 to 160 characters that says what
  // the product is and who it is for: answer engines quote it verbatim.
  description:
    "Acme Inc. is a placeholder product description. Replace it with one clear sentence that says what you do and who it is for.",
  // Optional longer context for llms.txt. Leave empty to omit.
  summary: "",
  keywords: [] as string[],
  locale: "en_US",
  language: "en",
  // Keep these in step with --background and --primary in globals.css.
  // Generated images cannot read CSS variables and do not understand oklch.
  colors: {
    background: "#ffffff",
    primary: "#171717",
    primaryForeground: "#fafafa",
    muted: "#f5f5f5",
    mutedForeground: "#737373",
  },
  organization: {
    legalName: "Acme Inc.",
    email: "",
    foundingDate: "",
  },
  // Handle including the @, for twitter:site and twitter:creator.
  twitterHandle: "",
  // Every official profile (X, LinkedIn, GitHub, YouTube, Crunchbase,
  // Wikipedia, ...). Emitted as schema.org sameAs, which is how search and
  // answer engines tie the brand to one entity.
  sameAs: [] as string[],
} as const

function resolveSiteUrl() {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit

  // Vercel system environment variables. Production points at the real domain
  // so canonicals and og:url are right even before NEXT_PUBLIC_SITE_URL is set;
  // previews point at themselves so shared links render their own OG image.
  const vercelHost =
    process.env.VERCEL_ENV === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL
  if (vercelHost) return `https://${vercelHost}`

  return `http://localhost:${process.env.PORT ?? 3000}`
}

export const siteUrl = new URL(resolveSiteUrl())

/**
 * Whether search engines may index this deployment. Only production is
 * indexable: preview and local builds send noindex everywhere (meta tag,
 * X-Robots-Tag header and robots.txt) so they never compete with the real
 * site. Set SITE_NOINDEX=1 to block a production deployment as well, for
 * example a staging host outside Vercel.
 */
export const isIndexable =
  process.env.SITE_NOINDEX !== "1" &&
  (process.env.VERCEL_ENV
    ? process.env.VERCEL_ENV === "production"
    : process.env.NODE_ENV === "production")

export function absoluteUrl(path = "/") {
  return new URL(path, siteUrl).toString()
}
