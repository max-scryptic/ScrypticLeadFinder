import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { EmDashGuard } from "@/components/em-dash-guard";
import { JsonLd } from "@/components/json-ld";
import {
  baseOpenGraph,
  baseTwitter,
  robotsFor,
  TITLE_SEPARATOR,
} from "@/lib/seo";
import { siteConfig, siteUrl } from "@/lib/site";
import {
  graph,
  organizationJsonLd,
  websiteJsonLd,
} from "@/lib/structured-data";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Search console ownership tags, read at build time. Unset ones are skipped.
const verification: Metadata["verification"] = {
  google: process.env.GOOGLE_SITE_VERIFICATION,
  yandex: process.env.YANDEX_SITE_VERIFICATION,
  other: process.env.BING_SITE_VERIFICATION
    ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION }
    : undefined,
};

// Defaults for every route. Pages override them through createMetadata() in
// src/lib/seo.ts; the favicon, app icons, Open Graph image and manifest come
// from the icon, apple-icon, opengraph-image and manifest files next to this.
export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: siteConfig.name,
    // Fallback for a page that sets a bare `title` string. Prefer createMetadata().
    template: `%s${TITLE_SEPARATOR}${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: [...siteConfig.keywords],
  authors: [{ name: siteConfig.name, url: siteUrl }],
  creator: siteConfig.name,
  publisher: siteConfig.name,
  alternates: { canonical: "/" },
  openGraph: {
    ...baseOpenGraph,
    title: siteConfig.name,
    description: siteConfig.description,
    url: "/",
  },
  twitter: {
    ...baseTwitter,
    title: siteConfig.name,
    description: siteConfig.description,
  },
  robots: robotsFor(),
  verification,
  formatDetection: { telephone: false, address: false, email: false },
  appleWebApp: { title: siteConfig.shortName },
};

export const viewport: Viewport = {
  themeColor: siteConfig.colors.background,
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang={siteConfig.language}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="relative min-h-full">
        {/* Site-wide entities; each page's graph links back to these by @id. */}
        <JsonLd data={graph(organizationJsonLd(), websiteJsonLd())} />
        <EmDashGuard />
        <div className="isolate flex min-h-dvh flex-col">{children}</div>
      </body>
    </html>
  );
}
