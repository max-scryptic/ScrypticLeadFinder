import type { NextRequest } from "next/server"

import { GRANT_SOURCE, parseLeadFilters, SH01_SOURCE, type Lead } from "@/lib/leads"
import { getLeads } from "@/lib/queries"

/*
 * The Leads list as CSV, with the same filters as the page (passed in the
 * query string) but every page of it in one file.
 */

const columns: [string, (lead: Lead) => string | number | null | undefined][] = [
  ["Score", (lead) => lead.score],
  ["Status", (lead) => lead.status],
  ["Company", (lead) => lead.company_name],
  ["Company number", (lead) => lead.company_number],
  [
    "Companies House",
    (lead) =>
      lead.company_number && `https://find-and-update.company-information.service.gov.uk/company/${lead.company_number}`,
  ],
  ["Incorporated", (lead) => (lead.date_of_creation ? new Date(lead.date_of_creation).toISOString().slice(0, 10) : null)],
  ["Age (years)", (lead) => (lead.ageYears === null ? null : lead.ageYears.toFixed(1))],
  ["Locality", (lead) => lead.locality],
  ["Postcode", (lead) => lead.postcode],
  ["SIC codes", (lead) => lead.sic_codes?.join(" ")],
  ["Share allotments", (lead) => lead.signals.filter((signal) => signal.sourceId === SH01_SOURCE).length],
  ["Raised from share allotments (GBP)", (lead) => lead.raisedTotal],
  ["Raised amount uncertain", (lead) => (lead.raisedTotal === null ? null : lead.raisedUncertain ? "yes" : "no")],
  ["First funding round", (lead) => (lead.funding ? { first: "yes", repeat: "no", unknown: "unknown" }[lead.funding.kind] : null)],
  ["Earlier round raised (GBP)", (lead) => lead.funding?.earlierRound?.raised],
  ["Earlier round filed", (lead) => lead.funding?.earlierRound?.filedOn],
  [
    "Decision makers",
    (lead) =>
      lead.people
        .map((person) => `${person.name} (${[person.roles.join(", ") || "Owner", person.control].filter(Boolean).join(", ")})`)
        .join("; "),
  ],
  ["Grants", (lead) => lead.signals.filter((signal) => signal.sourceId === GRANT_SOURCE).length],
  ["Grant offers (GBP)", (lead) => lead.grantTotal || null],
  ["Grant projects", (lead) => lead.signals.filter((signal) => signal.sourceId === GRANT_SOURCE).map((signal) => signal.title).join("; ")],
  ["Latest signal", (lead) => lead.latestSignalOn],
  ["Why", (lead) => lead.reasons.join("; ")],
  ["Excluded because", (lead) => lead.exclusion],
]

function csvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return ""
  const text = String(value)
  // Leading =, +, - or @ would run as a formula when the file is opened in a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export async function GET(request: NextRequest) {
  const { leads } = await getLeads(parseLeadFilters(request.nextUrl.searchParams))
  const lines = [
    columns.map(([header]) => csvCell(header)).join(","),
    ...leads.map((lead) => columns.map(([, value]) => csvCell(value(lead))).join(",")),
  ]
  const date = new Date().toISOString().slice(0, 10)

  // The byte order mark makes Excel read the file as UTF-8, so "£" and accented names survive.
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${date}.csv"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  })
}
