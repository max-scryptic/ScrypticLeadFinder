/*
 * Finds lead companies' websites (see src/collectors/company-websites.ts). The
 * cron job runs it after the collectors.
 *
 *   npm run websites
 *   npm run websites -- --budget=600   seconds (default 240)
 */
import { findCompanyWebsites } from "@/collectors/company-websites"

async function main() {
  const budgetArg = process.argv.slice(2).find((arg) => arg.startsWith("--budget="))
  const budgetSeconds = budgetArg ? Number(budgetArg.split("=")[1]) : 240
  await findCompanyWebsites((message) => console.log(`[websites] ${message}`), Date.now() + budgetSeconds * 1000)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
