import { Hono } from "hono";

const app = new Hono();

// Default-exported so Vercel's Hono serverless preset picks this file up as
// the deployment entrypoint (https://vercel.com/docs/frameworks/backend/hono).
// Local development runs via src/dev.ts (@hono/node-server).
export default app;
