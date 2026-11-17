import { pgEnum, pgTable } from "drizzle-orm/pg-core";
import * as t from "drizzle-orm/pg-core";

export const platformEnum = pgEnum("platform", ["telegram"]);

// Short-lived approval codes for connecting a messaging-platform identity to
// a Clerk account (device-authorization style: the bot shows a code, the user
// approves it on the web). While pending, the row also carries the Trigger.dev
// wait token that the connect task waits on; the approval page completes it.
export const linkCodes = pgTable("link_codes", {
  code: t.text("code").primaryKey(),
  telegramUserId: t.text("telegram_user_id").notNull(),
  chatId: t.text("chat_id").notNull(),
  // pending | approved | expired
  status: t.text("status").notNull().default("pending"),
  clerkUserId: t.text("clerk_user_id"),
  triggerTokenId: t.text("trigger_token_id"),
  createdAt: t
    .timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: t.timestamp("expires_at", { withTimezone: true }).notNull(),
});

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
    t
      .uniqueIndex("channel_identifiers_platform_external_idx")
      .on(table.platform, table.externalId),
  ],
);
