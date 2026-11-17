import { Firecrawl } from "firecrawl";

// Singleton Firecrawl client. Reads FIRECRAWL_API_KEY from the environment at
// construction time (Trigger.dev task env in prod, local .env in dev).
export const firecrawl = new Firecrawl();
