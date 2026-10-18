import { BRAND_MARK_PATHS } from "@/components/brand-logo"
import { siteConfig } from "@/lib/site"

/*
 * The brand tile for next/og ImageResponse (favicon, app icons, Open Graph
 * image). Satori only understands inline styles and flexbox, so this mirrors
 * BrandLogo without Tailwind.
 */
export function BrandTile({
  size,
  radius = size * 0.22,
}: {
  size: number
  radius?: number
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: siteConfig.colors.primary,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        width={size * 0.6}
        height={size * 0.6}
        viewBox="0 0 24 24"
        fill="none"
        stroke={siteConfig.colors.primaryForeground}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {BRAND_MARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </div>
  )
}
