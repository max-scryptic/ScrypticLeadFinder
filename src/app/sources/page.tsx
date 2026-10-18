import { connection } from "next/server"

import { PageJsonLd } from "@/components/json-ld"
import { SourceCard } from "@/components/source-card"
import { hasDatabase } from "@/lib/db"
import { getSourceSummaries, type SourceSummary } from "@/lib/queries"
import { createMetadata, pages } from "@/lib/seo"
import { sources } from "@/lib/sources"

export const metadata = createMetadata(pages.sources)

export default async function SourcesPage() {
  await connection()
  const summaries: Record<string, SourceSummary> = hasDatabase() ? await getSourceSummaries() : {}
  const live = sources.filter((source) => source.status === "live")
  const planned = sources.filter((source) => source.status === "planned")

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8">
      <PageJsonLd page={pages.sources} />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
        <p className="text-muted-foreground">
          Each source is a place a buying signal comes from. Live sources are fetched on a schedule; open one to
          see what its collector found most recently.
        </p>
      </div>

      {!hasDatabase() && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          DATABASE_URL is not set, so no collected data can be shown.
        </p>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="live-heading">
        <h2 id="live-heading" className="text-sm font-medium text-muted-foreground">
          Live ({live.length})
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {live.map((source) => (
            <SourceCard key={source.id} source={source} summary={summaries[source.id]} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="planned-heading">
        <h2 id="planned-heading" className="text-sm font-medium text-muted-foreground">
          Planned ({planned.length})
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {planned.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>
      </section>
    </main>
  )
}
