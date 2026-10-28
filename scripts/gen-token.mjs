#!/usr/bin/env node
/**
 * Generates a token for the remote MCP endpoint.
 *
 *   node scripts/gen-token.mjs            # the single-user MCP_AUTH_TOKEN
 *   node scripts/gen-token.mjs simone     # a token for user SIMONE (MCP_USER_SIMONE_*)
 *
 * 32 random bytes, base64url (43 chars, no padding, URL-safe so it also works as /mcp/<token>).
 * The token goes on stdout, the setup instructions on stderr.
 */
import { randomBytes } from "node:crypto";

const rawName = process.argv[2];
const name = rawName?.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
if (rawName !== undefined && !name) {
  process.stderr.write(`"${rawName}" is not a usable user name: use letters and digits.\n`);
  process.exit(1);
}

const token = randomBytes(32).toString("base64url");

const setup = name
  ? [
      `vercel env add MCP_USER_${name}_TOKEN production           # paste the token above`,
      `vercel env add MCP_USER_${name}_INTERVALS_KEY production   # paste ${name}'s intervals.icu key`,
      "vercel --prod                                              # env vars apply on the next deploy",
    ]
  : ["vercel env add MCP_AUTH_TOKEN production", "vercel --prod"];

process.stdout.write(`${token}\n`);
process.stderr.write(
  [
    "",
    "Set it on the server:",
    ...setup.map((line) => `  ${line}`),
    "Use it from a client:   Authorization: Bearer <token>",
    "                        or https://<deployment>/mcp/<token>",
    "Treat it like a password: it grants full read/write on that intervals.icu account.",
    "",
  ].join("\n"),
);
