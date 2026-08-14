import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IntervalsClient } from "../client.js";
import { formatPace, jsonText, pick, round, type Json } from "../format.js";

const ATHLETE_FIELDS = [
  "id",
  "name",
  "sex",
  "timezone",
  "locale",
  "city",
  "country",
  "weight",
  "height",
  "measurement_preference",
  "icu_resting_hr",
  "icu_date_of_birth",
  "plan",
] as const;

const GARMIN_FIELDS = [
  "icu_garmin_upload_workouts",
  "icu_garmin_last_upload",
  "icu_garmin_sync_activities",
  "icu_garmin_health",
  "icu_garmin_training",
  "icu_garmin_outdoor_power_range",
  "icu_garmin_hr_range",
  "garmin_pace_range",
  "garmin_power_target",
  "icu_garmin_upload_filters",
  "garmin_sync_activity_types",
  "open_step_duration",
] as const;

const SPORT_SETTINGS_FIELDS = [
  "id",
  "types",
  "ftp",
  "indoor_ftp",
  "w_prime",
  "p_max",
  "power_zones",
  "power_zone_names",
  "sweet_spot_min",
  "sweet_spot_max",
  "lthr",
  "max_hr",
  "hr_zones",
  "hr_zone_names",
  "hr_load_type",
  "threshold_pace",
  "pace_units",
  "pace_zones",
  "pace_zone_names",
  "pace_load_type",
  "warmup_time",
  "cooldown_time",
  "default_workout_time",
  "best_effort_distances",
] as const;

interface AthleteResponse extends Json {
  sportSettings?: unknown[];
}

export function registerAthleteTools(server: McpServer, client: IntervalsClient): void {
  server.registerTool(
    "get_athlete",
    {
      title: "Get athlete profile, thresholds and device sync settings",
      description:
        "Athlete profile plus the per-sport training settings that workout targets resolve against: " +
        "FTP / indoor FTP, LTHR, max HR, threshold pace, and the power/HR/pace zones. " +
        "Also reports the Garmin push configuration (whether planned workouts are uploaded, when the " +
        "last upload happened, and the target ranges applied on push). " +
        "Call this before writing a workout in % targets, to confirm the thresholds are set for that sport.",
      inputSchema: {
        sport: z
          .string()
          .optional()
          .describe('Only return settings whose types include this activity type, e.g. "Run", "Ride", "Swim".'),
      },
    },
    async ({ sport }) => {
      const athlete = await client.request<AthleteResponse>(`/athlete/${await client.athleteId()}`);
      const allSettings = Array.isArray(athlete.sportSettings) ? athlete.sportSettings : [];
      const settings = sport
        ? allSettings.filter((entry) => {
            const types = (entry as Json | undefined)?.["types"];
            return Array.isArray(types) && types.some((t) => String(t).toLowerCase() === sport.toLowerCase());
          })
        : allSettings;

      return jsonText({
        athlete: pick(athlete, ATHLETE_FIELDS),
        garmin: pick(athlete, GARMIN_FIELDS),
        sport_settings: settings.map(summarizeSportSettings),
        note:
          settings.length === 0 && sport
            ? `No sport settings found for "${sport}". intervals.icu falls back to the default settings group for unlisted types.`
            : undefined,
      });
    },
  );
}

function summarizeSportSettings(entry: unknown): Json {
  const summary = pick(entry, SPORT_SETTINGS_FIELDS);
  const thresholdPace = summary["threshold_pace"];
  if (typeof thresholdPace === "number" && thresholdPace > 0) {
    summary["threshold_pace_readable"] = formatPace(thresholdPace);
    summary["threshold_pace_units"] = "m/s";
  }
  const paceZones = summary["pace_zones"];
  if (Array.isArray(paceZones) && typeof thresholdPace === "number" && thresholdPace > 0) {
    summary["pace_zone_boundaries_readable"] = paceZones.map((zone) =>
      typeof zone === "number" ? formatPace((thresholdPace * zone) / 100) : String(zone),
    );
  }
  const ftp = summary["ftp"];
  const powerZones = summary["power_zones"];
  if (Array.isArray(powerZones) && typeof ftp === "number" && ftp > 0) {
    summary["power_zone_boundaries_watts"] = powerZones.map((zone) =>
      typeof zone === "number" ? round((ftp * zone) / 100, 0) : zone,
    );
  }
  return summary;
}
