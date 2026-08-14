import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IntervalsClient } from "../client.js";
import { daysFromToday, today } from "../dates.js";
import {
  ACTIVITY_DETAIL_FIELDS,
  ACTIVITY_SUMMARY_FIELDS,
  compactActivity,
  compactInterval,
  jsonText,
  type Json,
} from "../format.js";

export function registerActivityTools(server: McpServer, client: IntervalsClient): void {
  server.registerTool(
    "list_activities",
    {
      title: "List completed activities",
      description:
        "Completed activities for a date range, newest first, with the headline numbers " +
        "(duration, distance, pace/GAP, average power, HR, training load, intensity). " +
        "Defaults to the last 30 days. Use get_activity for the full detail of one activity.",
      inputSchema: {
        oldest: z.string().optional().describe("Oldest local date, YYYY-MM-DD (default: 30 days ago)."),
        newest: z.string().optional().describe("Newest local date, inclusive, YYYY-MM-DD (default: today)."),
        limit: z.number().int().min(1).max(200).optional().describe("Max activities to return (default 50)."),
        type: z
          .string()
          .optional()
          .describe('Filter by activity type, e.g. "Run", "Ride", "Swim", "TrailRun" (case-insensitive).'),
      },
    },
    async ({ oldest, newest, limit, type }) => {
      const activities = await client.request<unknown[]>(await client.athletePath("/activities"), {
        query: {
          oldest: oldest ?? daysFromToday(-30),
          newest: newest ?? today(),
          limit: limit ?? 50,
          fields: ACTIVITY_SUMMARY_FIELDS.join(","),
        },
      });
      const list = Array.isArray(activities) ? activities : [];
      const filtered = type
        ? list.filter((a) => String((a as Json)["type"] ?? "").toLowerCase() === type.toLowerCase())
        : list;
      return jsonText({
        count: filtered.length,
        range: { oldest: oldest ?? daysFromToday(-30), newest: newest ?? today() },
        activities: filtered.map((a) => compactActivity(a)),
      });
    },
  );

  server.registerTool(
    "get_activity",
    {
      title: "Get one activity in detail",
      description:
        "Full detail for a single completed activity: load, intensity, zone times, decoupling, " +
        "efficiency factor, running dynamics, and the thresholds that were in force. " +
        "Optionally includes the lap/interval breakdown.",
      inputSchema: {
        activity_id: z.string().describe('Activity id, e.g. "i12345678".'),
        include_intervals: z
          .boolean()
          .optional()
          .describe("Also return the detected intervals/laps (default false)."),
      },
    },
    async ({ activity_id, include_intervals }) => {
      const activity = await client.request<Json>(`/activity/${encodeURIComponent(activity_id)}`, {
        query: { fields: ACTIVITY_DETAIL_FIELDS.join(",") },
      });
      const payload: Json = { activity: compactActivity(activity, true) };
      if (include_intervals) payload["intervals"] = await fetchIntervals(client, activity_id);
      return jsonText(payload);
    },
  );

  server.registerTool(
    "get_activity_intervals",
    {
      title: "Get the intervals/laps of an activity",
      description:
        "The interval (lap) breakdown of a completed activity — duration, distance, average and " +
        "max power, HR, pace/GAP, cadence and load per interval. Use it to check how an interval " +
        "session was actually executed against its targets.",
      inputSchema: {
        activity_id: z.string().describe('Activity id, e.g. "i12345678".'),
      },
    },
    async ({ activity_id }) => jsonText(await fetchIntervals(client, activity_id)),
  );

  server.registerTool(
    "search_activities",
    {
      title: "Search activities by name or text",
      description:
        "Case-insensitive search over activity names, or an exact tag search when the query " +
        'starts with "#". Use it to find a session when you do not know its date.',
      inputSchema: {
        query: z.string().describe('Search text, or "#tag" for a tag search.'),
        limit: z.number().int().min(1).max(100).optional().describe("Max results (default 20)."),
      },
    },
    async ({ query, limit }) => {
      const results = await client.request<unknown[]>(await client.athletePath("/activities/search"), {
        query: { q: query, limit: limit ?? 20 },
      });
      const list = Array.isArray(results) ? results : [];
      return jsonText({ count: list.length, activities: list.map((a) => compactActivity(a)) });
    },
  );
}

async function fetchIntervals(client: IntervalsClient, activityId: string): Promise<Json> {
  const dto = await client.request<Json>(`/activity/${encodeURIComponent(activityId)}/intervals`);
  const intervals = Array.isArray(dto?.["icu_intervals"]) ? (dto["icu_intervals"] as unknown[]) : [];
  const groups = Array.isArray(dto?.["icu_groups"]) ? (dto["icu_groups"] as unknown[]) : [];
  return {
    activity_id: activityId,
    count: intervals.length,
    intervals: intervals.map(compactInterval),
    groups,
  };
}
