import { Hono } from "hono";

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

// Telegram webhook receiver: POST {update: object}, returns what the user sent.
// Registered later via setWebhook against the deployed URL; Telegram expects a
// quick 2xx reply (https://core.telegram.org/bots/webhooks).
app.post("/telegram/webhook", async (c) => {
  let update: TelegramUpdate;
  try {
    update = await c.req.json<TelegramUpdate>();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const msg = update.message;
  return c.json({
    update_id: update.update_id,
    from: msg?.from?.first_name ?? null,
    chat_id: msg?.chat?.id ?? null,
    text: msg?.text ?? null,
  });
});

// Default-exported so Vercel's Hono serverless preset picks this file up as
// the deployment entrypoint (https://vercel.com/docs/frameworks/backend/hono).
// Local development runs via src/dev.ts (@hono/node-server).
export default app;
