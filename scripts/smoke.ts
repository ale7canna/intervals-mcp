/**
 * End-to-end check against the real intervals.icu API.
 *
 *   npm run smoke            read-only: auth, athlete, thresholds, activities, wellness, calendar
 *   npm run smoke -- --write also creates a test workout tomorrow, verifies it, then deletes it
 */
import { fileURLToPath } from "node:url";
import { IntervalsClient } from "../src/client.js";
import { daysFromToday, today } from "../src/dates.js";
import { compactActivity, compactEvent, compactWellness, describeWorkoutDoc, type Json } from "../src/format.js";

try {
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  /* rely on the ambient environment */
}

const apiKey = process.env["INTERVALS_API_KEY"];
if (!apiKey) {
  console.error("Set INTERVALS_API_KEY in .env first (intervals.icu → Settings → Developer Settings).");
  process.exit(1);
}

const write = process.argv.includes("--write");
const client = new IntervalsClient({ apiKey, athleteId: process.env["INTERVALS_ATHLETE_ID"] });

function section(title: string): void {
  console.log(`\n=== ${title}`);
}

const athleteId = await client.athleteId();
section("athlete id");
console.log(athleteId, process.env["INTERVALS_ATHLETE_ID"] ? "(from env)" : "(auto-detected)");

section("athlete + thresholds");
const athlete = await client.request<Json & { sportSettings?: unknown[] }>(`/athlete/${athleteId}`);
console.log({
  name: athlete["name"],
  timezone: athlete["timezone"],
  garmin_upload_planned_workouts: athlete["icu_garmin_upload_workouts"],
  garmin_last_upload: athlete["icu_garmin_last_upload"],
  garmin_pace_range: athlete["garmin_pace_range"],
});
for (const settings of athlete.sportSettings ?? []) {
  const s = settings as Json;
  console.log({
    types: s["types"],
    ftp: s["ftp"],
    lthr: s["lthr"],
    max_hr: s["max_hr"],
    threshold_pace_mps: s["threshold_pace"],
    pace_units: s["pace_units"],
  });
}

section("recent activities");
const activities = await client.request<unknown[]>(`/athlete/${athleteId}/activities`, {
  query: { oldest: daysFromToday(-21), newest: today(), limit: 5 },
});
for (const activity of activities ?? []) console.log(compactActivity(activity));

const firstId = (activities?.[0] as Json | undefined)?.["id"];
if (typeof firstId === "string") {
  section(`intervals of ${firstId}`);
  const dto = await client.request<Json>(`/activity/${firstId}/intervals`);
  const list = Array.isArray(dto["icu_intervals"]) ? dto["icu_intervals"] : [];
  console.log(`${list.length} intervals`);
}

section("wellness (last 5 days)");
const wellness = await client.request<unknown[]>(`/athlete/${athleteId}/wellness`, {
  query: { oldest: daysFromToday(-5), newest: today() },
});
for (const record of wellness ?? []) {
  const w = compactWellness(record);
  console.log({ date: w["id"], ctl: w["fitness_ctl"], atl: w["fatigue_atl"], form: w["form_tsb"] });
}

section("calendar (next 14 days)");
const events = await client.request<unknown[]>(`/athlete/${athleteId}/events`, {
  query: { oldest: today(), newest: daysFromToday(14), resolve: true },
});
for (const event of events ?? []) {
  const e = compactEvent(event);
  console.log({ id: e["id"], date: e["start_date_local"], type: e["type"], name: e["name"], steps: e["workout_steps"] });
}

if (write) {
  section("create → verify → delete a test workout");
  const date = daysFromToday(1);
  const created = await client.request<Json>(`/athlete/${athleteId}/events`, {
    method: "POST",
    body: {
      category: "WORKOUT",
      start_date_local: `${date}T00:00:00`,
      type: "Run",
      name: "intervals-mcp smoke test",
      description: [
        "Warmup",
        "- 10m 70% Pace",
        "",
        "Main set 3x",
        "- 1km 100% Pace",
        "- 90s 60% Pace",
        "",
        "Cooldown",
        "- 5m 65% Pace",
      ].join("\n"),
    },
  });
  console.log("created:", { id: created["id"], name: created["name"], moving_time: created["moving_time"] });

  const resolved = await client.request<unknown[]>(`/athlete/${athleteId}/events`, {
    query: { oldest: date, newest: date, resolve: true },
  });
  const match = (resolved ?? [])
    .map((event) => event as Json)
    .find((event) => String(event["id"]) === String(created["id"]));
  console.log("resolved steps:", describeWorkoutDoc((match?.["workout_doc"] ?? {}) as Json));
  console.log("push_errors:", match?.["push_errors"] ?? "none");

  await client.request(`/athlete/${athleteId}/events/${created["id"]}`, { method: "DELETE" });
  console.log("deleted test workout", created["id"]);
}

console.log("\nsmoke test finished");
