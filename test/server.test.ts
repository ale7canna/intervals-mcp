import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import type { IntervalsClient } from "../src/client.js";
import { buildServer } from "../src/server.js";

test("buildServer registers every tool exactly once", () => {
  // McpServer.registerTool throws on a duplicate name. A duplicated registration block once
  // reached a deployment because tsc accepts it happily and no test instantiated the server —
  // this is the cheapest possible guard against that recurring.
  assert.doesNotThrow(() => buildServer({} as IntervalsClient));
});

test("no tool name is declared twice across the tool modules", () => {
  const dir = new URL("../src/tools/", import.meta.url);
  const names: string[] = [];
  for (const file of readdirSync(dir)) {
    const src = readFileSync(new URL(file, dir), "utf8");
    for (const m of src.matchAll(/registerTool\(\s*"([^"]+)"/g)) names.push(m[1]!);
  }
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(dupes, [], `duplicated tool names: ${dupes.join(", ")}`);
  assert.ok(names.includes("get_activity_samples"), "the samples tool should be registered");
});
