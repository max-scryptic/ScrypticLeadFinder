import Link from "next/link"

import { BrandLogo } from "@/components/brand-logo"
import { UserMenu } from "@/components/user-menu"
import { siteConfig } from "@/lib/site"

/** Top bar of the signed-in app: brand, main navigation and the account menu. */
export function AppHeader() {
  return (
    <header className="border-b bg-background">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4" aria-label="Main">
        <Link href="/leads" className="flex items-center gap-2 font-semibold">
          <BrandLogo className="size-7" />
          {siteConfig.name}
        </Link>
        <Link href="/leads" className="text-sm text-muted-foreground hover:text-foreground">
          Leads
        </Link>
        <Link href="/sources" className="text-sm text-muted-foreground hover:text-foreground">
          Sources
        </Link>
        <div className="ml-auto">
          <UserMenu />
        </div>
      </nav>
    </header>
  )
}
