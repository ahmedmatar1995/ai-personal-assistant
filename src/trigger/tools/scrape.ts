import { tool } from "ai";
import { z } from "zod";
import { firecrawl, requireFirecrawl } from "../../lib/firecrawl.js";

// Page reader: one URL in, its content out. Neutral name — the user says
// "read this page"; the agent picks the tool.
export const readPage = tool({
  description:
    "Read one specific web page by URL and return its main content as text. Renders JavaScript. Optionally also include a summary, the page's links, or extract structured data by describing what you want. Use it when the user gives a URL or when a search hit clearly holds the answer.",
  inputSchema: z.object({
    url: z.string().url().describe("Full URL of the page to read"),
    includeSummary: z
      .boolean()
      .optional()
      .describe("Also include a one-paragraph summary"),
    includeLinks: z
      .boolean()
      .optional()
      .describe("Also include the links found on the page"),
    extractPrompt: z
      .string()
      .optional()
      .describe(
        "Describe the data to pull out of the page (e.g. 'every menu item with its price')",
      ),
    waitFor: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .optional()
      .describe("Milliseconds to wait before reading, for slow pages (e.g. 3000)"),
    clickSelector: z
      .string()
      .optional()
      .describe(
        "CSS selector of a button or link to click before reading, to expand hidden content",
      ),
  }),
  execute: async ({
    url,
    includeSummary,
    includeLinks,
    extractPrompt,
    waitFor,
    clickSelector,
  }) => {
    requireFirecrawl();
    const doc = await firecrawl.scrape(url, {
      formats: [
        "markdown",
        ...(includeSummary ? (["summary"] as const) : []),
        ...(includeLinks ? (["links"] as const) : []),
        ...(extractPrompt
          ? ([{ type: "json" as const, prompt: extractPrompt }] as const)
          : []),
      ],
      ...(waitFor ? { waitFor } : {}),
      actions: clickSelector
        ? [{ type: "click" as const, selector: clickSelector }]
        : undefined,
    });
    return {
      title: doc.metadata?.title ?? "",
      content: (doc.markdown ?? "").slice(0, 8000),
      summary: doc.summary,
      links: (doc.links ?? []).slice(0, 30),
      extracted: doc.json ?? null,
    };
  },
});
