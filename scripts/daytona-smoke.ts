// Smoke test for the Daytona SDK: create a sandbox, run "Hello World" inside
// it, and delete the sandbox. Requires DAYTONA_API_KEY in .env.
// Run: bun scripts/daytona-smoke.ts
import { Daytona } from "@daytona/sdk";

const daytona = new Daytona(); // reads DAYTONA_API_KEY from the environment

const sandbox = await daytona.create({ language: "typescript" });
try {
  const response = await sandbox.process.executeCommand(
    'echo "Hello World from Daytona"',
  );
  if (response.exitCode !== 0) {
    throw new Error(`Command failed with exit code ${response.exitCode}`);
  }
  console.log(response.result.trim());
  console.log("Sandbox OK:", sandbox.id);
} finally {
  await sandbox.delete();
}
