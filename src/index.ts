import { Hono } from "hono";

// This project's TypeScript 7 does not auto-load @types/node declarations,
// and an explicit types:["node"] entry breaks Vercel's build (TS2688) — so
// declare the single Node global the deployed serverless handler needs.
declare const process: { env: Record<string, string | undefined> };

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.get("/marco", (c) => {
  return c.text("polo");
});

// Minimal subset of Telegram's Update object
// (https://core.telegram.org/bots/api#update) — enough for a message echo.
type TelegramFrom = { id: number; first_name?: string };
type TelegramChat = { id: number; type?: string };
type TelegramMessage = {
  message_id: number;
  from?: TelegramFrom;
  chat?: TelegramChat;
  text?: string;
};
type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

// Telegram webhook receiver. Echoes what the user sent AND replies in the
// chat via sendMessage — a JSON response alone is only the ack Telegram
// expects (https://core.telegram.org/bots/webhooks), never a chat message.
app.post("/telegram/webhook", async (c) => {
  let update: TelegramUpdate;
  try {
    update = await c.req.json<TelegramUpdate>();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const msg = update.message;
  const text = msg?.text ?? null;

  let replied = false;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (token && text && msg?.chat?.id) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: msg.chat.id, text }),
      });
      const data = (await res.json()) as { ok?: boolean };
      replied = data.ok === true;
    } catch {
      // Never fail the webhook on a reply error — Telegram retries non-2xx.
    }
  }

  return c.json({
    update_id: update.update_id,
    from: msg?.from?.first_name ?? null,
    chat_id: msg?.chat?.id ?? null,
    text,
    replied,
  });
});

// Default-exported so Vercel's Hono serverless preset picks this file up as
// the deployment entrypoint (https://vercel.com/docs/frameworks/backend/hono).
// Local development runs via src/dev.ts (@hono/node-server).
export default app;
