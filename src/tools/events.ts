import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IntervalsClient } from "../client.js";
import { datePart, daysFromToday, toLocalDateTime, today } from "../dates.js";
import {
  compactEvent,
  describeWorkoutDoc,
  jsonText,
  targetKindsUsed,
  unresolvedTargetSports,
  type Json,
  type TargetKind,
} from "../format.js";
import { WORKOUT_SYNTAX_CHEATSHEET, WORKOUT_SYNTAX_GUIDE } from "../workout-syntax.js";

const CATEGORIES = [
  "WORKOUT",
  "RACE_A",
  "RACE_B",
  "RACE_C",
  "NOTE",
  "HOLIDAY",
  "SICK",
  "INJURED",
  "TARGET",
  "SEASON_START",
] as const;

const TARGETS = ["AUTO", "POWER", "HR", "PACE"] as const;

/** Shared field set for creating/updating a planned workout. */
const workoutFields = {
  date: z.string().describe("Local date YYYY-MM-DD (or YYYY-MM-DDTHH:MM:SS to set a start time)."),
  type: z
    .string()
    .describe(
      'Activity type: "Run", "Ride", "Swim", "TrailRun", "VirtualRide", "WeightTraining", "Walk", "Rowing", … ' +
        "(must match an intervals.icu activity type).",
    ),
  name: z.string().describe('Workout name shown on the calendar and on the watch, e.g. "5x1km @ threshold".'),
  description: z
    .string()
    .optional()
    .describe(
      "The workout itself, in intervals.icu text syntax (this is what becomes the structured " +
        "workout pushed to the device). Plain prose is allowed but produces no structure.\n\n" +
        WORKOUT_SYNTAX_CHEATSHEET,
    ),
  indoor: z.boolean().optional().describe("Mark as indoor (uses indoor FTP and disables outdoor target ranges)."),
  target: z
    .enum(TARGETS)
    .optional()
    .describe(
      'Which metric the device should target: "POWER", "HR", "PACE", or "AUTO" (let intervals.icu decide). ' +
        "Leave unset to keep the sport default.",
    ),
  moving_time_seconds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Planned duration in seconds. Omit for structured workouts — it is computed from the steps."),
  distance_meters: z.number().positive().optional().describe("Planned distance in metres (for distance-based plans)."),
  load: z.number().int().positive().optional().describe("Override the planned training load (TSS-like)."),
  sub_type: z.string().optional().describe('Optional sub type, e.g. "Race", "Workout", "LongRun" (free text).'),
  tags: z.array(z.string()).optional().describe("Event tags."),
  color: z.string().optional().describe('Calendar colour, e.g. "red" or "#ff0000".'),
  external_id: z
    .string()
    .optional()
    .describe("Your own id for this event; lets a later bulk create update it instead of duplicating."),
  category: z
    .enum(CATEGORIES)
    .optional()
    .describe('Event category (default "WORKOUT"). Use RACE_A/B/C for races, NOTE for a calendar note.'),
} as const;

const workoutObject = z.object(workoutFields);
type WorkoutInput = z.infer<typeof workoutObject>;

export function registerEventTools(server: McpServer, client: IntervalsClient): void {
  server.registerTool(
    "workout_syntax_guide",
    {
      title: "intervals.icu workout syntax reference",
      description:
        "The full reference for the intervals.icu workout text format — durations, distances, " +
        "power/HR/pace targets, ramps, repeats, sections — plus the rules that matter for pushing " +
        "workouts to a Garmin device. Read this before writing a workout description.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text", text: WORKOUT_SYNTAX_GUIDE }] }),
  );

  server.registerTool(
    "list_calendar_events",
    {
      title: "List planned workouts and calendar events",
      description:
        "Events on the athlete's calendar (planned workouts, races, notes) for a date range. " +
        "Defaults to today plus the next 14 days. Set resolve=true to see targets converted into " +
        "watts, bpm and m/s using the athlete's current thresholds — that is the surest way to " +
        "check what the device will actually show.",
      inputSchema: {
        oldest: z.string().optional().describe("Oldest local date, YYYY-MM-DD (default: today)."),
        newest: z.string().optional().describe("Newest local date, inclusive, YYYY-MM-DD (default: today + 14 days)."),
        category: z
          .enum(CATEGORIES)
          .optional()
          .describe('Filter by category, e.g. "WORKOUT". Omit for everything.'),
        resolve: z
          .boolean()
          .optional()
          .describe("Resolve %-based targets into watts / bpm / m/s (default false)."),
        include_workout_doc: z
          .boolean()
          .optional()
          .describe("Include the raw parsed workout structure as well as the readable step list (default false)."),
      },
    },
    async ({ oldest, newest, category, resolve, include_workout_doc }) => {
      const from = oldest ?? today();
      const to = newest ?? daysFromToday(14);
      const events = await client.request<unknown[]>(await client.athletePath("/events"), {
        query: { oldest: from, newest: to, category, resolve },
      });
      const list = Array.isArray(events) ? events : [];
      return jsonText({
        range: { oldest: from, newest: to },
        resolved_targets: Boolean(resolve),
        count: list.length,
        events: list.map((event) => compactEvent(event, { includeWorkoutDoc: include_workout_doc })),
      });
    },
  );

  server.registerTool(
    "get_event",
    {
      title: "Get one calendar event",
      description: "A single planned workout or calendar event, including its parsed workout steps and push errors.",
      inputSchema: {
        event_id: z.union([z.number().int(), z.string()]).describe("Event id."),
        include_workout_doc: z.boolean().optional().describe("Include the raw parsed workout structure."),
      },
    },
    async ({ event_id, include_workout_doc }) => {
      const event = await client.request<Json>(
        `${await client.athletePath("/events")}/${encodeURIComponent(String(event_id))}`,
      );
      return jsonText({ event: compactEvent(event, { includeWorkoutDoc: include_workout_doc }) });
    },
  );

  server.registerTool(
    "create_workout",
    {
      title: "Create a planned workout on the calendar",
      description:
        "Add a planned (structured) workout to the intervals.icu calendar. intervals.icu parses the " +
        "description into a structured workout, and — when 'Upload planned workouts' is enabled — " +
        "pushes it to the paired device (Garmin, Wahoo, Zwift, Coros) for the coming days.\n\n" +
        "Write targets as percentages (of FTP / LTHR / max HR / threshold pace) so they track the " +
        "athlete's current thresholds; check them first with get_athlete. " +
        "By default the created event is read back with targets resolved, so you can verify the " +
        "actual watts/bpm/pace and any device push errors.\n\n" +
        WORKOUT_SYNTAX_CHEATSHEET,
      inputSchema: {
        ...workoutFields,
        verify: z
          .boolean()
          .optional()
          .describe("Read the event back with resolved targets to verify the parsed steps (default true)."),
      },
    },
    async ({ verify, ...input }) => {
      const body = buildEventBody(input as WorkoutInput);
      const created = await client.request<Json>(await client.athletePath("/events"), {
        method: "POST",
        body,
      });
      const payload: Json = { created: compactEvent(created) };
      if (verify !== false) {
        const resolved = await fetchResolved(client, String(body["start_date_local"]), created["id"]);
        if (resolved) {
          const doc = (resolved["workout_doc"] ?? {}) as Json;
          payload["resolved_steps"] = describeWorkoutDoc(doc);
          payload["resolved_note"] =
            "Targets above are in watts / bpm / m·s⁻¹ as the device will receive them.";
          const missing = await missingThresholds(client, String(body["type"]), doc, Boolean(input.indoor));
          if (missing.length > 0) {
            payload["device_export_warning"] =
              `The workout uses ${missing.map((m) => m.kind).join(" and ")} targets but ` +
              `${missing.map((m) => m.threshold).join(" and ")} is not set for "${String(body["type"])}" ` +
              "in the athlete's sport settings. intervals.icu then DROPS those targets from the file it " +
              "pushes to the device: the steps arrive on the watch as 'No Target', even though they look " +
              "correct here and even when written as absolute values. " +
              "Set the missing threshold (get_athlete shows the current ones), then touch this event so " +
              "the upload runs again.";
          }
          const unresolved = unresolvedTargetSports(doc);
          if (unresolved.length > 0) {
            payload["warning"] =
              `Targets are still expressed in % (${unresolved.join(", ")}), i.e. intervals.icu could not ` +
              `resolve them: the matching threshold is not set for "${String(body["type"])}" ` +
              "(FTP for power, LTHR/max HR for heart rate, threshold pace for pace). " +
              "The device would get fallback values, and distance steps get converted with a fallback pace. " +
              "Fix the sport settings on intervals.icu, or rewrite the workout with absolute targets " +
              "(e.g. 4:30/km Pace, 220w) or with a threshold that is set — check get_athlete.";
          }
          const pushErrors = resolved["push_errors"];
          if (Array.isArray(pushErrors) && pushErrors.length > 0) payload["push_errors"] = pushErrors;
        }
      }
      payload["next"] =
        "Device upload runs on intervals.icu's schedule for the next few days of the calendar; " +
        "use check_garmin_push to confirm it went out.";
      return jsonText(payload);
    },
  );

  server.registerTool(
    "create_workouts",
    {
      title: "Create several planned workouts at once",
      description:
        "Bulk version of create_workout — use it to lay out a whole training week or block in one call. " +
        "With upsert=true, events whose external_id already exists are updated instead of duplicated.\n\n" +
        WORKOUT_SYNTAX_CHEATSHEET,
      inputSchema: {
        workouts: z.array(workoutObject).min(1).max(60).describe("The workouts to create."),
        upsert: z
          .boolean()
          .optional()
          .describe("Update existing events with a matching external_id instead of creating duplicates."),
      },
    },
    async ({ workouts, upsert }) => {
      const created = await client.request<unknown[]>(await client.athletePath("/events/bulk"), {
        method: "POST",
        query: { upsert },
        body: workouts.map((workout) => buildEventBody(workout)),
      });
      const list = Array.isArray(created) ? created : [];
      return jsonText({
        count: list.length,
        events: list.map((event) => compactEvent(event)),
      });
    },
  );

  server.registerTool(
    "update_workout",
    {
      title: "Update a planned workout",
      description:
        "Change fields of an existing calendar event — only the fields you pass are sent. " +
        "Pass a new description to replace the workout structure (the device push follows the change).",
      inputSchema: {
        event_id: z.union([z.number().int(), z.string()]).describe("Event id to update."),
        date: z.string().optional().describe("Move to this local date (YYYY-MM-DD or with time)."),
        type: z.string().optional().describe("New activity type."),
        name: z.string().optional().describe("New name."),
        description: z
          .string()
          .optional()
          .describe(`Replacement workout text.\n\n${WORKOUT_SYNTAX_CHEATSHEET}`),
        indoor: z.boolean().optional(),
        target: z.enum(TARGETS).optional(),
        moving_time_seconds: z.number().int().positive().optional(),
        distance_meters: z.number().positive().optional(),
        load: z.number().int().positive().optional(),
        tags: z.array(z.string()).optional(),
        color: z.string().optional(),
      },
    },
    async ({ event_id, ...changes }) => {
      const body = buildEventBody(changes as Partial<WorkoutInput>, { partial: true });
      if (Object.keys(body).length === 0) {
        throw new Error("Nothing to update — pass at least one field besides event_id.");
      }
      const updated = await client.request<Json>(
        `${await client.athletePath("/events")}/${encodeURIComponent(String(event_id))}`,
        { method: "PUT", body },
      );
      return jsonText({ updated: compactEvent(updated) });
    },
  );

  server.registerTool(
    "delete_event",
    {
      title: "Delete a calendar event",
      description:
        "Remove a planned workout or other event from the calendar. This is not reversible — " +
        "confirm the event with get_event or list_calendar_events first.",
      inputSchema: {
        event_id: z.union([z.number().int(), z.string()]).describe("Event id to delete."),
      },
    },
    async ({ event_id }) => {
      await client.request<unknown>(
        `${await client.athletePath("/events")}/${encodeURIComponent(String(event_id))}`,
        { method: "DELETE" },
      );
      return jsonText({ deleted: event_id });
    },
  );

  server.registerTool(
    "check_garmin_push",
    {
      title: "Check that planned workouts reach the watch",
      description:
        "Diagnose the device push: whether 'Upload planned workouts' is enabled, when intervals.icu " +
        "last uploaded, which target ranges it applies, and any push errors on the upcoming planned " +
        "workouts. Use it after creating a workout that should appear on the Garmin.",
      inputSchema: {
        days: z.number().int().min(1).max(30).optional().describe("How many days ahead to inspect (default 7)."),
      },
    },
    async ({ days }) => {
      const horizon = days ?? 7;
      const athlete = await client.request<Json>(`/athlete/${await client.athleteId()}`);
      const events = await client.request<unknown[]>(await client.athletePath("/events"), {
        query: { oldest: today(), newest: daysFromToday(horizon), category: "WORKOUT" },
      });
      const list = Array.isArray(events) ? events : [];
      const problems = list
        .map((event) => event as Json)
        .filter((event) => Array.isArray(event["push_errors"]) && (event["push_errors"] as unknown[]).length > 0)
        .map((event) => ({
          id: event["id"],
          date: event["start_date_local"],
          name: event["name"],
          push_errors: event["push_errors"],
        }));
      const uploadEnabled = athlete["icu_garmin_upload_workouts"];
      return jsonText({
        garmin: {
          upload_planned_workouts: uploadEnabled,
          last_upload: athlete["icu_garmin_last_upload"],
          outdoor_power_range_percent: athlete["icu_garmin_outdoor_power_range"],
          hr_range_percent: athlete["icu_garmin_hr_range"],
          pace_range_percent: athlete["garmin_pace_range"],
          power_target: athlete["garmin_power_target"],
          upload_filters: athlete["icu_garmin_upload_filters"],
          sync_activities: athlete["icu_garmin_sync_activities"],
        },
        planned_workouts_ahead: list.length,
        workouts: list.map((event) => compactEvent(event)),
        push_problems: problems,
        advice: uploadEnabled
          ? "Upload is enabled. intervals.icu pushes the next few days of planned workouts; a workout " +
            "further out only appears on the watch as its date approaches."
          : "'Upload planned workouts' is OFF — enable it on intervals.icu → Settings, in the Garmin box, " +
            "and authorise Garmin Connect. Until then nothing is pushed to the watch.",
      });
    },
  );
}

function buildEventBody(input: Partial<WorkoutInput>, options: { partial?: boolean } = {}): Json {
  const body: Json = {};
  if (!options.partial) body["category"] = input.category ?? "WORKOUT";
  else if (input.category) body["category"] = input.category;

  if (input.date) body["start_date_local"] = toLocalDateTime(input.date);
  if (input.type) body["type"] = input.type;
  if (input.name) body["name"] = input.name;
  if (input.description !== undefined) body["description"] = input.description;
  if (input.indoor !== undefined) body["indoor"] = input.indoor;
  if (input.target) body["target"] = input.target;
  if (input.moving_time_seconds !== undefined) body["moving_time"] = input.moving_time_seconds;
  if (input.distance_meters !== undefined) body["distance"] = input.distance_meters;
  if (input.load !== undefined) body["icu_training_load"] = input.load;
  if (input.sub_type) body["sub_type"] = input.sub_type;
  if (input.tags?.length) body["tags"] = input.tags;
  if (input.color) body["color"] = input.color;
  if (input.external_id) body["external_id"] = input.external_id;
  return body;
}

/**
 * A target kind whose threshold is missing for the sport is silently stripped from the file
 * intervals.icu pushes to the device — the steps land on the watch as "No Target". Verified
 * by decoding the generated FIT: with no Run threshold pace, every step came out `target=open`.
 */
async function missingThresholds(
  client: IntervalsClient,
  type: string,
  doc: Json,
  indoor: boolean,
): Promise<Array<{ kind: TargetKind; threshold: string }>> {
  const kinds = targetKindsUsed(doc);
  if (kinds.length === 0) return [];
  let settings: Json | undefined;
  try {
    const all = await client.request<Json[]>(await client.athletePath("/sport-settings"));
    settings = (Array.isArray(all) ? all : []).find((entry) => {
      const types = entry["types"];
      return Array.isArray(types) && types.some((t) => String(t).toLowerCase() === type.toLowerCase());
    });
  } catch {
    return []; // the pre-flight is advisory; never fail a successful create over it
  }
  if (!settings) return [];

  const isSet = (value: unknown): boolean => typeof value === "number" && value > 0;
  const missing: Array<{ kind: TargetKind; threshold: string }> = [];
  for (const kind of kinds) {
    if (kind === "pace" && !isSet(settings["threshold_pace"])) {
      missing.push({ kind, threshold: "threshold pace" });
    }
    if (kind === "power" && !isSet(indoor ? settings["indoor_ftp"] ?? settings["ftp"] : settings["ftp"])) {
      missing.push({ kind, threshold: indoor ? "indoor FTP" : "FTP" });
    }
    if (kind === "hr" && !isSet(settings["lthr"]) && !isSet(settings["max_hr"])) {
      missing.push({ kind, threshold: "LTHR / max HR" });
    }
  }
  return missing;
}

/** Re-read a created event with %-targets resolved to watts / bpm / m·s⁻¹. */
async function fetchResolved(
  client: IntervalsClient,
  startDateLocal: string,
  eventId: unknown,
): Promise<Json | undefined> {
  if (eventId === undefined || eventId === null) return undefined;
  const date = datePart(startDateLocal);
  try {
    const events = await client.request<unknown[]>(await client.athletePath("/events"), {
      query: { oldest: date, newest: date, resolve: true },
    });
    if (!Array.isArray(events)) return undefined;
    return events
      .map((event) => event as Json)
      .find((event) => String(event["id"]) === String(eventId));
  } catch {
    return undefined; // verification is best-effort; the workout was already created
  }
}
