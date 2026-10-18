import type { MetadataRoute } from "next"

import { publicPages } from "@/lib/seo"
import { absoluteUrl } from "@/lib/site"

// Generated from the page registry in src/lib/seo.ts. Dynamic content (posts,
// products) should be appended here, or split out with generateSitemaps once
// it nears 50,000 URLs.
export default function sitemap(): MetadataRoute.Sitemap {
  return publicPages.map((page) => ({
    url: absoluteUrl(page.path),
    lastModified: page.lastModified,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }))
}
