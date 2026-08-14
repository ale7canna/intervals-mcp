#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { IntervalsClient } from "./client.js";
import { registerActivityTools } from "./tools/activities.js";
import { registerAthleteTools } from "./tools/athlete.js";
import { registerEventTools } from "./tools/events.js";
import { registerWellnessTools } from "./tools/wellness.js";
import { WORKOUT_SYNTAX_GUIDE } from "./workout-syntax.js";

const INSTRUCTIONS = `intervals.icu training data and workout planning.

Read: list_activities / get_activity / get_activity_intervals for completed training,
get_wellness for Fitness (CTL), Fatigue (ATL) and Form (TSB), get_athlete for thresholds.
Write: create_workout (or create_workouts for a whole week) puts structured workouts on the
calendar, from where intervals.icu pushes them to the athlete's device.

Conventions:
- All dates are the athlete's LOCAL dates, format YYYY-MM-DD. Never send a timezone.
- Write workout targets as percentages (of FTP, LTHR, max HR or threshold pace) so they follow
  the athlete's current thresholds. Confirm those thresholds with get_athlete first.
- Consult workout_syntax_guide before writing a workout description.
- After creating a workout meant for a watch, check_garmin_push confirms the upload path.`;

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

  const server = new McpServer(
    { name: "intervals-icu", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  server.registerResource(
    "workout-syntax",
    "intervals://workout-syntax",
    {
      title: "intervals.icu workout syntax",
      description: "Reference for the intervals.icu workout text format and device push rules.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: WORKOUT_SYNTAX_GUIDE }],
    }),
  );

  registerAthleteTools(server, client);
  registerActivityTools(server, client);
  registerWellnessTools(server, client);
  registerEventTools(server, client);

  await server.connect(new StdioServerTransport());
  console.error("intervals-mcp ready on stdio");
}

main().catch((error: unknown) => {
  console.error("intervals-mcp failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
