import { ImageResponse } from "next/og"

import { BrandTile } from "@/lib/brand-image"

// iOS rounds the corners itself, so the tile is drawn square.
export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
  return new ImageResponse(<BrandTile size={size.width} radius={0} />, size)
}
