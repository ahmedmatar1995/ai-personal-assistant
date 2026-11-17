import { pgTable } from "drizzle-orm/pg-core";
import * as t from "drizzle-orm/pg-core";

// Maps a messaging-platform identity (platform + external id, e.g. a Telegram
// user id) to the Clerk account that owns it, so inbound webhook traffic can
// be scoped to a real user.
export const channelIdentifiers = pgTable(
  "channel_identifiers",
  {
    platform: t.text("platform").$type<"telegram">().notNull(),
    externalId: t.text("external_id").notNull(),
    clerkUserId: t.text("clerk_user_id").notNull(),
    linkedAt: t
      .timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // (platform, external_id) is the natural key: one identity = one row, and
    // it doubles as the lookup index for scoping webhook traffic.
    t.primaryKey({ columns: [table.platform, table.externalId] }),
  ],
);
