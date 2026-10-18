import { Badge } from "@/components/ui/badge"

const labels = {
  running: { text: "Running", variant: "outline" },
  success: { text: "Succeeded", variant: "secondary" },
  error: { text: "Failed", variant: "destructive" },
} as const

export function RunStatusBadge({ status }: { status: keyof typeof labels }) {
  const label = labels[status] ?? labels.error
  return <Badge variant={label.variant}>{label.text}</Badge>
}
