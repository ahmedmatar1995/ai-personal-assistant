// Shared Telegram Bot API helpers for tools that must act on a specific chat
// (e.g. returning result files to the user). The channel's own message send
// logic lives in src/trigger/telegram.ts.
declare const process: { env: Record<string, string | undefined> };

const TELEGRAM_API = "https://api.telegram.org";

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token)
    throw new Error("TELEGRAM_BOT_TOKEN is not set in the task environment");
  return token;
}

// Download link for a file the user sent (file_id from a Telegram update).
// Bot API limit: 20 MB per file.
export async function telegramFileUrl(fileId: string): Promise<string> {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken()}/getFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!res.ok)
    throw new Error(`Telegram getFile failed (${res.status})`);
  const data = (await res.json()) as { result?: { file_path?: string } };
  const path = data.result?.file_path;
  if (!path) throw new Error("Telegram getFile returned no file path");
  return `${TELEGRAM_API}/file/bot${botToken()}/${path}`;
}

// Send a plain text message to a chat.
export async function sendTelegramMessage(
  chatId: number,
  text: string,
): Promise<void> {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    throw new Error(
      `Telegram sendMessage failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    );
  }
}

// Send a file to a chat as a document (multipart). Telegram captions cap at
// 1024 chars.
export async function sendTelegramDocument(
  chatId: number,
  filename: string,
  bytes: Uint8Array<ArrayBuffer>,
  caption?: string,
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([bytes]), filename);
  if (caption) form.append("caption", caption.slice(0, 1024));
  const res = await fetch(`${TELEGRAM_API}/bot${botToken()}/sendDocument`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(
      `Telegram sendDocument failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    );
  }
}
