import { neon, type NeonQueryFunction } from "@neondatabase/serverless"

/*
 * Neon over HTTP: one request per query, no connection pool to manage, which
 * suits both server components and the short-lived cron script. Created on
 * first use so importing this file never fails at build time.
 */

let client: NeonQueryFunction<false, false> | undefined

export function db() {
  if (!client) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL is not set. Add it to .env.local.")
    client = neon(url)
  }
  return client
}

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL)
}
