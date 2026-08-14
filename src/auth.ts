import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Auth for the public HTTP route. The shared secret is a static token in MCP_AUTH_TOKEN:
 * whoever holds it can read and write the athlete's intervals.icu account, so it is
 * password-equivalent. Two ways to present it, because MCP clients differ:
 *
 *   header  Authorization: Bearer <token>  (also x-api-key / x-auth-token)
 *   path    /mcp/<token>                   (for clients that cannot send custom headers)
 *
 * The header form is preferred: a token in the path ends up in request logs.
 */

export type AuthOutcome =
  | { ok: true; via: "header" | "path" }
  | { ok: false; status: 401 | 500; message: string };

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  url?: string | undefined;
}

export function authorizeRequest(req: RequestLike): AuthOutcome {
  const expected = process.env["MCP_AUTH_TOKEN"];
  if (!expected || expected.length < 24) {
    return {
      ok: false,
      status: 500,
      message:
        "MCP_AUTH_TOKEN is not set (or is too short) on the server. Generate one with " +
        "`node scripts/gen-token.mjs` and set it as an environment variable. Refusing to serve " +
        "an unauthenticated endpoint that can write to the athlete's account.",
    };
  }

  const fromHeader = headerToken(req.headers);
  if (fromHeader) {
    return sameSecret(fromHeader, expected)
      ? { ok: true, via: "header" }
      : { ok: false, status: 401, message: "Invalid token." };
  }

  const fromPath = pathToken(req.url);
  if (fromPath) {
    return sameSecret(fromPath, expected)
      ? { ok: true, via: "path" }
      : { ok: false, status: 401, message: "Invalid token." };
  }

  return {
    ok: false,
    status: 401,
    message: "Missing token. Send `Authorization: Bearer <token>` or call /mcp/<token>.",
  };
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

/** Compare digests so the check is constant-time and does not leak the token's length. */
function sameSecret(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
