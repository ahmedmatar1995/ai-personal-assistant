import { pgEnum, pgTable } from "drizzle-orm/pg-core";
import * as t from "drizzle-orm/pg-core";

export const platformEnum = pgEnum("platform", ["telegram"]);

// Maps a messaging-platform identity (platform + external id, e.g. a Telegram
// user id) to the Clerk account that owns it, so inbound webhook traffic can
// be scoped to a real user.
export const channelIdentifiers = pgTable(
  "channel_identifiers",
  {
    id: t.uuid("id").primaryKey().defaultRandom(),
    platform: platformEnum("platform").notNull(),
    externalId: t.text("external_id").notNull(),
    clerkUserId: t.text("clerk_user_id").notNull(),
    linkedAt: t
      .timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One identity = one row; doubles as the lookup index for scoping webhook
    // traffic.
    t.uniqueIndex("channel_identifiers_platform_external_idx").on(
      table.platform,
      table.externalId,
    ),
  ],
);
