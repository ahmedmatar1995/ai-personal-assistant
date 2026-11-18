import { Hono } from "hono";
import { verifyToken } from "@clerk/backend";
import { tasks, wait } from "@trigger.dev/sdk";
import { and, eq, gt } from "drizzle-orm";
import { db } from "./db/index.js";
import { channelIdentifiers, linkCodes } from "./db/schema.js";
import { sendTelegramMessage } from "./lib/telegram.js";
import type { connectTelegram } from "./trigger/connect.js";
import type { TelegramUpdate } from "./trigger/telegram.js";

// Same constraint as the other src files: this project's TypeScript does not
// auto-load @types/node, and a types:["node"] entry breaks Vercel's build.
declare const process: { env: Record<string, string | undefined> };

// How long a stranger has to approve the connect link. Must match
// LINK_TTL in src/trigger/connect.ts (the waiting task).
const LINK_TTL_SECONDS = 15 * 60;

// Device-flow style code alphabet: uppercase + digits, no 0/1/O/I/L lookalikes.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join("");
}

function publicBaseUrl(c: {
  req: { header(name: string): string | undefined; url: string };
}): string {
  const host = c.req.header("x-forwarded-host") ?? new URL(c.req.url).host;
  const proto = c.req.header("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

function billingUrl(): string {
  return process.env.CLERK_BILLING_URL || "https://cheerful-coyote-5378.accounts.dev/user";
}

// Look up the user's current Clerk billing plan slug via the Backend API.
// Returns null on any error or missing subscription - callers treat null as
// "not entitled" (fail closed).
async function userPlanSlug(clerkUserId: string): Promise<string | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;
  try {
    const res = await fetch(
      `https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}/billing/subscription`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      subscription_items?: { plan?: { slug?: string } }[];
    };
    return data.subscription_items?.[0]?.plan?.slug ?? null;
  } catch (err) {
    console.error("plan lookup failed", err);
    return null;
  }
}

const app = new Hono();

app.get("/", (c) => {
  return c.text("hello hono");
});

// Telegram webhook gate. Telegram delivers updates here (registered via
// setWebhook with secret_token); Hono decides who may talk to the agent.
app.post("/telegram", async (c) => {
  const secret = c.req.header("x-telegram-bot-api-secret-token");
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || secret !== expected) return c.text("Unauthorized", 401);

  let update: TelegramUpdate;
  try {
    update = await c.req.json<TelegramUpdate>();
  } catch {
    return c.text("ok"); // malformed body: acknowledge, don't cause retries
  }
  const m = update.message;
  const fromId = m?.from?.id;
  if (!m || fromId === undefined) return c.text("ok");

  const telegramUserId = String(fromId);

  // Linked user → forward to the Trigger ingest unchanged (plus the Clerk
  // owner id as an extra body field). The ingest endpoint dedupes on
  // update_id, so Telegram's retries stay safe.
  const [linked] = await db
    .select()
    .from(channelIdentifiers)
    .where(
      and(
        eq(channelIdentifiers.platform, "telegram"),
        eq(channelIdentifiers.externalId, telegramUserId),
      ),
    )
    .limit(1);

  if (linked) {
    // Subscription gate: only Pro users may use the agent. Unlinked users
    // never reach here (handled below). Linked non-Pro users get a link to
    // upgrade in the hosted Account Portal instead of running the agent.
    const plan = await userPlanSlug(linked.clerkUserId);
    if (plan !== "pro") {
      try {
        await sendTelegramMessage(
          m.chat.id,
          `This assistant requires a Pro subscription. Upgrade here: ${billingUrl()}`,
        );
      } catch (err) {
        console.error("billing reply failed", err);
      }
      return c.text("ok");
    }

    const ingestUrl = process.env.TRIGGER_INGEST_URL;
    if (!ingestUrl) return c.text("TRIGGER_INGEST_URL is not set", 500);
    const res = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": secret,
      },
      body: JSON.stringify({ ...update, clerk_user_id: linked.clerkUserId }),
    });
    if (!res.ok) return c.text("Upstream rejected the update", 502);
    return c.text("ok");
  }

  // Unlinked sender in a group: ignore silently. This is a personal
  // assistant — never solicit connections in shared chats.
  if (m.chat.type !== "private") return c.text("ok");

  // Stranger in a private chat: the agent never runs. Hand them an approval
  // link + short code and start the waiting task. Reuse an existing pending
  // code so repeated messages don't spawn more tasks.
  const [pending] = await db
    .select()
    .from(linkCodes)
    .where(
      and(
        eq(linkCodes.telegramUserId, telegramUserId),
        eq(linkCodes.status, "pending"),
        gt(linkCodes.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const code = pending?.code ?? randomCode();
  if (!pending) {
    await db.insert(linkCodes).values({
      code,
      telegramUserId,
      chatId: String(m.chat.id),
      expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000),
    });
    try {
      await tasks.trigger<typeof connectTelegram>("connect-telegram", {
        code,
        telegramUserId,
        chatId: m.chat.id,
      });
    } catch (err) {
      // No waiting task → the code can never be approved. Drop the row so the
      // next message starts fresh, and let Telegram retry the update.
      await db.delete(linkCodes).where(eq(linkCodes.code, code));
      console.error("connect-telegram trigger failed", err);
      return c.text("Upstream rejected the update", 502);
    }
  }

  const link = `${publicBaseUrl(c)}/connect/${code}`;
  try {
    await sendTelegramMessage(
      m.chat.id,
      `This assistant is private. To connect your account:\n\n1. Open ${link}\n2. Sign in and approve the connection\n\nYour code: ${code} (valid for 15 minutes)`,
    );
  } catch (err) {
    // Telegram reply failed (e.g. bot blocked). Keep the code alive so the
    // next message reuses it and retries the reply.
    console.error("connect reply failed", err);
  }
  return c.text("ok");
});

const CONNECT_PAGE = (code: string, publishableKey: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect your account</title>
<style>
  body { font-family: system-ui, sans-serif; display: grid; place-items: center;
         min-height: 90vh; margin: 0; background: #f6f7f9; color: #1a1a1a; }
  .card { background: #fff; border-radius: 12px; padding: 2rem; max-width: 26rem;
          box-shadow: 0 1px 4px rgba(0,0,0,.1); text-align: center; }
  code { font-size: 1.6rem; letter-spacing: .3em; display: block; margin: 1rem 0; }
  a.btn { display: none; margin-top: 1rem; background: #2d5bd1; color: #fff;
          padding: .7rem 1.4rem; border-radius: 8px; text-decoration: none; }
</style>
</head>
<body>
<div class="card">
  <h1>Connect your account</h1>
  <p>Enter this code if the page asks for it:</p>
  <code>${code}</code>
  <p id="state">Loading&hellip;</p>
  <a class="btn" id="signin" href="#">Sign in to approve</a>
</div>
<script crossorigin="anonymous" src="https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js" data-clerk-publishable-key="${publishableKey}"></script>
<script>
  const CODE = "${code}";
  const PK = "${publishableKey}";
  async function main() {
    const state = document.getElementById("state");
    const clerk = window.Clerk;
    await clerk.load({ publishableKey: PK });
    if (clerk.session) {
      // Returned from the hosted sign-in: clerk-js sees the session via the
      // Clerk cookie domain and we hand the session token to our server.
      const res = await fetch("/connect/" + CODE + "/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // lastActiveToken is an object ({jwt, ...}); getToken() is the raw string.
        body: JSON.stringify({ token: await clerk.session.getToken() }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok) {
        state.textContent = "Connected! You can go back to Telegram.";
      } else if (out.error === "expired") {
        state.textContent = "This code expired. Send another message to the bot to get a new one.";
      } else {
        state.textContent = "Something went wrong. Send another message to the bot and try again.";
      }
    } else {
      state.textContent = "Sign in to approve this connection.";
      const btn = document.getElementById("signin");
      btn.href = clerk.buildSignInUrl({ redirectUrl: window.location.href });
      btn.style.display = "inline-block";
    }
  }
  main().catch(() => {
    document.getElementById("state").textContent =
      "Could not load sign-in. Send another message to the bot and try again.";
  });
</script>
</body>
</html>`;

const INVALID_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Connect your account</title>
<style>body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 90vh; margin: 0; }</style>
</head>
<body><p>This link is invalid or has expired. Send another message to the bot to get a new one.</p></body>
</html>`;

const VALID_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

app.get("/connect/:code", async (c) => {
  const code = c.req.param("code");
  const pk = process.env.CLERK_PUBLISHABLE_KEY ?? "";
  if (!VALID_CODE.test(code) || !/^pk_(test|live)_[A-Za-z0-9]+$/.test(pk)) {
    return c.html(INVALID_PAGE, 404);
  }
  const [row] = await db
    .select()
    .from(linkCodes)
    .where(eq(linkCodes.code, code))
    .limit(1);
  if (
    !row ||
    row.status === "expired" ||
    row.expiresAt.getTime() < Date.now()
  ) {
    return c.html(INVALID_PAGE, 404);
  }
  if (row.status === "approved") {
    return c.html(
      `<p style="font-family:system-ui;display:grid;place-items:center;min-height:90vh">Already connected! You can go back to Telegram.</p>`,
    );
  }
  return c.html(CONNECT_PAGE(code, pk));
});

// Completes a pending connect code after verifying the approving user's
// Clerk session token. The waiting task then records the mapping.
app.post("/connect/:code/approve", async (c) => {
  const code = c.req.param("code");
  if (!VALID_CODE.test(code)) return c.json({ error: "not_found" }, 404);

  let token: string | undefined;
  try {
    token = (await c.req.json<{ token?: string }>()).token;
  } catch {
    /* handled below */
  }
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!token || !secretKey) return c.json({ error: "invalid_token" }, 401);

  // @clerk/backend v3 changed verifyToken at runtime: it returns the JWT
  // payload DIRECTLY and THROWS on invalid tokens — its own .d.ts still claims
  // the old {data, errors} shape, so trust the behavior verified locally.
  let clerkUserId: string | undefined;
  try {
    const payload = (await verifyToken(token, { secretKey })) as {
      sub?: string;
    };
    clerkUserId = payload?.sub;
  } catch (err) {
    console.error(
      "approve token rejected:",
      err instanceof Error ? err.message : err,
    );
    return c.json({ error: "invalid_token" }, 401);
  }
  if (!clerkUserId) {
    console.error("approve token rejected: payload has no sub");
    return c.json({ error: "invalid_token" }, 401);
  }

  const [row] = await db
    .select()
    .from(linkCodes)
    .where(eq(linkCodes.code, code))
    .limit(1);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status === "approved") {
    return c.json({ ok: row.clerkUserId === clerkUserId ? true : "conflict" });
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await db
      .update(linkCodes)
      .set({ status: "expired" })
      .where(eq(linkCodes.code, code));
    return c.json({ error: "expired" }, 410);
  }

  const updated = await db
    .update(linkCodes)
    .set({ status: "approved", clerkUserId })
    .where(and(eq(linkCodes.code, code), eq(linkCodes.status, "pending")))
    .returning({ id: linkCodes.code });
  if (updated.length === 0) return c.json({ error: "expired" }, 410);

  if (row.triggerTokenId) {
    try {
      await wait.completeToken(row.triggerTokenId, { clerkUserId });
    } catch {
      // The waiting task already timed out; the user was told in Telegram.
      return c.json({ error: "expired" }, 410);
    }
  }
  return c.json({ ok: true });
});

app.notFound((c) => c.text("Not Found", 404));

// Default-exported so Vercel's Hono serverless preset picks this file up as
// the deployment entrypoint (https://vercel.com/docs/frameworks/backend/hono).
// Local development runs via src/dev.ts (@hono/node-server).
export default app;
