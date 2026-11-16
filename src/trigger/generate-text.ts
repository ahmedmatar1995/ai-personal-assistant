import { task } from "@trigger.dev/sdk";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";

// Generates AI text with the Gemini free-tier model. Runs on Trigger.dev's
// infrastructure (or the local dev worker), so it needs
// GOOGLE_GENERATIVE_AI_API_KEY in its environment — from the shell/.env in
// local dev, from the Trigger.dev dashboard's env vars in production.
export const generateTextTask = task({
  id: "generate-text",
  run: async (payload: { prompt: string }) => {
    const result = await generateText({
      model: google("gemini-3.5-flash-lite"),
      instructions:
        "You are a helpful personal assistant. Reply concisely, in plain text.",
      prompt: payload.prompt,
    });
    return { message: result.text };
  },
});
