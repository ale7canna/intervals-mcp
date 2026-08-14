import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authorizeRequest } from "../dist/auth.js";
import { IntervalsClient } from "../dist/client.js";
import { buildServer } from "../dist/server.js";

/**
 * Remote MCP endpoint (Vercel Node function).
 *
 * Stateless: a server + transport are built per request, so nothing has to be kept in memory
 * between invocations — which is the only thing that works on serverless. `enableJsonResponse`
 * makes it answer with a single JSON response instead of an SSE stream.
 *
 * The intervals.icu API key stays here, server-side. Clients authenticate with MCP_AUTH_TOKEN.
 */
export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  const auth = authorizeRequest({ headers: req.headers, url: req.url });
  if (!auth.ok) {
    if (auth.status === 401) res.setHeader("WWW-Authenticate", 'Bearer realm="intervals-mcp"');
    sendError(res, auth.status, auth.message);
    return;
  }

  if (req.method === "GET" || req.method === "DELETE") {
    // Stateless mode has no standalone SSE stream and no session to delete.
    sendError(res, 405, "This endpoint is stateless: use POST for JSON-RPC requests.");
    return;
  }
  if (req.method !== "POST") {
    sendError(res, 405, `Method ${req.method ?? "?"} not allowed.`);
    return;
  }

  const apiKey = process.env["INTERVALS_API_KEY"];
  if (!apiKey) {
    sendError(res, 500, "INTERVALS_API_KEY is not configured on the server.");
    return;
  }

  const client = new IntervalsClient({
    apiKey,
    athleteId: process.env["INTERVALS_ATHLETE_ID"],
  });
  const server = buildServer(client);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    // Never leak the token or internals; the message is enough to debug from the client side.
    console.error("mcp handler failed:", error instanceof Error ? error.message : error);
    if (!res.headersSent) sendError(res, 500, "Internal error handling the MCP request.");
  }
}

function sendError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message }));
}
