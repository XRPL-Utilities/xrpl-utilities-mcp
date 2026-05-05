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

const SERVER_NAME = "xrpl-utilities";
const SERVER_VERSION = "0.1.6";

export function buildServer(opts: DispatchOptions = {}): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  // ---- Tools ---------------------------------------------------------------
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await dispatchTool(req.params.name, args, opts);
      return {
        content: [
          {
            type: "text" as const,
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
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

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
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
