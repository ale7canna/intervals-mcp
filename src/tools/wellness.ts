import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IntervalsClient } from "../client.js";
import { daysFromToday, today } from "../dates.js";
import { compactWellness, jsonText, round, type Json } from "../format.js";

export function registerWellnessTools(server: McpServer, client: IntervalsClient): void {
  server.registerTool(
    "get_wellness",
    {
      title: "Get wellness and fitness history",
      description:
        "Daily wellness records: Fitness (CTL), Fatigue (ATL), Form (TSB = CTL − ATL), ramp rate, " +
        "plus whatever the athlete tracks — weight, resting HR, HRV, sleep, readiness, soreness, " +
        "fatigue, stress, mood, steps, VO2max. Defaults to the last 14 days. " +
        "Use it to judge current form before planning workouts.",
      inputSchema: {
        oldest: z.string().optional().describe("Oldest local date, YYYY-MM-DD (default: 14 days ago)."),
        newest: z.string().optional().describe("Newest local date, inclusive, YYYY-MM-DD (default: today)."),
      },
    },
    async ({ oldest, newest }) => {
      const from = oldest ?? daysFromToday(-14);
      const to = newest ?? today();
      const records = await client.request<unknown[]>(await client.athletePath("/wellness"), {
        query: { oldest: from, newest: to },
      });
      const list = (Array.isArray(records) ? records : []).map(compactWellness);
      return jsonText({
        range: { oldest: from, newest: to },
        count: list.length,
        latest: summarizeForm(list.at(-1)),
        records: list,
      });
    },
  );

  server.registerTool(
    "set_wellness",
    {
      title: "Update a wellness record",
      description:
        "Set wellness values for one date (weight, resting HR, HRV, sleep, soreness, fatigue, " +
        "stress, mood, motivation, comments…). Only the fields you pass are changed.",
      inputSchema: {
        date: z.string().describe("Local date, YYYY-MM-DD."),
        weight: z.number().optional().describe("Weight in kg."),
        restingHR: z.number().int().optional().describe("Resting heart rate, bpm."),
        hrv: z.number().optional().describe("HRV (rMSSD)."),
        sleepSecs: z.number().int().optional().describe("Sleep duration in seconds."),
        sleepScore: z.number().optional().describe("Sleep score."),
        soreness: z.number().int().min(1).max(4).optional().describe("1 = none … 4 = severe."),
        fatigue: z.number().int().min(1).max(4).optional().describe("1 = fresh … 4 = very tired."),
        stress: z.number().int().min(1).max(4).optional().describe("1 = relaxed … 4 = very stressed."),
        mood: z.number().int().min(1).max(4).optional().describe("1 = great … 4 = awful."),
        motivation: z.number().int().min(1).max(4).optional().describe("1 = high … 4 = low."),
        comments: z.string().optional().describe("Free-text note for the day."),
      },
    },
    async ({ date, ...values }) => {
      const body: Json = { id: date };
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined) body[key] = value;
      }
      const updated = await client.request<Json>(
        `${await client.athletePath("/wellness")}/${encodeURIComponent(date)}`,
        { method: "PUT", body },
      );
      return jsonText({ updated: compactWellness(updated) });
    },
  );
}

function summarizeForm(record: Json | undefined): Json | undefined {
  if (!record) return undefined;
  const ctl = record["fitness_ctl"];
  const atl = record["fatigue_atl"];
  return {
    date: record["id"],
    fitness_ctl: ctl,
    fatigue_atl: atl,
    form_tsb: record["form_tsb"],
    ramp_rate: typeof record["rampRate"] === "number" ? round(record["rampRate"], 1) : undefined,
  };
}
