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
import { dispatchToolDetailed, type DispatchOptions } from "./dispatch.js";
import { pricingFor } from "./pricing.js";
import { SERVER_VERSION } from "./version.js";
import { META_PAYMENT, META_PAYMENT_RESPONSE } from "./x402mcp.js";

const SERVER_NAME = "xrpl-utilities";

/**
 * `_bypass_key` (operator-only) is honoured by the dispatcher but is NOT
 * advertised in tools/list: a public schema should not invite strangers to
 * guess an operator secret, and directory crawlers read these schemas. The
 * server does not validate arguments against the advertised schema, so an
 * operator can still send it from a raw JSON-RPC client.
 */

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
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      _meta: { pricing: pricingFor(t.name, t.authMode) },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const reqMeta = req.params._meta as Record<string, unknown> | undefined;
    try {
      const outcome = await dispatchToolDetailed(
        req.params.name, args, opts, reqMeta?.[META_PAYMENT],
      );
      const result = outcome.result;

      // Standard x402-over-MCP: a payment challenge (unpaid, or a payment the
      // backend refused) is an error result carrying PaymentRequired in
      // structuredContent and as JSON in the first text item. The second item
      // keeps the plain-language hint for LLM callers using payment_signature.
      if (outcome.paymentRequired) {
        const hint = (result as { hint?: unknown }).hint;
        return {
          isError: true,
          structuredContent: outcome.paymentRequired,
          content: [
            { type: "text" as const, text: JSON.stringify(outcome.paymentRequired) },
            ...(typeof hint === "string" ? [{ type: "text" as const, text: hint }] : []),
          ],
        };
      }

      const meta: Record<string, unknown> = {};
      if (outcome.paymentResponse) meta[META_PAYMENT_RESPONSE] = outcome.paymentResponse;

      return {
        content: [
          {
            type: "text" as const,
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
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
