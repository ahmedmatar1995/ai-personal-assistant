import { tool } from "ai";
import { z } from "zod";
import { firecrawl, requireFirecrawl } from "../../lib/firecrawl.js";

// Whole-section reader. Capped hard: default 10 pages, max 50 — the API
// otherwise charges for whatever it can discover (402 when credits run out).
export const readSite = tool({
  description:
    "Read many pages from one website or section in one go (e.g. a docs section, all blog posts). Heavier than a single page read — keep the page limit small. Returns each page's URL, title and a short excerpt.",
  inputSchema: z.object({
    url: z.string().url().describe("Starting URL of the site or section"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Maximum pages to read (default 10, max 50)"),
    includePaths: z
      .array(z.string())
      .optional()
      .describe("Only read URLs matching these path patterns (e.g. '/blog/*')"),
    excludePaths: z
      .array(z.string())
      .optional()
      .describe("Skip URLs matching these path patterns"),
  }),
  execute: async ({ url, limit, includePaths, excludePaths }) => {
    requireFirecrawl();
    const job = await firecrawl.crawl(url, {
      limit: limit ?? 10,
      ...(includePaths ? { includePaths } : {}),
      ...(excludePaths ? { excludePaths } : {}),
    });
    const pages = job.data.flatMap((d) =>
      d.metadata?.sourceURL
        ? [
            {
              url: d.metadata.sourceURL,
              title: d.metadata.title ?? "",
              excerpt: (d.markdown ?? "").slice(0, 600),
            },
          ]
        : [],
    );
    return { pages: pages.slice(0, 50) };
  },
});
