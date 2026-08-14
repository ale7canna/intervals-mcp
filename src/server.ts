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
get_wellness for Fitness (CTL), Fatigue (ATL) and Form (TSB), get_athlete for thresholds, zones
and device settings. Write: create_workout (or create_workouts for a whole week) puts structured
workouts on the calendar, from where intervals.icu pushes them to the athlete's device.

Conventions:
- All dates are the athlete's LOCAL dates, format YYYY-MM-DD. Never send a timezone.
- Call get_athlete before writing a workout. A target kind whose threshold is unset (threshold
  pace for pace, FTP for power) is silently dropped from the file sent to the watch — absolute
  targets included — so every step arrives as "No Target". create_workout warns about this in
  device_export_warning: never ignore that warning, fix the cause.
- Percentage targets (% of FTP / LTHR / max HR / threshold pace) follow the athlete's thresholds
  automatically, which is what you want when those thresholds are trustworthy. Absolute targets
  (4:30/km Pace, 220w) are the safer choice when they are not.
- Consult workout_syntax_guide before writing a description. "m" means minutes and metres are
  "mtr"; a step's text cue must come BEFORE its duration or it is silently discarded.
- The device upload is triggered by a change to the event, not by a schedule. After fixing a
  threshold or a setting, touch the affected events, then confirm with check_garmin_push.
- Writes land on the athlete's calendar and watch. Confirm before creating, moving or changing
  events, never delete one that was not explicitly named, and never change sport settings
  (thresholds, zones, load order) without asking first.
- Load and intensity are computed from whichever threshold is configured. When the data
  contradicts it — a pace far off threshold at near-threshold heart rate, for instance — say so
  instead of silently trusting either number.`;

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
