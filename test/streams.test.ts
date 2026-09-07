import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_STREAM_SAMPLES,
  SELECTABLE_STREAM_TYPES,
  SKIPPED_STREAM_TYPES,
  STREAM_TYPES,
  cadenceToSpm,
  compactStreams,
  sampleIndexForSecond,
} from "../src/format.js";

/** Shaped like the real response: 15 streams, one value per second, nulls interleaved. */
function fixture(n = 20) {
  const seq = (f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i));
  const stream = (type: string, data: unknown[]) => ({
    type,
    name: type,
    data,
    valueTypeIsArray: false,
    allNull: false,
  });
  return [
    stream("time", seq((i) => i)),
    stream("watts", seq((i) => (i < 2 ? 0 : 150 + i))),
    stream("cadence", seq((i) => (i < 2 ? 0 : 85))),
    stream("heartrate", seq((i) => 120 + i)),
    stream("distance", seq((i) => Number((i * 3.02).toFixed(2)))),
    stream("altitude", seq(() => 208.0)),
    stream("latlng", seq(() => 45.831936)),
    stream("velocity_smooth", seq(() => 3.421)),
    stream("temp", seq(() => 31)),
    stream("torque", seq(() => 19)),
    stream("fixed_altitude", seq(() => 204.0)),
    stream("stance_time", seq((i) => (i === 2 ? null : 318.0))),
    stream("vertical_oscillation", seq((i) => (i === 2 ? null : 74.4))),
    stream("vertical_ratio", seq((i) => (i === 2 ? null : 11.76))),
    stream("step_length", seq((i) => (i === 2 ? null : 632.0))),
  ];
}

test("returns only the allowlisted streams, dropping the 8 skipped", () => {
  const out = compactStreams(fixture(), 0, 20);
  assert.deepEqual(Object.keys(out).sort(), [...STREAM_TYPES].sort());
  for (const skipped of Object.keys(SKIPPED_STREAM_TYPES)) {
    assert.ok(!(skipped in out), `${skipped} must not be returned`);
  }
});

test("every skipped stream is documented with a reason", () => {
  const all = fixture().map((s) => s.type);
  const covered = new Set([...STREAM_TYPES, ...Object.keys(SKIPPED_STREAM_TYPES)]);
  for (const type of all) assert.ok(covered.has(type), `${type} is neither allowed nor documented`);
  for (const reason of Object.values(SKIPPED_STREAM_TYPES)) assert.ok(reason.length > 20);
});

test("slices to the requested window, end exclusive", () => {
  const out = compactStreams(fixture(), 5, 10);
  assert.deepEqual(out["time"], [5, 6, 7, 8, 9]);
  assert.deepEqual(out["heartrate"], [125, 126, 127, 128, 129]);
});

test("honours an explicit subset of types", () => {
  const out = compactStreams(fixture(), 0, 3, ["heartrate", "watts"]);
  assert.deepEqual(Object.keys(out).sort(), ["heartrate", "watts"]);
});

test("keeps nulls and zeros distinct rather than compacting them away", () => {
  const out = compactStreams(fixture(), 0, 4, ["watts"]);
  assert.deepEqual(out["watts"], [0, 0, 152, 153]);
});

test("ignores malformed entries instead of throwing", () => {
  const out = compactStreams([null, 7, { type: "heartrate" }, { data: [1] }], 0, 5);
  assert.deepEqual(out, {});
});

test("cadence is doubled from the API's per-leg value, preserving nulls", () => {
  assert.deepEqual(cadenceToSpm([85, null, 0, 92]), [170, null, 0, 184]);
});

test("the sample cap is small enough to be safe at 1Hz", () => {
  assert.ok(MAX_STREAM_SAMPLES <= 1800, "a cap over 30 min at 1Hz defeats the purpose");
});

test("resolves seconds to sample indices on a contiguous 1Hz recording", () => {
  const time = Array.from({ length: 20 }, (_, i) => i);
  assert.equal(sampleIndexForSecond(time, 5, "start"), 5);
  // called as (end - 1, "end") by the tool, so a [5, 10) request resolves to index 10
  assert.equal(sampleIndexForSecond(time, 9, "end"), 10);
});

test("resolves seconds correctly across a recording gap, where index != second", () => {
  const time = [0, 1, 2, 600, 601, 602]; // a 10-minute pause, 6 samples
  assert.equal(sampleIndexForSecond(time, 600, "start"), 3);
  assert.equal(sampleIndexForSecond(time, 601, "end"), 5);
  // the naive assumption (index == second) would have run off the end of a 6-sample array
  assert.ok(sampleIndexForSecond(time, 600, "start") < time.length);
});

test("clamps to the end of the stream when the window runs past it", () => {
  const time = [0, 1, 2, 3, 4];
  assert.equal(sampleIndexForSecond(time, 99, "start"), 5);
  assert.equal(sampleIndexForSecond(time, 99, "end"), 5);
});

test("falls back to a 1Hz assumption when there is no time stream", () => {
  assert.equal(sampleIndexForSecond(undefined, 42, "start"), 42);
  assert.equal(sampleIndexForSecond([], 41, "end"), 42);
});

test("skips non-numeric entries when resolving a second", () => {
  assert.equal(sampleIndexForSecond([null, null, 2, 3], 2, "start"), 2);
});

test("time is always returned but never selectable", () => {
  assert.ok(STREAM_TYPES.includes("time"), "time is fetched and returned");
  assert.ok(
    !(SELECTABLE_STREAM_TYPES as readonly string[]).includes("time"),
    "time must not be offered as a choice — it is mandatory",
  );
  assert.equal(SELECTABLE_STREAM_TYPES.length, STREAM_TYPES.length - 1);
});
