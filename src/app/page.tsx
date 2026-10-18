import Link from "next/link"

import { BrandLogo } from "@/components/brand-logo"
import { PageJsonLd } from "@/components/json-ld"
import { Button } from "@/components/ui/button"
import { createMetadata, pages } from "@/lib/seo"
import { siteConfig } from "@/lib/site"

export const metadata = createMetadata(pages.home)

export default function Home() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-muted px-4 py-6 text-center">
      <PageJsonLd page={pages.home} />
      <div className="flex flex-col items-center gap-4">
        <BrandLogo className="size-14" />
        <h1 className="text-3xl font-semibold tracking-tight">{siteConfig.name}</h1>
      </div>
      <div className="flex gap-3">
        {/* Base UI composes through `render`; `nativeButton` is off because the result is a link. */}
        <Button size="lg" nativeButton={false} render={<Link href="/login" />}>
          Login
        </Button>
        <Button
          size="lg"
          variant="outline"
          nativeButton={false}
          render={<Link href="/signup" />}
        >
          Sign up
        </Button>
      </div>
    </main>
  )
}
