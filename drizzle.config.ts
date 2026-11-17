import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Direct (unpooled) URL: drizzle-kit runs session-level work that PgBouncer
    // in transaction mode breaks in confusing ways.
    url: process.env.DATABASE_URL_UNPOOLED!,
  },
});
