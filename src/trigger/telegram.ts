import { chat } from "@trigger.dev/sdk/ai";
import { webhooks } from "@trigger.dev/sdk";
import { google } from "@ai-sdk/google";
import { stepCountIs } from "ai";
import { webSearch } from "./tools/web-search.js";

// This project's TypeScript 7 does not auto-load @types/node declarations in
// these task files, and an explicit types:["node"] entry breaks Vercel's
// build — so declare the Node globals used here (same pattern as index.ts).
declare const process: { env: Record<string, string | undefined> };

// Minimal shape of the Telegram updates we care about. The source only
// verifies signatures — it does not validate bodies against this type.
type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    from?: { first_name?: string };
    chat: { id: number };
  };
};

// Trigger.dev hosts this URL; Telegram delivers updates to it. Each request
// must carry our shared secret in X-Telegram-Bot-Api-Secret-Token (set on the
// bot with setWebhook), and update_id dedupes Telegram's delivery retries.
const telegramEndpoint = webhooks.endpoint.define({
  id: "telegram",
  source: webhooks.custom<TelegramUpdate>({
    scheme: "shared-secret",
    placement: "header",
    fieldName: "X-Telegram-Bot-Api-Secret-Token",
    idempotencyField: { from: "body", name: "update_id" },
  }),
});

const TELEGRAM_API = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 4096;

// Chat frontend: each Telegram chat id gets one durable session on
// Trigger.dev — the transcript persists there, no database involved.
const telegramChannel = chat.channels.custom({
  id: "telegram",
  endpoint: telegramEndpoint,
  key: "{event.message.chat.id}",
  // Photos, stickers, edits, etc. map to an empty message, which runs no turn.
  inbound: (e) => e.message?.text ?? "",
  send: async (message, ctx) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token)
      throw new Error("TELEGRAM_BOT_TOKEN is not set in the task environment");
    const chatId = ctx.event?.message?.chat.id;
    if (chatId === undefined)
      throw new Error("Channel delivery is missing message.chat.id");

    // Telegram caps one message at 4096 chars; post the first chunk and edit
    // it for streaming updates (previousRef), then append further chunks.
    const full = message.text ?? "";
    const chunks: string[] = [];
    for (let i = 0; i < full.length; i += MAX_MESSAGE_LENGTH) {
      chunks.push(full.slice(i, i + MAX_MESSAGE_LENGTH));
    }
    if (chunks.length === 0) return {};

    const post = async (method: string, body: Record<string, unknown>) => {
      const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(
          `Telegram ${method} failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
        );
      }
      const data = (await res.json()) as { result?: { message_id?: number } };
      return data.result?.message_id;
    };

    if (ctx.previousRef) {
      // Later send in the same turn: edit the message already posted.
      await post("editMessageText", {
        chat_id: chatId,
        message_id: Number(ctx.previousRef),
        text: full,
      });
      return { ref: ctx.previousRef };
    }

    let ref: number | undefined;
    for (const chunk of chunks) {
      ref = await post("sendMessage", { chat_id: chatId, text: chunk });
    }
    return ref !== undefined ? { ref: String(ref) } : {};
  },
});

// The assistant: same Gemini model as before. Turns arrive from the Telegram
// channel; history (the persistent transcript) is managed by the session.
export const assistant = chat.agent({
  id: "assistant",
  system: `You are a helpful personal assistant chatting over Telegram. Reply concisely, in plain text, without markdown formatting.

You have a web_search tool that searches the public web and returns page titles, links, and short excerpts.

Use it — without announcing it — whenever the answer depends on information you cannot reliably know on your own:
- Current or recent things: news, events, weather, prices, sports scores, schedules, release dates, or anything the user words with "latest", "now", or "today".
- Facts that may have changed recently: software versions, rankings, who holds a position or title, whether a business is open, whether something still exists.
- Specific lookups the user asks you to check, find, look up, or verify online.

Do NOT use it for everyday conversation, stable general knowledge (math, history, how-to explanations), or things the user already told you in this chat.

When you use it: search first, then answer in your own words from the results, and list supporting links at the end as plain URLs. Lead with what you found, not with what you can't do — if you cannot do something (like completing a booking or seeing a live table), put that in one short sentence at the very end, after the useful results. If the search fails or finds nothing useful, say what you couldn't verify and answer from your own knowledge with appropriate uncertainty. Never mention tool names, that you searched, or how the lookup happened — just give the answer.`,
  channels: [telegramChannel],
  tools: { web_search: webSearch },
  run: async ({ messages, tools, signal, streamText }) =>
    streamText({
      model: google("gemini-3.5-flash-lite"),
      messages,
      tools,
      stopWhen: stepCountIs(5),
      abortSignal: signal,
    }),
});
