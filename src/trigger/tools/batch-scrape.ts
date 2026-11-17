import { tool } from "ai";
import { z } from "zod";
import { firecrawl, requireFirecrawl } from "../../lib/firecrawl.js";

// Many known URLs in one job. Capped at 20 URLs.
export const readManyPages = tool({
  description:
    "Read several specific URLs at once and return each page's URL, title and a short excerpt. Use it when you already have a list of pages (e.g. from search results).",
  inputSchema: z.object({
    urls: z.array(z.string().url()).max(20).describe("URLs to read (max 20)"),
  }),
  execute: async ({ urls }) => {
    requireFirecrawl();
    const job = await firecrawl.batchScrape(urls.slice(0, 20));
    const pages = job.data.flatMap((d) =>
      d.metadata?.sourceURL
        ? [
            {
              url: d.metadata.sourceURL,
              title: d.metadata.title ?? "",
              excerpt: (d.markdown ?? "").slice(0, 800),
            },
          ]
        : [],
    );
    return { pages };
  },
});
