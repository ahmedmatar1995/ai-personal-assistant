import { tool } from "ai";
import { z } from "zod";
import { firecrawl, requireFirecrawl } from "../../lib/firecrawl.js";

// Autonomous research: the service searches, browses and gathers structured
// data across sites over a few minutes. Spend is capped per call.
export const deepResearch = tool({
  description:
    "Deep research: describe what you want in plain language and a service will search, browse multiple sites and gather the data over several minutes. Much heavier than search plus page reads — use it only when those clearly won't be enough.",
  inputSchema: z.object({
    prompt: z
      .string()
      .describe(
        "What to find and return, e.g. 'the plans and prices on X and Y, as a list'",
      ),
    urls: z
      .array(z.string().url())
      .max(10)
      .optional()
      .describe("Optional URLs to start from"),
    maxCredits: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Maximum spend for the job (default 10, max 50)"),
  }),
  execute: async ({ prompt, urls, maxCredits }) => {
    requireFirecrawl();
    const res = await firecrawl.agent({
      prompt,
      ...(urls ? { urls } : {}),
      maxCredits: maxCredits ?? 10,
      timeout: 600, // waiter cap in seconds; the job usually finishes sooner
    });
    if (res.status !== "completed") {
      return {
        done: false,
        status: res.status,
        error: res.error ?? null,
        partial: res.partial ?? null,
      };
    }
    return { done: true, result: res.data ?? null };
  },
});
