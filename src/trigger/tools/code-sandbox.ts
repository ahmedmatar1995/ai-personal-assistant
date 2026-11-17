import { tool } from "ai";
import { z } from "zod";
import { Daytona } from "@daytona/sdk";
import { sessions } from "@trigger.dev/sdk";
import { telegramFileUrl, sendTelegramDocument } from "../../lib/telegram.js";

const INPUT_DIR = "/home/daytona/input";
const OUTPUT_DIR = "/home/daytona/output";
const MAX_RESULT_CHARS = 4000;

// One-shot code tool: every call gets a fresh sandbox that is deleted
// afterwards, so there is no state between calls. Named without vendor
// vocabulary — the Telegram user just asks for "file work" or a computation.
export function makeCodeSandboxTool(sessionId: string) {
  return tool({
    description:
      "Process files attached to this conversation and run computations in a private workspace: analyze, convert, summarize, generate or transform data files (CSV, spreadsheets, documents, images, datasets), or run code too involved to answer inline. Files the user sent appear in the conversation as [file attached] notes with a file_id. Can send result files back to the chat. Do not use for simple questions you can answer directly.",
    inputSchema: z.object({
      language: z
        .enum(["python", "typescript", "javascript"])
        .optional()
        .describe("Runtime to run the code in (default: python)"),
      code: z
        .string()
        .describe(
          "Code to run. Attached files are already in /home/daytona/input/. stdout from print() is captured as the result. Write anything the user should receive as a file into /home/daytona/output/.",
        ),
      inputFiles: z
        .array(
          z.object({
            fileId: z.string().describe("file_id from the [file attached] note"),
            name: z
              .string()
              .describe("Filename to give the file in /home/daytona/input/"),
          }),
        )
        .max(5)
        .optional()
        .describe("Attached files to copy into the workspace before running"),
      timeout: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe("Execution time limit in seconds (default 60)"),
      returnFiles: z
        .array(z.string())
        .max(5)
        .optional()
        .describe(
          "Filenames in /home/daytona/output/ to send back to the chat as files",
        ),
    }),
    execute: async ({ language, code, inputFiles, timeout, returnFiles }) => {
      // Resolve the real Telegram chat id from the durable session — never
      // from model context. The session's externalId is the channel key value,
      // i.e. the chat id the conversation is keyed on.
      const session = await sessions.retrieve(sessionId);
      const chatId = Number(session.externalId);
      if (!session.externalId || !Number.isFinite(chatId))
        throw new Error("Could not resolve the chat for file delivery");

      const daytona = new Daytona();
      const sandbox = await daytona.create({ language: language ?? "python" });
      try {
        await sandbox.process.executeCommand(
          `mkdir -p ${INPUT_DIR} ${OUTPUT_DIR}`,
        );

        for (const f of inputFiles ?? []) {
          const url = await telegramFileUrl(f.fileId);
          const res = await fetch(url);
          if (!res.ok)
            throw new Error(`Could not download "${f.name}" (${res.status})`);
          const bytes = new Uint8Array(await res.arrayBuffer());
          // Keep it a plain filename inside the input dir.
          const name = f.name.replace(/^.*[\\/]/, "");
          await sandbox.fs.uploadFileStream(bytes, `${INPUT_DIR}/${name}`);
        }

        let result;
        try {
          result = await sandbox.process.codeRun(code, {}, timeout ?? 60);
        } catch (err) {
          return {
            ok: false as const,
            error:
              err instanceof Error ? err.message : "Execution failed or timed out",
          };
        }

        const stdout = result.result ?? "";
        const output =
          stdout.length > MAX_RESULT_CHARS
            ? `${stdout.slice(0, MAX_RESULT_CHARS / 2)}\n...[output truncated]...\n${stdout.slice(-MAX_RESULT_CHARS / 2)}`
            : stdout;

        const filesSent: string[] = [];
        for (const requested of returnFiles ?? []) {
          // Same plain-filename constraint as inputs.
          const name = requested.replace(/^.*[\\/]/, "");
          // downloadFile returns a Buffer (ArrayBufferLike); copy once so the
          // result is plain-ArrayBuffer-backed for the multipart upload.
          const bytes = new Uint8Array(
            await sandbox.fs.downloadFile(`${OUTPUT_DIR}/${name}`),
          );
          await sendTelegramDocument(
            chatId,
            name,
            bytes,
            "Result file from your request",
          );
          filesSent.push(name);
        }

        return {
          ok: result.exitCode === 0,
          exitCode: result.exitCode,
          output,
          ...(filesSent.length > 0 ? { filesSent } : {}),
        };
      } finally {
        await sandbox.delete();
      }
    },
  });
}
