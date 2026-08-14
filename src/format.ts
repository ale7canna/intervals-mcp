/** Payload shaping: intervals.icu objects have 150+ fields, most of them noise for an LLM. */

export type Json = Record<string, unknown>;

/** Fields requested for activity lists (the API's `fields` param also drops nulls). */
export const ACTIVITY_SUMMARY_FIELDS = [
  "id",
  "start_date_local",
  "type",
  "sub_type",
  "name",
  "moving_time",
  "elapsed_time",
  "distance",
  "total_elevation_gain",
  "icu_training_load",
  "icu_intensity",
  "average_speed",
  "pace",
  "gap",
  "average_heartrate",
  "max_heartrate",
  "icu_average_watts",
  "icu_weighted_avg_watts",
  "average_cadence",
  "trainer",
  "race",
  "feel",
  "icu_rpe",
  "paired_event_id",
  "compliance",
] as const;

/** Extra fields worth pulling for a single activity. */
export const ACTIVITY_DETAIL_FIELDS = [
  ...ACTIVITY_SUMMARY_FIELDS,
  "description",
  "device_name",
  "source",
  "calories",
  "icu_ftp",
  "lthr",
  "threshold_pace",
  "icu_resting_hr",
  "icu_weight",
  "icu_atl",
  "icu_ctl",
  "icu_zone_times",
  "icu_hr_zone_times",
  "pace_zone_times",
  "polarization_index",
  "decoupling",
  "icu_efficiency_factor",
  "icu_power_hr",
  "icu_hrr",
  "trimp",
  "power_load",
  "hr_load",
  "pace_load",
  "average_stride",
  "average_vertical_oscillation",
  "average_stance_time",
  "icu_achievements",
  "interval_summary",
  "icu_lap_count",
  "strain_score",
  "average_temp",
  "average_weather_temp",
] as const;

const WELLNESS_FIELDS = [
  "id",
  "ctl",
  "atl",
  "rampRate",
  "weight",
  "restingHR",
  "hrv",
  "hrvSDNN",
  "sleepSecs",
  "sleepScore",
  "sleepQuality",
  "avgSleepingHR",
  "readiness",
  "soreness",
  "fatigue",
  "stress",
  "mood",
  "motivation",
  "injury",
  "steps",
  "vo2max",
  "spO2",
  "bodyFat",
  "comments",
] as const;

const EVENT_FIELDS = [
  "id",
  "start_date_local",
  "category",
  "type",
  "sub_type",
  "name",
  "indoor",
  "moving_time",
  "distance",
  "icu_training_load",
  "icu_intensity",
  "target",
  "description",
  "external_id",
  "tags",
  "push_errors",
  "not_on_fitness_chart",
  "show_as_note",
] as const;

const INTERVAL_FIELDS = [
  "id",
  "label",
  "type",
  "group_id",
  "start_time",
  "end_time",
  "moving_time",
  "elapsed_time",
  "distance",
  "average_watts",
  "min_watts",
  "max_watts",
  "weighted_average_watts",
  "intensity",
  "average_heartrate",
  "max_heartrate",
  "average_speed",
  "gap",
  "average_cadence",
  "average_stride",
  "total_elevation_gain",
  "average_gradient",
  "training_load",
  "decoupling",
  "zone",
  "wbal_start",
  "wbal_end",
] as const;

export function pick(source: unknown, fields: readonly string[]): Json {
  const out: Json = {};
  if (!source || typeof source !== "object") return out;
  const record = source as Json;
  for (const field of fields) {
    const value = record[field];
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) {
      out[field] = value;
    }
  }
  return out;
}

export function compactActivity(activity: unknown, detail = false): Json {
  const base = pick(activity, detail ? ACTIVITY_DETAIL_FIELDS : ACTIVITY_SUMMARY_FIELDS);
  if (typeof base["moving_time"] === "number") base["duration"] = formatDuration(base["moving_time"]);
  if (typeof base["distance"] === "number") base["distance_km"] = round(base["distance"] / 1000, 2);
  if (typeof base["average_speed"] === "number") base["avg_pace"] = formatPace(base["average_speed"]);
  if (typeof base["gap"] === "number") base["gap_pace"] = formatPace(base["gap"]);
  return base;
}

export function compactWellness(record: unknown): Json {
  const base = pick(record, WELLNESS_FIELDS);
  const { ctl, atl } = base as { ctl?: number; atl?: number };
  if (typeof ctl === "number") base["fitness_ctl"] = round(ctl, 1);
  if (typeof atl === "number") base["fatigue_atl"] = round(atl, 1);
  if (typeof ctl === "number" && typeof atl === "number") base["form_tsb"] = round(ctl - atl, 1);
  if (typeof base["sleepSecs"] === "number") base["sleep"] = formatDuration(base["sleepSecs"]);
  return base;
}

export function compactEvent(event: unknown, options: { includeWorkoutDoc?: boolean } = {}): Json {
  const base = pick(event, EVENT_FIELDS);
  if (typeof base["moving_time"] === "number") base["duration"] = formatDuration(base["moving_time"]);
  const doc = (event as Json | undefined)?.["workout_doc"];
  if (doc && typeof doc === "object") {
    base["workout_steps"] = describeWorkoutDoc(doc as Json);
    if (options.includeWorkoutDoc) base["workout_doc"] = truncateJson(doc, 6000);
  }
  return base;
}

export function compactInterval(interval: unknown): Json {
  const base = pick(interval, INTERVAL_FIELDS);
  if (typeof base["moving_time"] === "number") base["duration"] = formatDuration(base["moving_time"]);
  if (typeof base["average_speed"] === "number") base["avg_pace"] = formatPace(base["average_speed"]);
  if (typeof base["gap"] === "number") base["gap_pace"] = formatPace(base["gap"]);
  return base;
}

/**
 * Render the parsed workout structure as readable lines. `workout_doc` has no published
 * schema, so recognise the common shape and stay quiet about anything unexpected.
 */
export function describeWorkoutDoc(doc: Json): string[] {
  const steps = doc["steps"];
  if (!Array.isArray(steps)) return [];
  const lines: string[] = [];
  const walk = (list: unknown[], indent: string): void => {
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const step = raw as Json;
      const nested = step["steps"];
      if (Array.isArray(nested)) {
        const reps = typeof step["reps"] === "number" ? step["reps"] : 1;
        // Section names often already carry the repeat count ("Main set 3x") — don't say it twice.
        const text = (typeof step["text"] === "string" ? step["text"] : "").trim().replace(/\s*\d+\s*x$/i, "");
        lines.push(`${indent}${text ? `${text} ` : ""}${reps}x`);
        walk(nested, `${indent}  `);
        continue;
      }
      lines.push(indent + describeStep(step));
    }
  };
  walk(steps, "");
  return lines;
}

export type TargetKind = "power" | "hr" | "pace";

/** Which kinds of target the parsed workout actually uses. */
export function targetKindsUsed(doc: Json): TargetKind[] {
  const found = new Set<TargetKind>();
  const walk = (list: unknown[]): void => {
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const step = raw as Json;
      const nested = step["steps"];
      if (Array.isArray(nested)) {
        walk(nested);
        continue;
      }
      for (const kind of ["power", "hr", "pace"] as const) {
        if (step[kind] && typeof step[kind] === "object") found.add(kind);
      }
    }
  };
  const steps = doc["steps"];
  if (Array.isArray(steps)) walk(steps);
  return [...found];
}

/**
 * After a `resolve=true` read, targets should be in watts / bpm / m·s⁻¹. Units still
 * expressed in % mean intervals.icu had no threshold to resolve against for that sport.
 */
export function unresolvedTargetSports(doc: Json): string[] {
  const found = new Set<string>();
  const walk = (list: unknown[]): void => {
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const step = raw as Json;
      const nested = step["steps"];
      if (Array.isArray(nested)) {
        walk(nested);
        continue;
      }
      for (const key of ["power", "hr", "pace"] as const) {
        const target = step[key];
        if (target && typeof target === "object") {
          const units = (target as { units?: unknown }).units;
          if (typeof units === "string" && units.includes("%")) found.add(key);
        }
      }
    }
  };
  const steps = doc["steps"];
  if (Array.isArray(steps)) walk(steps);
  return [...found];
}

function describeStep(step: Json): string {
  const parts: string[] = [];
  if (typeof step["duration"] === "number") parts.push(formatDuration(step["duration"]));
  else if (typeof step["distance"] === "number") parts.push(`${round(step["distance"], 0)}m`);
  if (step["ramp"]) parts.push("ramp");
  if (step["freeride"]) parts.push("freeride");
  for (const key of ["power", "hr", "pace"] as const) {
    const target = step[key];
    if (target && typeof target === "object") {
      const t = target as { value?: number; start?: number; end?: number; units?: string };
      const units = t.units ? ` ${t.units}` : "";
      if (typeof t.start === "number" && typeof t.end === "number" && t.start !== t.end) {
        parts.push(`${key} ${round(t.start, 1)}-${round(t.end, 1)}${units}`);
      } else if (typeof t.value === "number") {
        parts.push(`${key} ${round(t.value, 1)}${units}`);
      } else if (typeof t.start === "number") {
        parts.push(`${key} ${round(t.start, 1)}${units}`);
      }
    }
  }
  const cadence = step["cadence"];
  if (cadence && typeof cadence === "object") {
    const c = cadence as { value?: number; start?: number; end?: number };
    if (typeof c.value === "number") parts.push(`${c.value}rpm`);
    else if (typeof c.start === "number") parts.push(`${c.start}rpm`);
  }
  if (typeof step["text"] === "string" && step["text"]) parts.push(`"${step["text"]}"`);
  if (step["warmup"]) parts.push("(warmup)");
  if (step["cooldown"]) parts.push("(cooldown)");
  return parts.length > 0 ? `- ${parts.join(" ")}` : "- (step)";
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return s > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${m}m`;
  return `${s}s`;
}

/** metres/second -> mm:ss per km (and per mile). */
export function formatPace(metersPerSecond: number): string {
  if (!metersPerSecond || metersPerSecond <= 0) return "n/a";
  const perKm = 1000 / metersPerSecond;
  const perMile = 1609.34 / metersPerSecond;
  return `${clock(perKm)}/km (${clock(perMile)}/mi)`;
}

function clock(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function truncateJson(value: unknown, maxChars: number): unknown {
  const text = JSON.stringify(value);
  if (!text || text.length <= maxChars) return value;
  return `${text.slice(0, maxChars)}… [truncated, ${text.length} chars total]`;
}

/** Every tool returns text; JSON keeps it unambiguous for the model. */
export function jsonText(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
