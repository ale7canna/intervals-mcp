import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { authorizeRequest } from "../src/auth.js";

const TOKEN = "T".repeat(43);
const OTHER = "X".repeat(43);

afterEach(() => {
  delete process.env["MCP_AUTH_TOKEN"];
});

function configure(token: string | undefined): void {
  if (token === undefined) delete process.env["MCP_AUTH_TOKEN"];
  else process.env["MCP_AUTH_TOKEN"] = token;
}

test("refuses to serve when no token is configured", () => {
  configure(undefined);
  const outcome = authorizeRequest({ headers: { authorization: `Bearer ${TOKEN}` }, url: "/mcp" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.status, 500);
});

test("refuses a configured token that is too short to be a secret", () => {
  configure("short");
  const outcome = authorizeRequest({ headers: { authorization: "Bearer short" }, url: "/mcp" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.status, 500);
});

test("accepts the token as a bearer header", () => {
  configure(TOKEN);
  const outcome = authorizeRequest({ headers: { authorization: `Bearer ${TOKEN}` }, url: "/mcp" });
  assert.deepEqual(outcome, { ok: true, via: "header" });
});

test("accepts the token in x-api-key", () => {
  configure(TOKEN);
  const outcome = authorizeRequest({ headers: { "x-api-key": TOKEN }, url: "/mcp" });
  assert.deepEqual(outcome, { ok: true, via: "header" });
});

test("accepts the token in the path", () => {
  configure(TOKEN);
  const outcome = authorizeRequest({ headers: {}, url: `/mcp/${TOKEN}` });
  assert.deepEqual(outcome, { ok: true, via: "path" });
});

test("accepts the token from the rewrite query param", () => {
  configure(TOKEN);
  const outcome = authorizeRequest({ headers: {}, url: `/api/mcp?token=${TOKEN}` });
  assert.deepEqual(outcome, { ok: true, via: "path" });
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
