import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { authorizeRequest } from "../src/auth.js";

const TOKEN = "T".repeat(43);
const OTHER = "X".repeat(43);
const SIMONE_TOKEN = "S".repeat(43);

afterEach(() => {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("MCP_USER_")) delete process.env[name];
  }
  delete process.env["MCP_AUTH_TOKEN"];
  delete process.env["INTERVALS_API_KEY"];
  delete process.env["INTERVALS_ATHLETE_ID"];
});

/** The single-user setup: MCP_AUTH_TOKEN + INTERVALS_API_KEY. */
function configure(token: string | undefined): void {
  if (token === undefined) delete process.env["MCP_AUTH_TOKEN"];
  else process.env["MCP_AUTH_TOKEN"] = token;
  process.env["INTERVALS_API_KEY"] = "default-key";
}

function configureUser(name: string, token: string, key: string, athleteId?: string): void {
  process.env[`MCP_USER_${name}_TOKEN`] = token;
  process.env[`MCP_USER_${name}_INTERVALS_KEY`] = key;
  if (athleteId) process.env[`MCP_USER_${name}_ATHLETE_ID`] = athleteId;
}

const DEFAULT_USER = { name: "default", intervalsKey: "default-key", athleteId: undefined };

function expectConfigError(request = { headers: { authorization: `Bearer ${TOKEN}` }, url: "/mcp" }) {
  const outcome = authorizeRequest(request);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.status, 500);
}

test("refuses to serve when no token is configured", () => {
  configure(undefined);
  expectConfigError();
});

test("refuses a configured token that is too short to be a secret", () => {
  configure("short");
  expectConfigError({ headers: { authorization: "Bearer short" }, url: "/mcp" });
});

test("accepts the token as a bearer header", () => {
  configure(TOKEN);
  const outcome = authorizeRequest({ headers: { authorization: `Bearer ${TOKEN}` }, url: "/mcp" });
  assert.deepEqual(outcome, { ok: true, via: "header", user: DEFAULT_USER });
});

test("accepts the token in x-api-key", () => {
  configure(TOKEN);
  const outcome = authorizeRequest({ headers: { "x-api-key": TOKEN }, url: "/mcp" });
  assert.deepEqual(outcome, { ok: true, via: "header", user: DEFAULT_USER });
});

test("accepts the token in the path", () => {
  configure(TOKEN);
  const outcome = authorizeRequest({ headers: {}, url: `/mcp/${TOKEN}` });
  assert.deepEqual(outcome, { ok: true, via: "path", user: DEFAULT_USER });
});

test("accepts the token from the rewrite query param", () => {
  configure(TOKEN);
  const outcome = authorizeRequest({ headers: {}, url: `/api/mcp?token=${TOKEN}` });
  assert.deepEqual(outcome, { ok: true, via: "path", user: DEFAULT_USER });
});

test("rejects a wrong token, whichever way it arrives", () => {
  configure(TOKEN);
  for (const request of [
    { headers: { authorization: `Bearer ${OTHER}` }, url: "/mcp" },
    { headers: { "x-auth-token": OTHER }, url: "/mcp" },
    { headers: {}, url: `/mcp/${OTHER}` },
  ]) {
    const outcome = authorizeRequest(request);
    assert.equal(outcome.ok, false, `should reject ${request.url}`);
    assert.equal(outcome.ok === false && outcome.status, 401);
  }
});

test("rejects a request with no token at all", () => {
  configure(TOKEN);
  const outcome = authorizeRequest({ headers: {}, url: "/mcp" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.status, 401);
});

test("does not mistake the route itself for a token", () => {
  configure(TOKEN);
  for (const url of ["/mcp", "/api/mcp", "/mcp/"]) {
    const outcome = authorizeRequest({ headers: {}, url });
    assert.equal(outcome.ok, false, `${url} must not authenticate`);
  }
});

test("each user's token selects that user's intervals key", () => {
  configure(TOKEN);
  configureUser("SIMONE", SIMONE_TOKEN, "simone-key", "i42");

  const mine = authorizeRequest({ headers: { authorization: `Bearer ${TOKEN}` }, url: "/mcp" });
  assert.deepEqual(mine, { ok: true, via: "header", user: DEFAULT_USER });

  const his = authorizeRequest({ headers: {}, url: `/mcp/${SIMONE_TOKEN}` });
  assert.deepEqual(his, {
    ok: true,
    via: "path",
    user: { name: "SIMONE", intervalsKey: "simone-key", athleteId: "i42" },
  });
});

test("serves per-user tokens without the single-user pair", () => {
  configureUser("ALE", TOKEN, "ale-key");
  configureUser("SIMONE", SIMONE_TOKEN, "simone-key");
  const outcome = authorizeRequest({ headers: { "x-api-key": SIMONE_TOKEN }, url: "/mcp" });
  assert.deepEqual(outcome, {
    ok: true,
    via: "header",
    user: { name: "SIMONE", intervalsKey: "simone-key", athleteId: undefined },
  });
});

test("rejects a token that belongs to nobody when several users exist", () => {
  configureUser("ALE", TOKEN, "ale-key");
  configureUser("SIMONE", SIMONE_TOKEN, "simone-key");
  const outcome = authorizeRequest({ headers: {}, url: `/mcp/${OTHER}` });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.status, 401);
});

test("refuses to serve when two users share a token", () => {
  configure(TOKEN);
  configureUser("SIMONE", TOKEN, "simone-key");
  expectConfigError();
});

test("refuses to serve when a user's token or key is missing", () => {
  configure(TOKEN);
  process.env["MCP_USER_SIMONE_TOKEN"] = SIMONE_TOKEN;
  expectConfigError();

  delete process.env["MCP_USER_SIMONE_TOKEN"];
  process.env["MCP_USER_SIMONE_INTERVALS_KEY"] = "simone-key";
  expectConfigError();
});

test("refuses to serve when the single-user token has no intervals key", () => {
  process.env["MCP_AUTH_TOKEN"] = TOKEN;
  expectConfigError();
});

test("refuses a per-user token that is too short to be a secret", () => {
  configure(TOKEN);
  configureUser("SIMONE", "short", "simone-key");
  expectConfigError();
});
