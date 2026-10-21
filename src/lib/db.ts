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
    const query = client.query
    client.query = ((text, params, options) => query(text, params?.map(withoutNul), options)) as typeof query
  }
  return client
}

/*
 * Postgres rejects NUL in text, and its JSON escape in jsonb, failing the whole
 * query. Fetched web pages sometimes contain one, so every parameter loses
 * them on the way in. In JSON, "\\u0000" is a literal backslash and stays.
 */
function withoutNul(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\0/g, "").replace(/(\\+)u0000/g, (match, slashes: string) =>
      slashes.length % 2 ? slashes.slice(1) : match,
    )
  }
  return Array.isArray(value) ? value.map(withoutNul) : value
}

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL)
}
