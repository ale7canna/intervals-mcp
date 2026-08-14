#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { IntervalsClient } from "./client.js";
import { buildServer } from "./server.js";

function loadDotEnv(): void {
  if (typeof process.loadEnvFile !== "function") return;
  for (const candidate of [new URL("../.env", import.meta.url), new URL("file://" + process.cwd() + "/.env")]) {
    try {
      process.loadEnvFile(fileURLToPath(candidate));
      return;
    } catch {
      /* no .env there — env vars from the MCP client config are the normal case */
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  const apiKey = process.env["INTERVALS_API_KEY"];
  if (!apiKey) {
    console.error(
      "intervals-mcp: INTERVALS_API_KEY is not set.\n" +
        "Get an API key from intervals.icu → Settings → Developer Settings, then set it in the MCP\n" +
        "server config (env) or in a .env file next to this package.",
    );
    process.exit(1);
  }

  const client = new IntervalsClient({
    apiKey,
    athleteId: process.env["INTERVALS_ATHLETE_ID"],
  });

  // stdout is the protocol channel on stdio — logs must go to stderr.
  await buildServer(client).connect(new StdioServerTransport());
  console.error("intervals-mcp ready on stdio");
}

main().catch((error: unknown) => {
  console.error("intervals-mcp failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
