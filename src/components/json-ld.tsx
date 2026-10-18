import type { Graph, Thing, WithContext } from "schema-dts"

import type { PageEntry } from "@/lib/seo"
import {
  breadcrumbJsonLd,
  graph,
  webPageJsonLd,
} from "@/lib/structured-data"

/*
 * Structured data goes out as a plain <script>, not next/script: it is data
 * for crawlers, not code to load. JSON.stringify does not escape "<", so a
 * value containing "</script>" could close the tag early and inject markup;
 * replacing it with its unicode escape keeps the JSON identical to parsers.
 */

type JsonLdProps = {
  data: Graph | WithContext<Thing>
}

export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  )
}

/**
 * WebPage and BreadcrumbList for a registered page, linked to the site-wide
 * Organization and WebSite the root layout emits. Pass extra nodes (an FAQ,
 * an Article, a Product) to describe what else the page shows.
 */
export function PageJsonLd({
  page,
  nodes = [],
}: {
  page: PageEntry
  nodes?: Thing[]
}) {
  const breadcrumb = page.path === "/" ? [] : [breadcrumbJsonLd(page)]

  return <JsonLd data={graph(webPageJsonLd(page), ...breadcrumb, ...nodes)} />
}
