import { tool } from "ai";
import { z } from "zod";
import { firecrawl, requireFirecrawl } from "../../lib/firecrawl.js";

// Document file reader: downloads the file, sends the bytes to be converted
// to text. Covers PDF, Word, Excel and HTML.
export const readDocument = tool({
  description:
    "Read a document file by URL — PDF, Word, Excel or HTML — and return its text content. Use it when a link points at a file rather than a normal web page.",
  inputSchema: z.object({
    url: z.string().url().describe("URL of the document file"),
  }),
  execute: async ({ url }) => {
    requireFirecrawl();
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Could not download the document (HTTP ${res.status})`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    const filename = url.split("?")[0].split("/").pop() || "document";
    const doc = await firecrawl.parse({
      data: new Uint8Array(await res.arrayBuffer()),
      filename,
      ...(contentType ? { contentType } : {}),
    });
    return {
      title: doc.metadata?.title ?? filename,
      content: (doc.markdown ?? "").slice(0, 8000),
    };
  },
});
