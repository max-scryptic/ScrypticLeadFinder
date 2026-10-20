"use server"

import { revalidatePath } from "next/cache"

import { leadStatuses, type LeadStatus } from "@/lib/leads"
import { saveLeadStatus } from "@/lib/queries"

export async function setLeadStatus(leadKey: string, status: LeadStatus) {
  // TODO: check the signed-in user here once the app has auth. Server Actions
  // are reachable by direct POST, so anyone who can load the app can change a status.
  if (typeof leadKey !== "string" || !leadKey || leadKey.length > 500) return { error: "Unknown lead." }
  if (!leadStatuses.includes(status)) return { error: "Unknown status." }

  await saveLeadStatus(leadKey, status)
  revalidatePath("/leads")
  return {}
}
