import { tool } from "ai";
import { z } from "zod";
import { firecrawl, requireFirecrawl } from "../../lib/firecrawl.js";

// Web search tool. Named and described without any vendor vocabulary — the
// Telegram user just says "look this up" and the agent decides.
// shortcut: still returns excerpts only; scrapeOptions in-search could fetch
// full pages when answers routinely need deep content.
export const webSearch = tool({
  description:
    "Search the public web and news. Returns a list of results with title, URL, excerpt and (for news) date. Use it whenever answering needs up-to-date or external information.",
  inputSchema: z.object({
    query: z.string().describe("Search query, phrased as keywords"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Number of results (default 5)"),
    time: z
      .enum(["day", "week", "month", "year"])
      .optional()
      .describe("Only results from this recent window"),
    news: z.boolean().optional().describe("Also search news sources"),
  }),
  execute: async ({ query, limit, time, news }) => {
    requireFirecrawl();
    const tbs = time
      ? ({ day: "qdr:h", week: "qdr:d", month: "qdr:w", year: "qdr:y" } as const)[
          time
        ]
      : undefined;
    const res = await firecrawl.search(query, {
      limit: limit ?? 5,
      ...(tbs ? { tbs } : {}),
      sources: news ? ["web", "news"] : ["web"],
    });
    const results = [
      ...(res.web ?? []).flatMap((r) =>
        "url" in r && r.url
          ? [{ title: r.title ?? "", url: r.url, excerpt: r.description ?? "" }]
          : [],
      ),
      ...(res.news ?? []).flatMap((r) =>
        "url" in r && r.url
          ? [
              {
                title: r.title ?? "",
                url: r.url,
                excerpt: r.snippet ?? "",
                date: r.date,
              },
            ]
          : [],
      ),
    ];
    return { results: results.slice(0, 10) };
  },
});
