# Scryptic Lead Finder

Finds UK companies likely to need an MVP built, by collecting buying signals from public data. Each source has a collector that runs on a schedule; the Sources page (`/sources`) shows every source and the latest signals each one found, and the Leads page (`/leads`) combines them into one scored row per company.

## Leads

`/leads` lists every company with a signal found in the chosen window (30, 90 or 365 days), best first. Each company's signals from all sources are combined, keyed by Companies House number (or by name when a grant company could not be matched).

- **Score** (0 to 100): points for each signal (share allotment, recent filing, cash raised, grant, grant size, active project, lead participant, both kinds of signal), for a young company and for a software, data or R&D SIC code. Share allotments that raised under £1,000 lose points, since they are cap table changes rather than funding rounds. A first funding round gains points, a company that raised a round before loses some, and new articles or share classes filed around the allotment add a few. The "Why" column lists every rule that fired.
- **Cash raised**: read from each SH01 document (shares allotted times the amount paid per share, cash batches only). Scanned paper filings have no text, so their amount stays unknown and does not count for or against the company.
- **First funding round**: a share allotment lead is on its first round when no allotment filed more than 90 days before it raised £10,000 or more in cash. The earlier allotments come from the company's filing history and their own SH01 documents are read the same way. When some of them are scans or not read yet, the flag says so instead of guessing.
- **Decision makers**: the current directors (or LLP members) and the individuals with significant control, merged when one person is both, owners first. Secretaries, nominees, dates of birth and addresses are left out. Email addresses are not on Companies House.
- **Excluded** (hidden unless "Shown"): companies that are not active, dormant, only have holding, property or investment SIC codes, are PLCs, file full, group or medium accounts or are subsidiaries, or were incorporated over 10 years ago.
- **Status**: new, contacted, qualified or rejected, saved per company in `lead_status`.
- **Export CSV**: the same list with the same filters, every row.

The rules are in `src/lib/leads.ts`. Officers, PSCs and filing history are fetched in `src/collectors/company-history.ts`, only for companies the rules do not exclude, and again whenever a company gets a new signal.

## Lead sources

| Source | Status | How |
| --- | --- | --- |
| Companies House share allotments (SH01) | Live | Streaming API filing events, enriched with each company's profile, officers, PSCs and filing history from the REST API and the cash raised from the filing's document (Document API) |
| Innovate UK grant awards | Live | UKRI Gateway to Research API, newest projects by start date; companies matched to Companies House by exact registered name, then enriched like SH01 |
| Accelerators, hiring posts, communities, new incorporations, tenders, paid databases | Planned | Cards on the Sources page; collectors to come |

### Setup

1. Copy `.env.example` to `.env.local` and fill in `DATABASE_URL` (Neon) and the two Companies House keys from the [developer hub](https://developer.company-information.service.gov.uk) (one REST key, one Streaming key).
2. `npm run db:migrate` creates the tables (idempotent).
3. `npm run collect` runs every live collector once; `npm run collect -- ukri-innovate-uk-grants` runs one.

### Scheduling

`.github/workflows/collect.yml` runs `npm run collect` every 3 hours on GitHub Actions, with 15 minutes per collector (the workflow file says why). Add `DATABASE_URL`, `COMPANIES_HOUSE_API_KEY` and `COMPANIES_HOUSE_STREAM_KEY` as repository secrets. Scheduled workflows only run from the default branch. Each source page also has a "Run now" button for a short manual run.

### Adding a collector

1. Write `src/collectors/<name>.ts` exporting a `Collector` (see `types.ts`); call `ctx.saveSignals()` with what it finds and keep any cursor in `ctx.setState()`.
2. Register it in `src/collectors/index.ts` and set the source's `status` to `"live"` in `src/lib/sources.ts`.

## Starter

Built on a Next.js 16 starter with [Base UI](https://base-ui.com) as the only UI primitive layer, styled with Tailwind CSS v4.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Script                     | What it does                          |
| -------------------------- | ------------------------------------- |
| `npm run dev`              | Start the dev server                  |
| `npm run build`            | Production build                      |
| `npm run lint`             | ESLint                                |
| `npm run check:em-dashes`  | Fail if any source file has an em dash |

## Layout

```
src/
  app/                  Routes: / , /login , /signup
    globals.css         Theme tokens (light + .dark) and Tailwind setup
    robots.ts           robots.txt, sitemap.xml, manifest, llms.txt, icons and the
    sitemap.ts            Open Graph image are all generated from src/lib (see
    manifest.ts           "SEO and AEO" below)
    llms.txt/route.ts
    icon.tsx, apple-icon.tsx, opengraph-image.tsx
    not-found.tsx       Branded 404 (replaces Next's default and its "404: ..." title)
    auth/actions.ts     signOut() Server Action: clears the session cookie, redirects to /login
  components/
    ui/                 Generic widgets built on @base-ui/react (Button, Card, DropdownMenu, Field, Input, Label, Separator)
    brand-logo.tsx      Placeholder mark (also drawn into the favicon and share image)
    json-ld.tsx         Safe JSON-LD <script> + per-page WebPage/Breadcrumb graph
    login-form.tsx      Shared login / signup card
    user-menu.tsx       Account menu in the top bar, with sign out
    em-dash-guard.tsx   Dev guard against em dashes in rendered text
  lib/
    site.ts             Brand facts, site URL, indexability
    seo.ts              Page registry + createMetadata()
    structured-data.ts  schema.org builders (Organization, WebSite, WebPage, FAQ, Article, ...)
    em-dash.ts          Em dash helpers used by the guard and the check script
```

## UI conventions

- **Base UI is the primitive layer.** Widgets in `src/components/ui` wrap `@base-ui/react`. Don't add Radix or another headless library next to it.
- **Feature code imports from `@/components/ui/*`**, never from `@base-ui/react` directly, so a widget can be restyled or swapped in one place.
- **Style with theme tokens** (`bg-background`, `text-muted-foreground`, `border-border`, ...) from `globals.css` rather than raw colours, so light and dark mode keep working.
- **One class helper:** `import { cn } from "cn"`.
- **Composition uses `render`, not `asChild`:** `<Button nativeButton={false} render={<Link href="/login" />}>Login</Button>`.

## Adding widgets

`components.json` is set to the `base-nova` style, so the shadcn CLI installs the Base UI version of each component:

```bash
npx shadcn@latest add dialog select tabs
```

Other UI packs that publish a shadcn-compatible registry can be installed the same way, by namespace or by URL:

```bash
npx shadcn@latest add @<registry>/<item>
npx shadcn@latest add https://example.com/r/<item>.json
```

Before adding from another pack, check that it targets Base UI. A Radix-based item brings `radix-ui` back as a dependency.

To try a different look for the built-in widgets, change `style` in `components.json` to another `base-*` style (for example `base-vega`, `base-maia`, `base-lyra`, `base-mira`) and reinstall them with `npx shadcn@latest add <names> --overwrite`.

## SEO and AEO

Search engine (SEO) and answer engine (AEO: ChatGPT, Claude, Perplexity, Google AI Overviews) requirements are built in. What you configure:

1. **`src/lib/site.ts`**: name, one-sentence description, locale, brand colours, Twitter/X handle and every official profile URL (`sameAs`).
2. **`src/components/brand-logo.tsx`**: the mark. The favicon, app icons and share image are drawn from it.
3. **Environment** (see `.env.example`): `NEXT_PUBLIC_SITE_URL` for non-Vercel hosts, and the search console verification tokens.
4. **`pages` in `src/lib/seo.ts`**: one entry per public route.

What you get, all derived from those:

| Concern | Where | Notes |
| --- | --- | --- |
| Title, description, canonical | `createMetadata()`, `pageTitle()` | Titles are pipe-delimited, most specific first: `Login \| Brand`, `Invoice 42 \| Billing \| Brand`. Colons and dashes as separators fail lint and are rewritten at runtime. Canonical is absolute via `metadataBase`. |
| Open Graph + Twitter/X cards | `createMetadata()`, `opengraph-image.tsx` | 1200x630 generated card on every page, `summary_large_image`. |
| Robots meta | `robotsFor()` | `max-snippet:-1`, `max-image-preview:large` so AI Overviews and rich results can quote freely. |
| `robots.txt` | `src/app/robots.ts` | Allows all crawlers, names AI search and AI training bots explicitly (`ALLOW_AI_TRAINING` toggles training only). |
| `sitemap.xml` | `src/app/sitemap.ts` | From the page registry. Only set `lastModified` when you know it. |
| `llms.txt` | `src/app/llms.txt/route.ts` | [llmstxt.org](https://llmstxt.org) map of the site for AI agents, from the same registry. |
| Structured data | `src/lib/structured-data.ts` | Organization + WebSite site-wide, WebPage + BreadcrumbList per page, linked by `@id`. FAQPage and Article builders ready to use. |
| Favicon, app icons, manifest | `icon.tsx`, `apple-icon.tsx`, `manifest.ts` | 192px favicon (Google wants a multiple of 48px), `/favicon.ico` rewritten to it. |
| Search console verification | `GOOGLE_`, `BING_`, `YANDEX_SITE_VERIFICATION` | Rendered as meta tags when set. |
| Preview deployments | `isIndexable` | Anything but Vercel production (or a non-Vercel production build) sends `noindex` in meta, `X-Robots-Tag` and `robots.txt`. |

### Adding a page

```ts
// src/lib/seo.ts
pricing: {
  path: "/pricing",
  title: "Pricing",
  description: "Acme plans start free; paid plans add ... Compare features and limits.",
},
```

```tsx
// src/app/pricing/page.tsx
export const metadata = createMetadata(pages.pricing)

export default function PricingPage() {
  return (
    <main>
      <PageJsonLd page={pages.pricing} nodes={[faqJsonLd(pages.pricing, faqs)]} />
      ...
    </main>
  )
}
```

Titles from data (`generateMetadata` for a post or record) go through `pageTitle()` too: `title: { absolute: pageTitle(post.title, "Blog") }`.

Pages behind auth, or otherwise not worth a search result, get `noIndex: true`: they drop out of the sitemap and `llms.txt` and send `noindex, follow`.

### After launch (outside the code)

- Verify the domain in [Google Search Console](https://search.google.com/search-console) and [Bing Webmaster Tools](https://www.bing.com/webmasters) (ChatGPT search and Copilot draw on Bing's index), and submit `/sitemap.xml` to both.
- Check a page in the [Rich Results Test](https://search.google.com/test/rich-results) and a share link in the X and LinkedIn post inspectors.
- Keep the brand name, description and `sameAs` profiles identical everywhere the brand appears; answer engines reconcile entities across sources.
- Write answer-first copy: one `<h1>` per page, a direct answer under each heading, question-style headings and visible FAQs where people actually ask questions.
