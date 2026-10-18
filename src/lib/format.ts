const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
})

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return ""
  return dateFormat.format(new Date(value))
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return ""
  return dateTimeFormat.format(new Date(value))
}

export function formatRelative(value: Date | string | null | undefined, now = Date.now()) {
  if (!value) return "never"
  const seconds = Math.round((now - new Date(value).getTime()) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

export function formatMoney(amount: number | string | null | undefined, currency = "GBP") {
  if (amount === null || amount === undefined || amount === "") return ""
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    Number(amount),
  )
}

/** "1 year 4 months" style age, from an incorporation date. */
export function formatAge(from: Date | string | null | undefined, now = new Date()) {
  if (!from) return ""
  const start = new Date(from)
  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth()
  if (now.getDate() < start.getDate()) months--
  if (months < 1) return "under a month old"
  const years = Math.floor(months / 12)
  const rest = months % 12
  const parts = []
  if (years) parts.push(`${years} yr${years === 1 ? "" : "s"}`)
  if (rest) parts.push(`${rest} mo`)
  return `${parts.join(" ")} old`
}
