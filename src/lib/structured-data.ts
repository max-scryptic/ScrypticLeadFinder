import type {
  Article,
  BreadcrumbList,
  FAQPage,
  Graph,
  Organization,
  Thing,
  WebPage,
  WebSite,
} from "schema-dts"

import { pages, type PageEntry } from "@/lib/seo"
import { absoluteUrl, siteConfig } from "@/lib/site"

/*
 * schema.org builders. Search engines use JSON-LD for rich results; answer
 * engines use it to resolve who said what. Every node gets a stable @id so the
 * root layout's Organization and WebSite can be referenced from each page's
 * graph instead of being repeated.
 *
 * Only describe what is visible on the page. Markup for content a reader
 * cannot see is a spam signal and makes the page ineligible for rich results.
 */

export const ids = {
  organization: absoluteUrl("/#organization"),
  website: absoluteUrl("/#website"),
  logo: absoluteUrl("/#logo"),
  webPage: (path: string) => `${absoluteUrl(path)}#webpage`,
  breadcrumb: (path: string) => `${absoluteUrl(path)}#breadcrumb`,
}

const optional = <T extends object>(value: unknown, fields: T) =>
  value && (!Array.isArray(value) || value.length > 0) ? fields : {}

export function organizationJsonLd(): Organization {
  const { organization } = siteConfig

  return {
    "@type": "Organization",
    "@id": ids.organization,
    name: siteConfig.name,
    url: absoluteUrl("/"),
    description: siteConfig.description,
    logo: {
      "@type": "ImageObject",
      "@id": ids.logo,
      url: absoluteUrl("/icon"),
      width: "192",
      height: "192",
      caption: siteConfig.name,
    },
    ...optional(organization.legalName, { legalName: organization.legalName }),
    ...optional(organization.email, { email: organization.email }),
    ...optional(organization.foundingDate, {
      foundingDate: organization.foundingDate,
    }),
    ...optional(siteConfig.sameAs, { sameAs: [...siteConfig.sameAs] }),
  }
}

export function websiteJsonLd(): WebSite {
  return {
    "@type": "WebSite",
    "@id": ids.website,
    name: siteConfig.name,
    alternateName: siteConfig.shortName,
    url: absoluteUrl("/"),
    description: siteConfig.description,
    inLanguage: siteConfig.language,
    publisher: { "@id": ids.organization },
  }
}

export function breadcrumbJsonLd(page: PageEntry): BreadcrumbList {
  const trail = [pages.home, ...(page.parents ?? []), page].filter(
    (entry, index, all) => all.findIndex((e) => e.path === entry.path) === index,
  )

  return {
    "@type": "BreadcrumbList",
    "@id": ids.breadcrumb(page.path),
    itemListElement: trail.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.title,
      item: absoluteUrl(entry.path),
    })),
  }
}

export function webPageJsonLd(page: PageEntry): WebPage {
  return {
    "@type": "WebPage",
    "@id": ids.webPage(page.path),
    url: absoluteUrl(page.path),
    name: page.title,
    description: page.description,
    inLanguage: siteConfig.language,
    isPartOf: { "@id": ids.website },
    about: { "@id": ids.organization },
    ...optional(page.path !== "/", {
      breadcrumb: { "@id": ids.breadcrumb(page.path) },
    }),
    ...(page.lastModified
      ? { dateModified: new Date(page.lastModified).toISOString() }
      : {}),
  }
}

/**
 * Pair with a visible FAQ section that shows exactly these questions and
 * answers. Question-and-answer blocks are the format answer engines lift most
 * readily, even where Google no longer shows the FAQ rich result.
 */
export function faqJsonLd(
  page: PageEntry,
  items: { question: string; answer: string }[],
): FAQPage {
  return {
    "@type": "FAQPage",
    "@id": `${absoluteUrl(page.path)}#faq`,
    isPartOf: { "@id": ids.webPage(page.path) },
    mainEntity: items.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  }
}

/** For blog posts, guides and docs. Real dates and a named author matter. */
export function articleJsonLd(
  page: PageEntry,
  article: {
    headline?: string
    datePublished: string
    dateModified?: string
    authorName: string
    authorUrl?: string
    image?: string
  },
): Article {
  return {
    "@type": "Article",
    "@id": `${absoluteUrl(page.path)}#article`,
    headline: article.headline ?? page.title,
    description: page.description,
    mainEntityOfPage: { "@id": ids.webPage(page.path) },
    datePublished: article.datePublished,
    dateModified: article.dateModified ?? article.datePublished,
    author: {
      "@type": "Person",
      name: article.authorName,
      ...optional(article.authorUrl, { url: article.authorUrl }),
    },
    publisher: { "@id": ids.organization },
    image: absoluteUrl(article.image ?? "/opengraph-image"),
    inLanguage: siteConfig.language,
  }
}

export function graph(...nodes: Thing[]): Graph {
  return { "@context": "https://schema.org", "@graph": nodes } as Graph
}
