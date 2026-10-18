import { publicPages } from "@/lib/seo"
import { absoluteUrl, siteConfig } from "@/lib/site"

/*
 * /llms.txt (https://llmstxt.org): a plain Markdown map of the site for
 * language models and AI agents, built from the same page registry as the
 * sitemap. Group pages under more "## Section" headings as the site grows;
 * an "## Optional" section marks links an agent can skip when short on room.
 */

export const dynamic = "force-static"

export function GET() {
  const lines = [
    `# ${siteConfig.name}`,
    "",
    `> ${siteConfig.description}`,
    "",
    ...(siteConfig.summary ? [siteConfig.summary, ""] : []),
    "## Pages",
    "",
    ...publicPages.map(
      (page) => `- [${page.title}](${absoluteUrl(page.path)}): ${page.description}`,
    ),
    "",
  ]

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  })
}
