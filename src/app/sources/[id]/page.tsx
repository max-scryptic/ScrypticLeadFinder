import { cn } from "cn"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { connection } from "next/server"

import { PageJsonLd } from "@/components/json-ld"
import { RunStatusBadge } from "@/components/run-status-badge"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { hasDatabase } from "@/lib/db"
import { formatAge, formatDate, formatDateTime, formatMoney, formatRelative } from "@/lib/format"
import { getRecentRuns, getRecentSignals, getSourceSummaries, type SignalRow, type SourceSummary } from "@/lib/queries"
import { createMetadata, pages, type PageEntry } from "@/lib/seo"
import { getSource, type Source } from "@/lib/sources"

import { RunNowButton } from "./run-now-button"

// The "Run now" Server Action runs in this route and can take most of a minute.
export const maxDuration = 60

const SH01_MAX_AGE_YEARS = 3

function pageEntry(source: Source): PageEntry {
  return {
    path: `/sources/${source.id}`,
    title: source.name,
    description: source.signal,
    parents: [pages.sources],
    noIndex: true,
  }
}

export async function generateMetadata({ params }: PageProps<"/sources/[id]">): Promise<Metadata> {
  const source = getSource((await params).id)
  return source ? createMetadata(pageEntry(source)) : {}
}

export default async function SourcePage({ params, searchParams }: PageProps<"/sources/[id]">) {
  await connection()
  const { id } = await params
  const source = getSource(id)
  if (!source) notFound()

  const live = source.status === "live"
  const isSh01 = source.id === "companies-house-sh01"
  const showAll = (await searchParams).all === "1"

  const [summaries, runs, signals] =
    live && hasDatabase()
      ? await Promise.all([
          getSourceSummaries(),
          getRecentRuns(source.id),
          getRecentSignals(source.id, { maxCompanyAgeYears: isSh01 && !showAll ? SH01_MAX_AGE_YEARS : undefined }),
        ])
      : [{} as Record<string, SourceSummary>, [], []]
  const summary = summaries[source.id]

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8">
      <PageJsonLd page={pageEntry(source)} />

      <div className="flex flex-col gap-4">
        <Link href="/sources" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; All sources
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex max-w-2xl flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {source.provider}
              {live ? <Badge>Live</Badge> : <Badge variant="outline">Planned</Badge>}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{source.name}</h1>
            <p className="text-muted-foreground">{source.signal}</p>
          </div>
          {live && hasDatabase() && <RunNowButton sourceId={source.id} />}
        </div>
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <Stat label="How it is fetched" value={source.access} />
        <Stat label="What it keeps" value={source.details} className="sm:col-span-2" />
      </dl>

      {!live ? (
        <p className="rounded-xl bg-card px-4 py-6 text-center text-muted-foreground ring-1 ring-foreground/10">
          This source is not built yet. When it is, its latest signals will show here.
        </p>
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Stat label="Signals stored" value={String(summary?.total ?? 0)} large />
            <Stat label="New in the last 7 days" value={String(summary?.new_this_week ?? 0)} large />
            <Stat
              label="Last run"
              value={summary?.last_run ? formatRelative(summary.last_run.started_at) : "Not run yet"}
              large
            />
          </dl>

          <section className="flex flex-col gap-3" aria-labelledby="signals-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="signals-heading" className="text-lg font-semibold">
                Latest signals
              </h2>
              {isSh01 && (
                <p className="text-sm text-muted-foreground">
                  {showAll ? (
                    <>
                      Showing companies of any age.{" "}
                      <Link className="underline underline-offset-4" href={`/sources/${source.id}`}>
                        Only under {SH01_MAX_AGE_YEARS} years old
                      </Link>
                    </>
                  ) : (
                    <>
                      Companies under {SH01_MAX_AGE_YEARS} years old.{" "}
                      <Link className="underline underline-offset-4" href={`/sources/${source.id}?all=1`}>
                        Show all ages
                      </Link>
                    </>
                  )}
                </p>
              )}
            </div>
            {signals.length === 0 ? (
              <Empty>No signals yet. They appear here after the collector&apos;s next run.</Empty>
            ) : (
              <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-64">Company</TableHead>
                      <TableHead>Signal</TableHead>
                      <TableHead className="text-right">{isSh01 ? "" : "Grant offer"}</TableHead>
                      <TableHead>{isSh01 ? "Filed" : "Starts"}</TableHead>
                      <TableHead>Found</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {signals.map((signal) => (
                      <SignalTableRow key={signal.id} signal={signal} isSh01={isSh01} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="runs-heading">
            <h2 id="runs-heading" className="text-lg font-semibold">
              Recent runs
            </h2>
            {runs.length === 0 ? (
              <Empty>The collector has not run yet.</Empty>
            ) : (
              <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Found</TableHead>
                      <TableHead className="text-right">New</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell>{formatDateTime(run.started_at)}</TableCell>
                        <TableCell className="capitalize">{run.trigger}</TableCell>
                        <TableCell>
                          <RunStatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{run.items_seen}</TableCell>
                        <TableCell className="text-right tabular-nums">{run.items_new}</TableCell>
                        <TableCell className="max-w-md truncate whitespace-normal text-muted-foreground">
                          {run.message}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}

function SignalTableRow({ signal, isSh01 }: { signal: SignalRow; isSh01: boolean }) {
  const meta = isSh01
    ? [
        formatAge(signal.date_of_creation),
        signal.locality,
        signal.company_status && signal.company_status !== "active" ? signal.company_status : null,
      ]
    : [String(signal.data.grantCategory ?? ""), formatAge(signal.date_of_creation), signal.locality]

  return (
    <TableRow className="align-top">
      <TableCell className="whitespace-normal">
        <div className="font-medium">
          {signal.company_name ??
            (signal.company_found === false ? "Not found at Companies House" : "Looking up company...")}
        </div>
        <div className="text-xs text-muted-foreground">
          {signal.company_number && (
            <a
              className="underline-offset-4 hover:underline"
              href={`https://find-and-update.company-information.service.gov.uk/company/${signal.company_number}`}
              target="_blank"
              rel="noreferrer"
            >
              {signal.company_number}
            </a>
          )}
          {signal.company_number && meta.some(Boolean) && " · "}
          {meta.filter(Boolean).join(" · ")}
        </div>
      </TableCell>
      <TableCell className="whitespace-normal">
        {signal.url ? (
          <a className="font-medium underline-offset-4 hover:underline" href={signal.url} target="_blank" rel="noreferrer">
            {signal.title}
          </a>
        ) : (
          <span className="font-medium">{signal.title}</span>
        )}
        {signal.summary && <p className="line-clamp-2 text-xs text-muted-foreground">{signal.summary}</p>}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatMoney(signal.amount, signal.currency ?? "GBP")}
      </TableCell>
      <TableCell>{formatDate(signal.occurred_on)}</TableCell>
      <TableCell className="text-muted-foreground">{formatRelative(signal.first_seen_at)}</TableCell>
    </TableRow>
  )
}

function Stat({
  label,
  value,
  large,
  className,
}: {
  label: string
  value: string
  large?: boolean
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-xl bg-card p-4 ring-1 ring-foreground/10", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={large ? "text-2xl font-semibold tabular-nums" : "text-sm"}>{value}</dd>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-card px-4 py-6 text-center text-muted-foreground ring-1 ring-foreground/10">
      {children}
    </p>
  )
}
