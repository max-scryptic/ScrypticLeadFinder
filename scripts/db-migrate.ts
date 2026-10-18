/*
 * Applies db/schema.sql to DATABASE_URL. Every statement is idempotent, so this
 * is safe to run on every deploy.
 *
 *   npm run db:migrate
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { neon } from "@neondatabase/serverless"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set. Add it to .env.local.")

const sql = neon(url)
const schema = readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8")

// The HTTP driver runs one statement per query. The schema has no functions or
// string literals containing semicolons, so splitting on them is safe.
const statements = schema
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean)

async function main() {
  for (const statement of statements) {
    await sql.query(statement)
  }
  console.log(`Applied ${statements.length} statements.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
