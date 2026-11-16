import { serve } from "@hono/node-server";
import app from "./index.js";

// Local development server. Not used in production — Vercel deploys
// src/index.ts directly through its Hono serverless preset.
serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
