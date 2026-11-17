import { tool } from "ai";
import { z } from "zod";
import { firecrawl, requireFirecrawl } from "../../lib/firecrawl.js";

// Site link finder: fast URL discovery for one site, optionally ranked by a
// search term. Not exhaustive — use read_site when full coverage matters.
export const listSiteLinks = tool({
  description:
    "List the page URLs of a website, optionally ranked against a search term. Use it to find the right page on a site (e.g. 'pricing page of example.com') before reading it. Fast, but may miss pages.",
  inputSchema: z.object({
    url: z
      .string()
      .url()
      .describe("Base URL of the site (e.g. https://example.com)"),
    search: z
      .string()
      .optional()
      .describe("Rank and filter the links against this term (e.g. 'pricing')"),
  }),
  execute: async ({ url, search }) => {
    requireFirecrawl();
    const res = await firecrawl.map(url, {
      ...(search ? { search } : {}),
    });
    const links = res.links.flatMap((l) => (l.url ? [l.url] : [])).slice(0, 50);
    return { count: links.length, links };
  },
});
