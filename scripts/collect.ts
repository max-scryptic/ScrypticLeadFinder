/*
 * Runs collectors from the command line. This is what the cron job calls.
 *
 *   npm run collect                         every live source
 *   npm run collect -- ukri-innovate-uk-grants
 *   npm run collect -- --budget=600         seconds per collector (default 240)
 */
import { collectors } from "@/collectors"
import { runCollector } from "@/collectors/runner"

async function main() {
  const args = process.argv.slice(2)
  const budgetArg = args.find((arg) => arg.startsWith("--budget="))
  const budgetSeconds = budgetArg ? Number(budgetArg.split("=")[1]) : 240
  const requested = args.filter((arg) => !arg.startsWith("--"))
  const ids = requested.length > 0 ? requested : Object.keys(collectors)

  const unknown = ids.filter((id) => !(id in collectors))
  if (unknown.length > 0) {
    console.error(`Unknown source: ${unknown.join(", ")}. Known: ${Object.keys(collectors).join(", ")}.`)
    process.exit(1)
  }

  // Sequential, so each collector gets its whole budget and the Companies
  // House rate limit is never shared between two at once.
  let failed = false
  for (const id of ids) {
    const outcome = await runCollector(id, {
      trigger: process.env.GITHUB_ACTIONS ? "cron" : "cli",
      budgetMs: budgetSeconds * 1000,
    })
    console.log(`${id}: ${outcome.status}. ${outcome.message ?? ""}`)
    if (outcome.status === "error") failed = true
  }

  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
