import { tool } from "ai";
import { z } from "zod";
import { firecrawl } from "../../lib/firecrawl.js";

// This project's TypeScript 7 does not auto-load @types/node declarations in
// these task files — declare the Node global used below (same pattern as
// index.ts and telegram.ts).
declare const process: { env: Record<string, string | undefined> };

// Web search tool. Named and described without any vendor vocabulary — the
// Telegram user just says "look this up" and the agent decides.
// shortcut: search returns excerpts only, no full-page markdown; upgrade when
// answers routinely need deep page content.
export const webSearch = tool({
  description:
    "Search the public web. Returns a list of results with page title, URL and a short excerpt. Use it whenever answering needs up-to-date or external information.",
  inputSchema: z.object({
    query: z.string().describe("Search query, phrased as keywords"),
  }),
  execute: async ({ query }) => {
    if (!process.env.FIRECRAWL_API_KEY) {
      throw new Error("FIRECRAWL_API_KEY is not set in the task environment");
    }
    const res = await firecrawl.search(query, { limit: 5 });
    const results = (res.web ?? []).flatMap((r) =>
      "url" in r && r.url
        ? [{ title: r.title ?? "", url: r.url, excerpt: r.description ?? "" }]
        : [],
    );
    return { results };
  },
});
