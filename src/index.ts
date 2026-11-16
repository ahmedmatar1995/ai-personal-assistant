import { Hono } from "hono";
import type { generateTextTask } from "./trigger/generate-text.js";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.get("/marco", (c) => {
  return c.text("polo");
});

// Test route: kicks off a Trigger.dev run that generates AI text with the
// Gemini free-tier model. Fire-and-forget — responds with the run id; the
// task's result lands in the Trigger.dev dashboard.
app.post("/test", async (c) => {
  let body: { prompt?: string };
  try {
    body = await c.req.json<{ prompt?: string }>();
  } catch {
    body = {};
  }
  const prompt = body.prompt ?? null;
  if (!prompt) {
    return c.json({ error: "missing prompt (JSON body: {prompt})" }, 400);
  }
  try {
    // Lazy import: @trigger.dev/sdk pulls CJS deps that break the Hono CLI's
    // in-process bundler on static import (same reason as "ai" below).
    const { tasks } = await import("@trigger.dev/sdk");
    const handle = await tasks.trigger<typeof generateTextTask>(
      "generate-text",
      { prompt },
    );
    return c.json({ run_id: handle.id, task: "generate-text", prompt });
  } catch (e) {
    return c.json(
      { error: "trigger failed", detail: String(e).slice(0, 200) },
      503,
    );
  }
});

// Default-exported so Vercel's Hono serverless preset picks this file up as
// the deployment entrypoint (https://vercel.com/docs/frameworks/backend/hono).
// Local development runs via src/dev.ts (@hono/node-server).
export default app;
