/**
 * HTTP/SSE transport. Used when the MCP server runs as a hosted
 * service (Railway, etc.) that remote MCP clients connect to over
 * the network.
 *
 * Endpoints:
 *
 *   GET  /            - service banner + manifest pointer
 *   GET  /healthz     - liveness probe + service ping summary
 *   POST /mcp         - MCP JSON-RPC (streamable-http transport)
 *   GET  /mcp         - MCP JSON-RPC SSE (legacy clients)
 *
 * Auth: every paid tool call still requires the caller to provide
 * their own payment_signature in the tool args. The hosted endpoint
 * is a transparent proxy, NOT a subsidy. Operator-issued bypass via
 * MCP_BYPASS_KEY env var is rate-limited per-IP at the proxy layer.
 */

import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "../server.js";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_WINDOW = 60; // generous; agents typically fire bursts

interface RateBucket {
  count: number;
  resetAt: number;
}
const rateBuckets = new Map<string, RateBucket>();

function rateLimit(req: Request, res: Response): boolean {
  const ip = (req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown")
    .toString()
    .split(",")[0]!
    .trim();
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_PER_WINDOW) {
    res.status(429).json({ error: "rate_limited", retry_after_s: Math.ceil((bucket.resetAt - now) / 1000) });
    return false;
  }
  return true;
}

export async function runHttp(port: number): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.json({
      service: "xrpl-utilities-mcp",
      description:
        "MCP server for the XRPL-Utilities portfolio (Sentinel, Pulse, Telemetry, Trust). Connect any MCP client to /mcp.",
      version: "0.1.0",
      mcp_endpoint: "/mcp",
      docs: "https://github.com/XRPL-Utilities/xrpl-utilities-mcp",
      portfolio: "https://xrpl-utilities.com",
    });
  });

  app.get("/healthz", async (_req, res) => {
    res.json({ status: "ok", service: "xrpl-utilities-mcp", version: "0.1.0" });
  });

  // Single shared MCP server instance. The streamable-http transport
  // multiplexes multiple concurrent client sessions over the /mcp
  // route via per-request session ids that the SDK manages.
  const mcpServer = buildServer({
    bypassKey: process.env["MCP_BYPASS_KEY"],
    userAgent: `xrpl-utilities-mcp/0.1.0 (http)`,
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode - each request stands alone
  });
  await mcpServer.connect(transport);

  app.all("/mcp", async (req, res) => {
    if (!rateLimit(req, res)) return;
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`xrpl-utilities-mcp listening on :${port} (http)`);
  });
}
