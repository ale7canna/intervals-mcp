import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IntervalsClient } from "./client.js";
import { registerActivityTools } from "./tools/activities.js";
import { registerAthleteTools } from "./tools/athlete.js";
import { registerEventTools } from "./tools/events.js";
import { registerWellnessTools } from "./tools/wellness.js";
import { WORKOUT_SYNTAX_GUIDE } from "./workout-syntax.js";

export const SERVER_NAME = "intervals-icu";
export const SERVER_VERSION = "0.2.0";

export const INSTRUCTIONS = `intervals.icu training data and workout planning.

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

/** Builds a fully-registered MCP server. Transport-agnostic: used by stdio and HTTP alike. */
export function buildServer(client: IntervalsClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
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

  return server;
}
