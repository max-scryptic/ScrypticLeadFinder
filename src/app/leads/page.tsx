import { cn } from "cn"
import Link from "next/link"
import { connection } from "next/server"

import { PageJsonLd } from "@/components/json-ld"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { hasDatabase } from "@/lib/db"
import { formatAge, formatDate, formatMoney } from "@/lib/format"
import {
  GRANT_SOURCE,
  leadFiltersQuery,
  leadSourceFilters,
  leadStatuses,
  leadWindows,
  parseLeadFilters,
  SH01_SOURCE,
  type Lead,
  type LeadFilters,
} from "@/lib/leads"
import { getLeads, type LeadList } from "@/lib/queries"
import { createMetadata, pages } from "@/lib/seo"

import { LeadStatusSelect } from "./lead-status-select"

export const metadata = createMetadata(pages.leads)

// Rows rendered on the page; the CSV export has every lead that matches.
const PAGE_LIMIT = 200

const statusLabels = { all: "All", new: "New", contacted: "Contacted", qualified: "Qualified", rejected: "Rejected" }

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  await connection()
  const filters = parseLeadFilters(await searchParams)
  const list: LeadList = hasDatabase()
    ? await getLeads(filters)
    : { leads: [], statusCounts: { all: 0, new: 0, contacted: 0, qualified: 0, rejected: 0 }, excludedCount: 0 }
  const shown = list.leads.slice(0, PAGE_LIMIT)

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <PageJsonLd page={pages.leads} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-muted-foreground">
            Companies most likely to need an MVP built, best first. Each row is one company with every signal found
            for it across all sources. Holding, property, dormant, large and older companies are hidden unless you
            choose to see them.
          </p>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          render={<a href={`/leads/export${leadFiltersQuery(filters)}`} download />}
        >
          Export CSV
        </Button>
      </div>

      {!hasDatabase() && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          DATABASE_URL is not set, so no leads can be shown.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <FilterGroup label="Status">
          {(["new", ...leadStatuses.filter((status) => status !== "new"), "all"] as const).map((status) => (
            <FilterLink key={status} filters={{ ...filters, status }} active={filters.status === status}>
              {statusLabels[status]} <span className="text-muted-foreground">{list.statusCounts[status]}</span>
            </FilterLink>
          ))}
        </FilterGroup>
        <FilterGroup label="Source">
          {(Object.keys(leadSourceFilters) as (keyof typeof leadSourceFilters)[]).map((source) => (
            <FilterLink key={source} filters={{ ...filters, source }} active={filters.source === source}>
              {leadSourceFilters[source]}
            </FilterLink>
          ))}
        </FilterGroup>
        <FilterGroup label="Found in">
          {leadWindows.map((days) => (
            <FilterLink key={days} filters={{ ...filters, days }} active={filters.days === days}>
              Last {days} days
            </FilterLink>
          ))}
        </FilterGroup>
        <FilterGroup label="Excluded">
          <FilterLink filters={{ ...filters, showExcluded: false }} active={!filters.showExcluded}>
            Hidden
          </FilterLink>
          <FilterLink filters={{ ...filters, showExcluded: true }} active={filters.showExcluded}>
            Shown <span className="text-muted-foreground">{list.excludedCount}</span>
          </FilterLink>
        </FilterGroup>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="leads-heading">
        <h2 id="leads-heading" className="sr-only">
          Matching leads
        </h2>
        {shown.length === 0 ? (
          <p className="rounded-xl bg-card px-4 py-6 text-center text-muted-foreground ring-1 ring-foreground/10">
            No leads match these filters.
          </p>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
              <Table className="min-w-4xl">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14 text-right">Score</TableHead>
                    <TableHead className="w-60">Company</TableHead>
                    <TableHead>Signals</TableHead>
                    <TableHead className="w-64">Why</TableHead>
                    <TableHead className="w-32">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((lead) => (
                    <LeadTableRow key={lead.lead_key} lead={lead} />
                  ))}
                </TableBody>
              </Table>
            </div>
            {list.leads.length > shown.length && (
              <p className="text-sm text-muted-foreground">
                Showing the top {shown.length} of {list.leads.length} leads. Export the CSV for all of them.
              </p>
            )}
          </>
        )}
      </section>
    </main>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function FilterLink({
  filters,
  active,
  children,
}: {
  filters: LeadFilters
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={`/leads${leadFiltersQuery(filters)}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-full px-3 py-1 text-sm ring-1 ring-foreground/10 transition-colors",
        active ? "bg-foreground text-background [&_span]:text-background/70" : "bg-card hover:bg-muted",
      )}
    >
      {children}
    </Link>
  )
}

function LeadTableRow({ lead }: { lead: Lead }) {
  const name = lead.company_name ?? "Unknown company"
  const meta = [
    formatAge(lead.date_of_creation),
    lead.locality,
    lead.sic_codes?.length ? `SIC ${lead.sic_codes.join(", ")}` : null,
  ].filter(Boolean)
  // Signals arrive newest first. Share allotments are summarised in one line:
  // a company often files several on the same day.
  const sh01s = lead.signals.filter((signal) => signal.sourceId === SH01_SOURCE)
  const grants = lead.signals.filter((signal) => signal.sourceId === GRANT_SOURCE)

  return (
    <TableRow className={cn("align-top", lead.exclusion && "opacity-60")}>
      <TableCell className="text-right">
        <span className="text-lg font-semibold tabular-nums">{lead.score}</span>
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="font-medium">{name}</div>
        <div className="text-xs text-muted-foreground">
          {lead.company_number ? (
            <a
              className="underline-offset-4 hover:underline"
              href={`https://find-and-update.company-information.service.gov.uk/company/${lead.company_number}`}
              target="_blank"
              rel="noreferrer"
            >
              {lead.company_number}
            </a>
          ) : (
            "Not matched at Companies House"
          )}
          {meta.length > 0 && ` · ${meta.join(" · ")}`}
        </div>
      </TableCell>
      <TableCell className="whitespace-normal">
        <ul className="flex flex-col gap-1.5">
          {sh01s.length > 0 && (
            <SignalItem
              label={sh01s.length > 1 ? `${sh01s.length} share allotments` : "Share allotment"}
              details={[sh01s[0].occurredOn ? `latest filed ${formatDate(sh01s[0].occurredOn)}` : null]}
            />
          )}
          {grants.slice(0, 3).map((grant, index) => (
            <SignalItem
              key={index}
              label="Innovate UK grant"
              details={[formatMoney(grant.amount, grant.currency ?? "GBP"), grant.grantCategory, grant.grantStatus]}
              title={grant.title}
              url={grant.url}
            />
          ))}
          {grants.length > 3 && <li className="text-xs text-muted-foreground">and {grants.length - 3} more grants</li>}
        </ul>
      </TableCell>
      <TableCell className="whitespace-normal text-xs">
        {lead.exclusion && <p className="mb-1 font-medium text-destructive">Excluded: {lead.exclusion}</p>}
        <ul className="text-muted-foreground">
          {lead.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </TableCell>
      <TableCell>
        <LeadStatusSelect leadKey={lead.lead_key} status={lead.status} companyName={name} />
      </TableCell>
    </TableRow>
  )
}

function SignalItem({
  label,
  details,
  title,
  url,
}: {
  label: string
  details: (string | null)[]
  title?: string
  url?: string | null
}) {
  return (
    <li className="text-sm">
      <div className="flex flex-wrap items-center gap-x-2">
        <Badge variant="outline">{label}</Badge>
        <span className="text-xs text-muted-foreground">{details.filter(Boolean).join(" · ")}</span>
      </div>
      {title &&
        (url ? (
          <a className="line-clamp-1 text-xs underline-offset-4 hover:underline" href={url} target="_blank" rel="noreferrer">
            {title}
          </a>
        ) : (
          <p className="line-clamp-1 text-xs">{title}</p>
        ))}
    </li>
  )
}
