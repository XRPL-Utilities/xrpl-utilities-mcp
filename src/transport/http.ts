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
import { SERVICES, ALL_TOOLS } from "../services/index.js";
import { SERVER_VERSION } from "../version.js";
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
        "MCP server for the XRPL-Utilities portfolio (Sentinel, Pulse, Telemetry, Trust, Vault, Flows). Connect any MCP client to /mcp.",
      version: SERVER_VERSION,
      mcp_endpoint: "/mcp",
      manifest: "/agents.json",
      well_known_manifest: "/.well-known/agents.json",
      llms_discovery: "/llms.txt",
      docs: "https://github.com/XRPL-Utilities/xrpl-utilities-mcp",
      portfolio: "https://xrpl-utilities.com",
    });
  });

  app.get("/healthz", async (_req, res) => {
    res.json({ status: "ok", service: "xrpl-utilities-mcp", version: SERVER_VERSION });
  });

  // ---- Discovery surfaces for non-MCP-speaking crawlers ----
  // The /mcp endpoint speaks JSON-RPC (POST + SSE) and is invisible
  // to a regular HTTP crawler. These routes give an LLM crawler or
  // search engine something to chew on so the MCP server isn't a
  // discoverability black hole.

  const manifest = () => ({
    schema_version: SERVER_VERSION,
    name: "XRPL-Utilities MCP",
    provider: "XRPL-Utilities™",
    description:
      "Model Context Protocol server exposing the XRPL-Utilities portfolio " +
      "(Sentinel, Pulse, Telemetry, Trust, Vault, Flows) as " + ALL_TOOLS.length + " callable tools " +
      "for AI agents. Stateless passthrough proxy: callers supply their own " +
      "x402 v2 payment header per tool call. Settled inline via the t54 " +
      "facilitator on XRPL mainnet; $0.10 USD per paid call lands on the " +
      "operator treasury wallet. The MCP server holds no wallets and takes no cut.",
    service_status: "live",
    endpoints: {
      base_url: "https://mcp.xrpl-utilities.io",
      mcp: "/mcp",
      discovery: "/llms.txt",
      manifest: "/agents.json",
      well_known_manifest: "/.well-known/agents.json",
      health: "/healthz",
    },
    transports: ["stdio", "streamable-http"],
    tool_count: ALL_TOOLS.length,
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      auth_mode: t.authMode,
    })),
    underlying_services: SERVICES.map((s) => ({
      id: s.id,
      label: s.label,
      base_url: s.baseUrl,
      manifest_url: s.manifestUrl,
    })),
    homepage: "https://xrpl-utilities.com",
    repository: "https://github.com/XRPL-Utilities/xrpl-utilities-mcp",
    npm: "https://www.npmjs.com/package/@xrpl-utilities/mcp",
    license: "MIT",
  });

  app.get("/agents.json", (_req, res) => res.json(manifest()));
  app.get("/.well-known/agents.json", (_req, res) => res.json(manifest()));

  app.get("/llms.txt", (_req, res) => {
    const toolList = ALL_TOOLS.map((t) =>
      `- \`${t.name}\` [${t.authMode}]`,
    ).join("\n");
    const body = [
      "# XRPL-Utilities MCP™",
      "",
      "Model Context Protocol server exposing the XRPL-Utilities portfolio",
      `(Sentinel, Pulse, Telemetry, Trust, Vault, Flows) as ${ALL_TOOLS.length} callable tools for AI agents.`,
      "Stateless passthrough proxy.",
      "Provider: XRPL-Utilities™ LLC.",
      "",
      "## Connect",
      "- Hosted (any MCP client, including Claude Desktop with HTTP support):",
      "  POST JSON-RPC + SSE to `https://mcp.xrpl-utilities.io/mcp`",
      "- Local (Claude Desktop config):",
      "  ```",
      "  npm i @xrpl-utilities/mcp",
      "  npx @xrpl-utilities/mcp --transport stdio",
      "  ```",
      "",
      "## Tools",
      toolList,
      "",
      "## Auth model",
      "Each `inline_x402` tool requires the caller to pass `payment_signature` in",
      "tool args - a base64-JSON-encoded x402 v2 payment header signing an XRPL",
      "Payment that matches one of the requirements returned by an unauthenticated",
      "probe. The MCP server forwards it as the `PAYMENT-SIGNATURE` header on the",
      "underlying call. $0.10 USD per call (XRP or RLUSD), settled inline via the",
      "t54 facilitator. The `async_invoice` tools (Telemetry quote/status/results)",
      "use an out-of-band XRPL Payment to a deeplink instead of an inline header.",
      "",
      "## Discovery",
      "- Manifest:    https://mcp.xrpl-utilities.io/agents.json",
      "- Source:      https://github.com/XRPL-Utilities/xrpl-utilities-mcp",
      "- npm package: https://www.npmjs.com/package/@xrpl-utilities/mcp",
      "- Portfolio:   https://xrpl-utilities.com",
      "",
      "## What this is NOT",
      "Not a wallet. Not a custodian. Not an editorial product. Not investment",
      "advice. The MCP server holds no wallets and takes no cut - same x402",
      "settlement model as direct API calls, just wrapped as MCP tools so AI",
      "agents can discover and use them via tool-completion.",
      "",
    ].join("\n");
    res.type("text/markdown; charset=utf-8").send(body);
  });

  app.get("/robots.txt", (_req, res) => {
    const body = [
      "# xrpl-utilities-mcp is built to be discovered by AI agents and crawlers.",
      "# Machine-readable manifests: /agents.json, /.well-known/agents.json, /llms.txt",
      "# MCP JSON-RPC endpoint: /mcp",
      "User-agent: *",
      "Allow: /",
      "",
    ].join("\n");
    res.type("text/plain; charset=utf-8").send(body);
  });

  // Stateless mode: each /mcp request gets a fresh Server + Transport
  // pair. The MCP SDK's streamable-http transport, even with
  // sessionIdGenerator: undefined, doesn't reliably handle a shared
  // transport instance across multiple unrelated requests - the second
  // call returns 500 because the transport's internal state is still
  // tied to the first request. The recommended stateless pattern is
  // build-connect-handle-close per request. Cheap: the Server object
  // is just function pointers, no expensive state.
  app.all("/mcp", async (req, res) => {
    if (!rateLimit(req, res)) return;
    let transport: StreamableHTTPServerTransport | null = null;
    try {
      const mcpServer = buildServer({
        bypassKey: process.env["MCP_BYPASS_KEY"],
        userAgent: `xrpl-utilities-mcp/${SERVER_VERSION} (http)`,
      });
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      // Make sure the transport is torn down when the response closes,
      // so a long-running SSE stream doesn't leak file descriptors.
      res.on("close", () => {
        transport?.close().catch(() => {});
        mcpServer.close().catch(() => {});
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[mcp] handleRequest threw:", (e as Error).stack ?? e);
      if (!res.headersSent) {
        res.status(500).json({ error: "mcp_handle_failed", detail: (e as Error).message });
      }
    }
  });

  // Surface unhandled rejections in the dispatcher / SDK so we don't get
  // mystery 500s from Express's default error handler with no body.
  process.on("unhandledRejection", (reason) => {
    // eslint-disable-next-line no-console
    console.error("[mcp] unhandledRejection:", reason);
  });

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`xrpl-utilities-mcp listening on :${port} (http)`);
  });
}
