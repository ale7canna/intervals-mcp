import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Auth for the public HTTP route. Each user has a static token, and the token decides which
 * intervals.icu key serves the request: whoever holds a token can read and write that user's
 * account, so it is password-equivalent. Users come from the environment:
 *
 *   MCP_USER_<NAME>_TOKEN          the token
 *   MCP_USER_<NAME>_INTERVALS_KEY  that user's intervals.icu API key
 *   MCP_USER_<NAME>_ATHLETE_ID     optional, as INTERVALS_ATHLETE_ID
 *
 * plus the original single-user pair MCP_AUTH_TOKEN + INTERVALS_API_KEY, served as `default`.
 *
 * Two ways to present a token, because MCP clients differ:
 *
 *   header  Authorization: Bearer <token>  (also x-api-key / x-auth-token)
 *   path    /mcp/<token>                   (for clients that cannot send custom headers)
 *
 * The header form is preferred: a token in the path ends up in request logs.
 */

const MIN_TOKEN_LENGTH = 24;
const USER_TOKEN = /^MCP_USER_(.+)_TOKEN$/;
const USER_KEY = /^MCP_USER_(.+)_INTERVALS_KEY$/;

export interface User {
  name: string;
  intervalsKey: string;
  athleteId: string | undefined;
}

export type AuthOutcome =
  | { ok: true; via: "header" | "path"; user: User }
  | { ok: false; status: 401 | 500; message: string };

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  url?: string | undefined;
}

interface ConfiguredUser extends User {
  token: string;
}

export function authorizeRequest(req: RequestLike): AuthOutcome {
  const users = configuredUsers(process.env);
  if (typeof users === "string") {
    return {
      ok: false,
      status: 500,
      message:
        `${users} Generate tokens with \`npm run token -- <name>\`. Refusing to serve an ` +
        "endpoint that can write to an athlete's account while its configuration is broken.",
    };
  }

  const fromHeader = headerToken(req.headers);
  const presented = fromHeader ?? pathToken(req.url);
  if (!presented) {
    return {
      ok: false,
      status: 401,
      message: "Missing token. Send `Authorization: Bearer <token>` or call /mcp/<token>.",
    };
  }

  const user = matchUser(presented, users);
  if (!user) return { ok: false, status: 401, message: "Invalid token." };
  return {
    ok: true,
    via: fromHeader ? "header" : "path",
    user: { name: user.name, intervalsKey: user.intervalsKey, athleteId: user.athleteId },
  };
}

/** Every configured user, or a message saying what is wrong with the configuration. */
function configuredUsers(env: NodeJS.ProcessEnv): ConfiguredUser[] | string {
  const users: ConfiguredUser[] = [];

  const defaultToken = nonEmpty(env["MCP_AUTH_TOKEN"]);
  if (defaultToken) {
    const intervalsKey = nonEmpty(env["INTERVALS_API_KEY"]);
    if (!intervalsKey) return "MCP_AUTH_TOKEN is set but INTERVALS_API_KEY is not.";
    users.push({
      name: "default",
      token: defaultToken,
      intervalsKey,
      athleteId: nonEmpty(env["INTERVALS_ATHLETE_ID"]),
    });
  }

  const names = new Set<string>();
  for (const variable of Object.keys(env)) {
    const name = USER_TOKEN.exec(variable)?.[1] ?? USER_KEY.exec(variable)?.[1];
    if (name && nonEmpty(env[variable])) names.add(name);
  }
  for (const name of [...names].sort()) {
    const token = nonEmpty(env[`MCP_USER_${name}_TOKEN`]);
    const intervalsKey = nonEmpty(env[`MCP_USER_${name}_INTERVALS_KEY`]);
    if (!token) return `MCP_USER_${name}_INTERVALS_KEY is set but MCP_USER_${name}_TOKEN is not.`;
    if (!intervalsKey) {
      return `MCP_USER_${name}_TOKEN is set but MCP_USER_${name}_INTERVALS_KEY is not.`;
    }
    users.push({ name, token, intervalsKey, athleteId: nonEmpty(env[`MCP_USER_${name}_ATHLETE_ID`]) });
  }

  if (users.length === 0) {
    return "No user is configured: set MCP_USER_<NAME>_TOKEN + MCP_USER_<NAME>_INTERVALS_KEY (or MCP_AUTH_TOKEN + INTERVALS_API_KEY).";
  }
  for (const user of users) {
    if (user.token.length < MIN_TOKEN_LENGTH) {
      return `The token for user ${user.name} is shorter than ${MIN_TOKEN_LENGTH} characters.`;
    }
  }
  if (new Set(users.map((user) => user.token)).size !== users.length) {
    return "Two users share the same token, so a request could not be told apart.";
  }
  return users;
}

/**
 * Compares against every user without stopping at the first match, so the response time does
 * not reveal which user matched or how many exist.
 */
function matchUser(presented: string, users: ConfiguredUser[]): ConfiguredUser | undefined {
  let match: ConfiguredUser | undefined;
  for (const user of users) {
    if (sameSecret(presented, user.token)) match = user;
  }
  return match;
}

function headerToken(headers: RequestLike["headers"]): string | undefined {
  const authorization = single(headers["authorization"]);
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) return match[1].trim();
    return authorization.trim(); // tolerate a bare token
  }
  return single(headers["x-api-key"]) ?? single(headers["x-auth-token"]);
}

/** `/mcp/<token>` directly, or `?token=<token>` as produced by the vercel.json rewrite. */
function pathToken(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const parsed = new URL(url, "http://localhost");
  const fromQuery = parsed.searchParams.get("token");
  if (fromQuery) return fromQuery;
  const segments = parsed.pathname.split("/").filter(Boolean);
  const last = segments.at(-1);
  if (!last || last === "mcp" || last === "api") return undefined;
  return decodeURIComponent(last);
}

function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length > 0 ? first : undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

/** Compare digests so the check is constant-time and does not leak the token's length. */
function sameSecret(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
