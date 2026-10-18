import Link from "next/link"

import { BrandLogo } from "@/components/brand-logo"
import { siteConfig } from "@/lib/site"

export default function SourcesLayout({ children }: LayoutProps<"/sources">) {
  return (
    <>
      <header className="border-b bg-background">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4" aria-label="Main">
          <Link href="/sources" className="flex items-center gap-2 font-semibold">
            <BrandLogo className="size-7" />
            {siteConfig.name}
          </Link>
          <Link href="/sources" className="text-sm text-muted-foreground hover:text-foreground">
            Sources
          </Link>
        </nav>
      </header>
      <div className="flex-1 bg-muted/40">{children}</div>
    </>
  )
}
