import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IntervalsClient } from "../client.js";
import { daysFromToday, today } from "../dates.js";
import {
  ACTIVITY_DETAIL_FIELDS,
  ACTIVITY_SUMMARY_FIELDS,
  MAX_STREAM_SAMPLES,
  SELECTABLE_STREAM_TYPES,
  STREAM_TYPES,
  cadenceToSpm,
  compactActivity,
  compactInterval,
  compactStreams,
  formatPace,
  jsonText,
  round,
  sampleIndexForSecond,
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
        "Defaults to the last 30 days. Use get_activity for the summary numbers of one activity.",
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
      title: "Get one activity's summary numbers",
      description:
        "Whole-activity totals and averages for one completed activity: load, intensity, zone " +
        "times, decoupling, efficiency factor, average running dynamics, and the thresholds " +
        "that were in force. Every figure is an aggregate over the entire activity — for the " +
        "per-lap breakdown use get_activity_intervals, and for the per-second samples inside a " +
        "segment use get_activity_samples. Optionally includes the lap/interval breakdown.",
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

  server.registerTool(
    "get_activity_samples",
    {
      title: "Get the per-second data of an activity",
      description:
        "The raw per-second samples of a completed activity — heart rate, power, speed, cadence, " +
        "altitude and distance. This is the only tool that returns individual samples: " +
        "get_activity gives whole-activity averages, get_activity_intervals gives per-lap " +
        "averages. Use it when an average hides the answer: did HR drift across the rep, was " +
        "the power ragged or smooth, did the pace hold to the end.\n\n" +
        "A WINDOW IS MANDATORY, and it must be short. Recording is one sample per second, so a " +
        "2h activity holds ~7200 samples per stream; returning one whole would consume your " +
        `entire context window and leave nothing to reason with. The cap is ${MAX_STREAM_SAMPLES} ` +
        "samples, about 20 minutes at 1Hz.\n\n" +
        "How to choose the window:\n" +
        "1. PREFER `interval`. Call get_activity_intervals first, find the lap you care about, " +
        "and pass its 1-based position. Lap boundaries are the session's real structure, so this " +
        "is the right window almost every time, and it needs no arithmetic.\n" +
        "2. Use `startTimeSeconds`/`endTimeSeconds` only for a span the laps do not delimit — " +
        "the closing 5 minutes, say, or a stretch crossing several laps. Do not guess the " +
        "offsets: read `start_time`/`end_time` off get_activity_intervals, or the activity's " +
        "length from `moving_time`/`elapsed_time` on get_activity, and compute from those.\n" +
        "3. If the span you want is longer than the cap, do not retry with the same window. " +
        "Either walk it in consecutive windows (and say why you need each one), or accept the " +
        "per-lap averages from get_activity_intervals, which answer most questions at a " +
        "fraction of the cost.\n" +
        "4. Narrowing `streamTypes` does not buy a longer window — the cap counts samples, " +
        "not streams — but it does cut the cost of the window you take, so ask only for the " +
        "streams your question needs.",
      inputSchema: {
        activity_id: z.string().describe('Activity id, e.g. "i12345678".'),
        interval: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "1-based interval/lap number, in the order get_activity_intervals lists them — so " +
              "call that first rather than guessing. Resolved to the lap's own time window " +
              "automatically, which is why this is the preferred way to slice. Takes precedence " +
              "over startTimeSeconds/endTimeSeconds.",
          ),
        startTimeSeconds: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "Start of the window, in seconds from the beginning of the activity (inclusive). " +
              "Derive it from a lap's `start_time` or from the activity's duration — never from " +
              "a guess. Ignored when `interval` is given.",
          ),
        endTimeSeconds: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "End of the window, in seconds from the beginning of the activity (exclusive), so " +
              "endTimeSeconds - startTimeSeconds is the duration returned.",
          ),
        streamTypes: z
          .array(z.enum(SELECTABLE_STREAM_TYPES))
          .optional()
          .describe(
            `Which streams to return (default all of: ${SELECTABLE_STREAM_TYPES.join(", ")}). ` +
              "The time stream is always returned and is not selectable.",
          ),
      },
    },
    async ({ activity_id, interval, startTimeSeconds, endTimeSeconds, streamTypes }) => {
      let fromSec = startTimeSeconds;
      let toSec = endTimeSeconds;
      let source =
        startTimeSeconds === undefined && endTimeSeconds === undefined
          ? "whole activity"
          : "explicit window";
      let lap: Json | undefined;

      if (interval !== undefined) {
        const dto = await fetchIntervals(client, activity_id);
        const laps = (dto["intervals"] as Json[] | undefined) ?? [];
        lap = laps[interval - 1];
        if (!lap) {
          return jsonText({
            error: `Activity ${activity_id} has ${laps.length} intervals, so interval ${interval} does not exist.`,
          });
        }
        if (typeof lap["start_time"] !== "number" || typeof lap["end_time"] !== "number") {
          return jsonText({
            error:
              `Interval ${interval} of ${activity_id} carries no start_time/end_time, so it ` +
              "cannot be resolved to a time window. Pass startTimeSeconds and endTimeSeconds instead.",
          });
        }
        fromSec = lap["start_time"] as number;
        toSec = (lap["end_time"] as number) + 1;
        source = `interval ${interval}`;
      }

      // `time` is always included: it is the lookup table for seconds -> sample index, and the
      // axis for any later downsampling, so it is neither selectable nor omittable.
      const chosen = streamTypes?.length ? streamTypes : SELECTABLE_STREAM_TYPES;
      const wanted = ["time", ...chosen];
      const raw = await client.request<unknown>(
        `/activity/${encodeURIComponent(activity_id)}/streams`,
        { query: { types: wanted.join(",") } },
      );

      const list = Array.isArray(raw) ? (raw as Json[]) : [];
      const timeStream = list.find((entry) => entry?.["type"] === "time")?.["data"];
      const total = Math.max(
        0,
        ...list.map((entry) => (Array.isArray(entry?.["data"]) ? (entry["data"] as unknown[]).length : 0)),
      );

      const from = fromSec === undefined ? 0 : sampleIndexForSecond(timeStream, fromSec, "start");
      const to =
        toSec === undefined ? total : Math.min(total, sampleIndexForSecond(timeStream, toSec - 1, "end"));

      const samples = Math.max(0, to - from);
      const durationSec = toSec === undefined ? undefined : toSec - (fromSec ?? 0);
      if (samples === 0) {
        return jsonText({
          error:
            `No samples between ${fromSec ?? 0}s and ${toSec ?? "end"}s; the activity is ` +
            `${total} samples long.`,
        });
      }
      if (samples > MAX_STREAM_SAMPLES) {
        return jsonText({
          error:
            `That window is ${samples} samples${durationSec ? ` (${durationSec}s)` : ""} and the ` +
            `cap is ${MAX_STREAM_SAMPLES} (~20 min at 1Hz); returning it would flood the ` +
            `context. The activity is ${total} samples long. Narrow it with \`interval\` (see ` +
            "get_activity_intervals) or a shorter startTimeSeconds/endTimeSeconds window, or use " +
            "get_activity_intervals for whole-activity averages.",
        });
      }

      const streams = compactStreams(raw, from, to, wanted);
      if (Array.isArray(streams["cadence"])) {
        streams["cadence_spm"] = cadenceToSpm(streams["cadence"]);
        delete streams["cadence"];
      }

      const payload: Json = {
        activity_id,
        slice: {
          source,
          start_time_seconds: fromSec ?? 0,
          end_time_seconds: toSec ?? total,
          samples,
          // The resolved indices, for the sibling endpoints that speak index windows
          // (interval-stats, best-efforts, weather-summary).
          start_index: from,
          end_index: to,
        },
        streams,
        notes: [
          "One sample per second. Nulls appear mid-stream even where allNull is false, and " +
            "watts/cadence use 0 rather than null for the same missing-data condition — neither " +
            "a null nor a 0 proves the athlete stopped.",
          "cadence_spm is doubled from the API's per-leg value.",
        ],
      };
      if (lap) {
        payload["interval"] = lap;
        (payload["notes"] as string[]).push(
          "Averages for this window are in `interval`, computed by intervals.icu from the " +
            "full-precision data — they are not recomputed here.",
        );
      }
      // Stats are worth the tokens only when nothing else reports them: a lap slice already
      // carries intervals.icu's own averages on `interval`. Null counts always ship, since
      // they are invisible in the arrays otherwise.
      const summary = summariseStreams(streams, !lap);
      if (Object.keys(summary).length) payload["summary"] = summary;
      return jsonText(payload);
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

/** Cheap per-slice statistics, so the caller can read the shape without counting by hand. */
function summariseStreams(streams: Json, includeStats: boolean): Json {
  const out: Json = {};
  for (const [type, data] of Object.entries(streams)) {
    if (type === "time" || !Array.isArray(data)) continue;
    const nums = data.filter((v): v is number => typeof v === "number");
    const missing = data.length - nums.length;
    const stat: Json = {};
    if (includeStats && nums.length) {
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      stat["avg"] = round(avg, 1);
      stat["min"] = round(min, 1);
      stat["max"] = round(max, 1);
      if (type === "velocity_smooth") {
        stat["avg_pace"] = formatPace(avg);
        stat["best_pace"] = formatPace(max);
      }
    }
    if (missing) stat["missing"] = missing;
    if (Object.keys(stat).length) out[type] = stat;
  }
  return out;
}
