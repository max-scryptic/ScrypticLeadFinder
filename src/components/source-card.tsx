import Link from "next/link"

import { RunStatusBadge } from "@/components/run-status-badge"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { formatRelative } from "@/lib/format"
import type { SourceSummary } from "@/lib/queries"
import type { Source } from "@/lib/sources"

export function SourceCard({ source, summary }: { source: Source; summary?: SourceSummary }) {
  const live = source.status === "live"

  return (
    <Link
      href={`/sources/${source.id}`}
      className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full transition-shadow group-hover:shadow-md">
        <CardHeader>
          <CardDescription>{source.provider}</CardDescription>
          <CardTitle>
            <h3>{source.name}</h3>
          </CardTitle>
          <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
            {live ? <Badge>Live</Badge> : <Badge variant="outline">Planned</Badge>}
          </div>
        </CardHeader>
        <CardContent className="flex-1 text-muted-foreground">{source.signal}</CardContent>
        <CardFooter className="flex-wrap gap-x-2 gap-y-1 text-xs whitespace-nowrap text-muted-foreground">
          {live ? (
            <>
              <span className="font-medium text-foreground">{summary?.total ?? 0} signals</span>
              <span aria-hidden>·</span>
              <span>{summary?.new_this_week ?? 0} new this week</span>
              <span className="ml-auto flex items-center gap-2">
                {summary?.last_run ? (
                  <>
                    {formatRelative(summary.last_run.started_at)}
                    <RunStatusBadge status={summary.last_run.status} />
                  </>
                ) : (
                  "Not run yet"
                )}
              </span>
            </>
          ) : (
            <span>Not built yet</span>
          )}
        </CardFooter>
      </Card>
    </Link>
  )
}
