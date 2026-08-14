#!/usr/bin/env node
/**
 * Generates the shared secret for the remote MCP endpoint.
 *
 *   node scripts/gen-token.mjs
 *
 * 32 random bytes, base64url (43 chars, no padding, URL-safe so it also works as /mcp/<token>).
 * Set it as MCP_AUTH_TOKEN on the server and give the same value to the client.
 */
import { randomBytes } from "node:crypto";

const token = randomBytes(32).toString("base64url");

process.stdout.write(`${token}\n`);
process.stderr.write(
  [
    "",
    "Set it on the server:   vercel env add MCP_AUTH_TOKEN production",
    "Use it from a client:   Authorization: Bearer <token>",
    "                        or https://<deployment>/mcp/<token>",
    "Treat it like a password: it grants full read/write on the intervals.icu account.",
    "",
  ].join("\n"),
);
