import { ImageResponse } from "next/og"

import { BrandTile } from "@/lib/brand-image"
import { shareImage } from "@/lib/seo"
import { siteConfig } from "@/lib/site"

/*
 * Default share image for every route. A route that deserves its own (a blog
 * post, a product) gets an opengraph-image.tsx in its folder, which wins over
 * this one. 1200x630 is the size every major network crops to.
 */
export const alt = shareImage.alt
export const size = { width: shareImage.width, height: shareImage.height }
export const contentType = "image/png"

export default function OpengraphImage() {
  const { colors } = siteConfig

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: colors.muted,
          color: colors.primary,
        }}
      >
        <BrandTile size={112} />
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 80, fontWeight: 600, letterSpacing: -2 }}>
            {siteConfig.name}
          </div>
          <div
            style={{
              fontSize: 36,
              lineHeight: 1.35,
              color: colors.mutedForeground,
              maxWidth: 960,
            }}
          >
            {siteConfig.description}
          </div>
        </div>
      </div>
    ),
    size,
  )
}
