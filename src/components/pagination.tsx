import { cn } from "cn"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { PAGE_SIZE, pageCount, pageHref } from "@/lib/pagination"

/* Previous and Next links under a table, with which rows are showing. */

export function Pagination({
  page,
  total,
  href,
  param = "page",
  noun,
  label,
}: {
  page: number
  total: number
  /** The current URL; other query parameters are kept on every link. */
  href: string
  /** Query parameter holding the page, so two tables on one page can page separately. */
  param?: string
  /** What the rows are, plural, for "Showing 1 to 50 of 120 leads". */
  noun: string
  /** Accessible name of the navigation landmark. */
  label: string
}) {
  const last = pageCount(total)
  if (last === 1) return null
  const first = (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, total)

  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground">
        Showing {first} to {end} of {total} {noun}
      </p>
      <div className="flex items-center gap-2">
        <PageLink href={pageHref(href, param, page - 1)} disabled={page <= 1}>
          Previous
        </PageLink>
        <span className="text-muted-foreground tabular-nums">
          Page {page} of {last}
        </span>
        <PageLink href={pageHref(href, param, page + 1)} disabled={page >= last}>
          Next
        </PageLink>
      </div>
    </nav>
  )
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  const className = buttonVariants({ variant: "outline", size: "sm" })
  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(className, "pointer-events-none opacity-50")}>
        {children}
      </span>
    )
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}
