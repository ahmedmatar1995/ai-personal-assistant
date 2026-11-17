import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// Same constraint as the other task files: this project's TypeScript does not
// auto-load @types/node here, and a types:["node"] entry breaks Vercel.
declare const process: { env: Record<string, string | undefined> };

// App query traffic uses the pooled connection (PgBouncer transaction mode).
// The connection is established lazily on first query.
export const db = drizzle({
  client: new Pool({ connectionString: process.env.DATABASE_URL }),
});
