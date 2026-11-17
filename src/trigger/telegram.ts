import { chat } from "@trigger.dev/sdk/ai";
import { webhooks } from "@trigger.dev/sdk";
import { google } from "@ai-sdk/google";
import { stepCountIs } from "ai";
import { webSearch } from "./tools/web-search.js";
import { readPage } from "./tools/scrape.js";
import { listSiteLinks } from "./tools/map.js";
import { readSite } from "./tools/crawl.js";
import { readManyPages } from "./tools/batch-scrape.js";
import { deepResearch } from "./tools/agent.js";
import { readDocument } from "./tools/parse.js";
import { watchPage, listWatches } from "./tools/monitor.js";
import { makeCodeSandboxTool } from "./tools/code-sandbox.js";

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
    caption?: string;
    from?: { first_name?: string };
    chat: { id: number };
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    photo?: { file_id: string; file_size?: number }[];
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
  // Files (documents, photos) map to a [file attached] note so a turn still
  // runs and the model can hand the file_id to the sandbox tool.
  inbound: (e) => {
    const m = e.message;
    if (!m) return "";
    const text = m.text ?? m.caption ?? "";
    if (m.document) {
      const d = m.document;
      return `${text ? text + "\n" : ""}[file attached] name=${d.file_name ?? "file"} type=${d.mime_type ?? "unknown"} size=${d.file_size ?? "?"} file_id=${d.file_id}`;
    }
    if (m.photo?.length) {
      // Telegram sends several photo sizes; the last is the largest.
      const p = m.photo[m.photo.length - 1];
      return `${text ? text + "\n" : ""}[file attached] kind=photo size=${p.file_size ?? "?"} file_id=${p.file_id}`;
    }
    return text;
  },
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

You have web tools. Pick the lightest one that answers the question, and use them without announcing them:
- web_search: search the web and news. The default for anything current or outside your knowledge.
- read_page: read one specific URL for its full content. Extras: a summary, the page's links, structured data you describe (extractPrompt), clicking a button to expand content (clickSelector), or waiting for slow pages (waitFor).
- list_site_links: find the pages of a site, ranked by a term (e.g. "pricing"), before reading the right one.
- read_many_pages: read a handful of known URLs in one go.
- read_site: read many pages of one site — heavier; keep the limit small (10).
- read_document: read a PDF/Word/Excel file link.
- deep_research: autonomous multi-site research that runs for several minutes and costs much more — only when search plus page reads clearly won't be enough.
- watch_page: start watching pages for meaningful changes on a schedule; list_watches: review current watches and their latest results.
- run_code: process files the user sent, or run a computation, in a private workspace — data work on CSVs, spreadsheets, documents, images (convert, analyze, summarize, generate) — and send result files back to the chat when that's what the user wants. Attached files appear as [file attached] notes with a file_id: pass the file_ids as inputFiles, and write anything the user should receive into /home/daytona/output/ and list it in returnFiles.

Do NOT use them for everyday conversation, stable general knowledge (math, history, how-to explanations), or things the user already told you in this chat. Use run_code only when the request genuinely needs file processing or a real computation — not for arithmetic you can do yourself.

When the user sends a file with no instructions, briefly confirm you have it and ask what they'd like done with it.

When you use them: prefer one search over several; read at most the one or two most promising pages; never invent URLs — search or list site links to find them. Answer in your own words from what you found, and list supporting links at the end as plain URLs. Lead with what you found, not with what you can't do — if you cannot do something (like completing a booking or seeing a live table), put that in one short sentence at the very end, after the useful results. If a tool fails or finds nothing useful, say what you couldn't verify and answer from your own knowledge with appropriate uncertainty. Never mention tool names, that you searched, or how the lookup happened — just give the answer.`,
  channels: [telegramChannel],
  // Per-turn resolution: the sandbox tool carries the chat session id and
  // resolves the real Telegram chat id itself at execute time.
  tools: ({ chatId }) => ({
    web_search: webSearch,
    read_page: readPage,
    list_site_links: listSiteLinks,
    read_site: readSite,
    read_many_pages: readManyPages,
    deep_research: deepResearch,
    read_document: readDocument,
    watch_page: watchPage,
    list_watches: listWatches,
    run_code: makeCodeSandboxTool(chatId),
  }),
  run: async ({ messages, tools, signal, streamText }) => {
    // flash-lite's tool selection is inconsistent for "find/book/lookup" asks —
    // force the search when the last user message clearly needs outside info.
    // shortcut: trigger list is English-only; extend when non-English use appears.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const content = lastUser?.content;
    const text =
      typeof content === "string"
        ? content
        : (content ?? [])
            .filter(
              (p): p is { type: "text"; text: string } => p.type === "text",
            )
            .map((p) => p.text)
            .join(" ");
    const needsWeb =
      /\b(search|look\s?up|find|book|reserv|table|restaurant|price|weather|news|latest|today|tonight|now|open|hours|score|ticket|hotel|flight|current|who\s+won)\b/i.test(
        text,
      );
    return streamText({
      model: google("gemini-3.5-flash-lite"),
      messages,
      tools,
      // Force the search on the FIRST step only; later steps must be free so
      // the model can answer from the results (a stream-wide "required" loops
      // on tool calls and never produces final text).
      prepareStep: ({ stepNumber }) =>
        needsWeb && stepNumber === 0
          ? { toolChoice: "required" as const }
          : { toolChoice: "auto" as const },
      stopWhen: stepCountIs(5),
      abortSignal: signal,
    });
  },
});
