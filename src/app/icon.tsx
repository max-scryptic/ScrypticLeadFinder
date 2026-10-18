import { ImageResponse } from "next/og"

import { BrandTile } from "@/lib/brand-image"

// Google shows a site's favicon next to its search results and wants a
// square that is a multiple of 48px; 192 also covers the web manifest.
// /favicon.ico is rewritten here in next.config.ts.
export const size = { width: 192, height: 192 }
export const contentType = "image/png"

export default function Icon() {
  return new ImageResponse(<BrandTile size={size.width} />, size)
}
