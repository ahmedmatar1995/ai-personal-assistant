import { tool } from "ai";
import { z } from "zod";
import { firecrawl, requireFirecrawl } from "../../lib/firecrawl.js";

// Page watches: scheduled checks that record meaningful changes on pages.
export const watchPage = tool({
  description:
    "Start watching one or more web pages for changes, checked on a schedule. Meaningful changes are recorded and can be reviewed later with list_watches. Use it when the user wants to stay up to date about a page (prices, availability, listings, posts).",
  inputSchema: z.object({
    urls: z
      .array(z.string().url())
      .min(1)
      .max(3)
      .describe("Page URLs to watch (up to 3)"),
    schedule: z
      .string()
      .optional()
      .describe(
        "How often to check, in plain words (e.g. 'every morning', 'every 6 hours'). Default: every day.",
      ),
    cron: z
      .string()
      .optional()
      .describe("Exact cron expression for the schedule (overrides schedule)"),
    goal: z
      .string()
      .optional()
      .describe("What kind of change matters, e.g. 'flag when the price drops below 50'"),
  }),
  execute: async ({ urls, schedule, cron, goal }) => {
    requireFirecrawl();
    const monitor = await firecrawl.createMonitor({
      name: new URL(urls[0] ?? "https://unknown").hostname,
      schedule: cron ? { cron } : { text: schedule ?? "every day" },
      targets: [{ type: "scrape", urls: urls.slice(0, 3) }],
      ...(goal ? { goal } : {}),
    });
    return { watch: monitor.id, name: monitor.name, nextCheck: monitor.nextRunAt ?? null };
  },
});

export const listWatches = tool({
  description:
    "List the web pages currently being watched, their schedules and their latest check results. Use it when the user asks what is being watched or what has changed.",
  inputSchema: z.object({}),
  execute: async () => {
    requireFirecrawl();
    const monitors = await firecrawl.listMonitors();
    return {
      watches: monitors.map((m) => ({
        name: m.name,
        status: m.status,
        schedule: m.schedule.cron ?? m.schedule.text ?? "every day",
        lastChecked: m.lastRunAt ?? null,
        nextCheck: m.nextRunAt ?? null,
        latestResult: m.lastCheckSummary ?? null,
      })),
    };
  },
});
