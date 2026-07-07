/**
 * MCP server core. Wires the registered tools into the MCP SDK's
 * Server abstraction and routes incoming tool calls through the
 * dispatcher. Transport-agnostic — the same Server object is later
 * connected via stdio (transport-stdio) or HTTP/SSE (transport-http).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ALL_TOOLS, SERVICES } from "./services/index.js";
import { dispatchTool, type DispatchOptions } from "./dispatch.js";
import { attest } from "./hSeal.js";
import { buildReceipt, type HSealReceiptResult } from "./hSealReceipt.js";
import { SERVER_VERSION } from "./version.js";

const SERVER_NAME = "xrpl-utilities";

export function buildServer(opts: DispatchOptions = {}): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  // ---- Tools ---------------------------------------------------------------
  // Each tool advertises a structured `_meta.pricing` block so MCP clients
  // can render a paid/free badge or sort by price without parsing prose. The
  // standard MCP spec ignores unknown _meta keys, so clients that don't render
  // it lose nothing; clients that do render get a clean signal.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map((t) => {
      const pricing =
        t.authMode === "free"
          ? { paid: false, priceUsd: 0 }
          : t.authMode === "async_invoice"
            ? { paid: true, priceUsd: 0.10, settlement: "xrpl_invoice" }
            : t.name === "xrpl_pulse_stream_purchase"
              ? { paid: true, priceUsd: 0.50, priceUsdMax: 7.50, settlement: "x402_inline", note: "tiered_1h_6h_24h" }
              : { paid: true, priceUsd: 0.10, settlement: "x402_inline" };
      return {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        _meta: { pricing },
      };
    }),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const startedMs = Date.now();
      const result = await dispatchTool(req.params.name, args, opts);
      const endedMs = Date.now();

      // Co-sign the (request, response) pair so the caller can anchor a
      // tamper-evident H-Seal receipt carrying our attestation that we served
      // it. Strip transport-only secrets from the signed request so the
      // attestation stays reproducible and never folds a payment signature or
      // bypass key into the receipt hash. No-op when H-Seal env is unset.
      const signedArgs: Record<string, unknown> = { ...args };
      delete signedArgs["payment_signature"];
      delete signedArgs["_bypass_key"];

      // If the backend co-signed its OWN output (returned `hSealAttestation`),
      // build a 2-party receipt: caller = this MCP, provider = that backend.
      // Split it out of the displayed result and into _meta.hSealReceipt.
      let displayResult: unknown = result;
      let hSealReceipt: HSealReceiptResult | undefined;
      if (result && typeof result === "object" && "hSealAttestation" in result) {
        const { hSealAttestation, ...clean } = result as Record<string, unknown>;
        displayResult = clean;
        hSealReceipt = await buildReceipt({
          serviceEndpoint: "https://mcp.xrpl-utilities.io",
          attestation: hSealAttestation,
          startedAt: Math.floor(startedMs / 1000),
          completedAt: Math.floor(endedMs / 1000),
          latencyMs: endedMs - startedMs,
        });
      }

      const attestation = await attest(
        { tool: req.params.name, args: signedArgs },
        displayResult,
      );

      const meta: Record<string, unknown> = {};
      if (attestation) meta.hSeal = attestation;
      if (hSealReceipt) meta.hSealReceipt = hSealReceipt;

      return {
        content: [
          {
            type: "text" as const,
            text: typeof displayResult === "string" ? displayResult : JSON.stringify(displayResult, null, 2),
          },
        ],
        ...(Object.keys(meta).length ? { _meta: meta } : {}),
      };
    } catch (e) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `xrpl-utilities-mcp dispatch error: ${(e as Error).message}`,
          },
        ],
      };
    }
  });

  // ---- Resources -----------------------------------------------------------
  // Each service's live agents.json + /schema is exposed as a resource
  // so the LLM can fetch the full manifest / output-shape detail without
  // a tool call. This is the MCP-native way to surface "static-ish"
  // documentation alongside the actionable tools.
  const resources = SERVICES.flatMap((s) => [
    {
      uri: `${s.baseUrl}/agents.json`,
      mimeType: "application/json",
      name: `${s.label} agents.json`,
      description: `Live agent-discovery manifest for ${s.label}: schema_version, capabilities, endpoint catalog, payment requirements.`,
    },
    {
      uri: `${s.baseUrl}/schema`,
      mimeType: "application/json",
      name: `${s.label} /schema`,
      description: `Field-level output shape for ${s.label} responses. Source of truth for what each tool returns.`,
    },
  ]);

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources,
  }));

  // Allow-list of registered resource URIs. ReadResource must reject any
  // URI not in this set so a malicious caller can't turn the hosted MCP
  // endpoint into an SSRF proxy (cloud-metadata fetch, internal-network
  // probe, arbitrary outbound HTTP from the Railway egress IP).
  const allowedResourceUris = new Set(resources.map((r) => r.uri));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    if (!allowedResourceUris.has(uri)) {
      throw new Error(`unknown resource: ${uri}`);
    }
    const ctl = new AbortController();
    const tId = setTimeout(() => ctl.abort(), 10_000);
    try {
      const r = await fetch(uri, { signal: ctl.signal });
      const text = await r.text();
      return {
        contents: [
          {
            uri,
            mimeType: r.headers.get("content-type") ?? "application/json",
            text,
          },
        ],
      };
    } finally {
      clearTimeout(tId);
    }
  });

  return server;
}
