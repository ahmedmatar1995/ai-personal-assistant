import { schemaTask, wait } from "@trigger.dev/sdk";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { channelIdentifiers, linkCodes } from "../db/schema.js";
import { sendTelegramMessage } from "../lib/telegram.js";

// How long a stranger has to open the connect link and approve it. Must match
// the link_codes.expires_at the webhook route writes.
const LINK_TTL = "15m";

// Started by the Hono webhook when an unlinked Telegram user messages the bot.
// Waits (durable, suspended) until the approval page completes the token, then
// records the identity mapping and confirms in the chat.
export const connectTelegram = schemaTask({
  id: "connect-telegram",
  schema: z.object({
    code: z.string(),
    telegramUserId: z.string(),
    chatId: z.number(),
  }),
  run: async ({ code, telegramUserId, chatId }) => {
    const token = await wait.createToken({ timeout: LINK_TTL });
    await db
      .update(linkCodes)
      .set({ triggerTokenId: token.id })
      .where(eq(linkCodes.code, code));

    // The approval may have landed while the token was being created — never
    // wait on a token that is already complete.
    const [row] = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
    const result =
      row?.clerkUserId && row.status === "approved"
        ? { ok: true as const, output: { clerkUserId: row.clerkUserId } }
        : await wait.forToken<{ clerkUserId: string }>(token.id);

    if (!result.ok) {
      await db
        .update(linkCodes)
        .set({ status: "expired" })
        .where(and(eq(linkCodes.code, code), eq(linkCodes.status, "pending")));
      await sendTelegramMessage(
        chatId,
        "The connection link expired. Send me another message to get a new one.",
      );
      return { connected: false as const };
    }

    const clerkUserId = result.output.clerkUserId;
    await db
      .insert(channelIdentifiers)
      .values({ platform: "telegram", externalId: telegramUserId, clerkUserId })
      .onConflictDoUpdate({
        target: [channelIdentifiers.platform, channelIdentifiers.externalId],
        set: { clerkUserId, linkedAt: new Date() },
      });

    await sendTelegramMessage(
      chatId,
      "Connected! Your conversations are now private to your account. Send me a message to get started.",
    );
    return { connected: true as const, clerkUserId };
  },
});
