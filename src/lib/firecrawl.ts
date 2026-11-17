import { Firecrawl } from "firecrawl";

// This project's TypeScript 7 does not auto-load @types/node declarations in
// these files — declare the Node globals used below (same pattern as
// index.ts and telegram.ts).
declare const process: { env: Record<string, string | undefined> };

// Singleton Firecrawl client (Trigger.dev task env in prod, local .env in dev).
export const firecrawl = new Firecrawl();

// Credit guard: every tool calls this right before spending credits. Kept
// call-time (not import-time) so importing the client never throws.
export function requireFirecrawl(): void {
  if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error("FIRECRAWL_API_KEY is not set in the task environment");
  }
}
