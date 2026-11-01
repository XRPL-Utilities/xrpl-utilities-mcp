/**
 * Standard x402-over-MCP support (x402 spec, transports-v2/mcp.md).
 *
 *   - An unpaid or refused call returns a tool result with isError: true,
 *     the PaymentRequired object in structuredContent and its JSON in the
 *     first text item.
 *   - The client retries with the signed PaymentPayload object in
 *     params._meta["x402/payment"].
 *   - A settled call carries the settlement in result._meta["x402/payment-response"].
 *
 * The backends still do all verification and settlement. This module only
 * translates between the MCP shapes and the HTTP PAYMENT-SIGNATURE /
 * PAYMENT-REQUIRED / PAYMENT-RESPONSE headers.
 *
 * Resource URLs: a challenge names the bare MCP endpoint, as the Bazaar spec
 * expects, unless the tool is listed in BAZAAR_FRAGMENT_TOOLS (see
 * fragmentTools). Before forwarding, a Base (eip155) payload is pointed at
 * `${MCP_PUBLIC_URL}#<tool>`, which is the key the backend uses to attach the
 * MCP-tool Bazaar entry when it settles with Coinbase (the backend sends
 * Coinbase the bare URL again). Any other network gets the
 * backend's own route URL back, so the XRPL rail sees exactly what it sees
 * from a direct caller. The resource is metadata outside the signed
 * authorization, so rewriting it does not touch what the buyer signed.
 */

import { bazaarExample } from "./bazaarExamples.js";

export const MCP_PUBLIC_URL = "https://mcp.xrpl-utilities.io/mcp";
export const META_PAYMENT = "x402/payment";
export const META_PAYMENT_RESPONSE = "x402/payment-response";

// A real PaymentPayload is a few KB at most; refuse anything far larger before
// it is serialised into an upstream header.
const MAX_PAYLOAD_BYTES = 16_384;

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function toolResourceUrl(toolName: string): string {
  return `${MCP_PUBLIC_URL}#${toolName}`;
}

/**
 * Tools whose challenge names `${MCP_PUBLIC_URL}#<tool>` instead of the bare
 * endpoint. Every MCP entry the Bazaar lists uses that form
 * (x402-foundation/x402#4075), so this lets one tool test it alone.
 * Comma-separated tool names in BAZAAR_FRAGMENT_TOOLS; empty by default.
 */
export function fragmentTools(): Set<string> {
  const raw = process.env["BAZAAR_FRAGMENT_TOOLS"] ?? "";
  return new Set(raw.split(",").map((t) => t.trim()).filter(Boolean));
}

function challengeResourceUrl(toolName: string): string {
  return fragmentTools().has(toolName) ? toolResourceUrl(toolName) : MCP_PUBLIC_URL;
}

/** Decode a base64 JSON header value. Returns undefined on anything malformed. */
export function decodeB64Json(value: string | null | undefined): Json | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function payloadNetwork(payload: Json): string {
  const accepted = payload.accepted;
  if (isObject(accepted) && typeof accepted.network === "string") return accepted.network;
  return typeof payload.network === "string" ? payload.network : "";
}

/**
 * Point the payload's resource at the URL the backend should see (see the
 * module note) and return it base64-JSON encoded for PAYMENT-SIGNATURE.
 * Throws on a payload that is not an object or is oversized.
 */
export function encodeForBackend(
  payload: unknown,
  toolName: string,
  backendUrl: string,
): string {
  if (!isObject(payload)) {
    throw new Error(`_meta["${META_PAYMENT}"] must be a PaymentPayload object`);
  }
  const out: Json = { ...payload };
  const viaBase = payloadNetwork(out).startsWith("eip155:");
  const prior = isObject(out.resource) ? out.resource : {};
  out.resource = { ...prior, url: viaBase ? toolResourceUrl(toolName) : backendUrl };
  const json = JSON.stringify(out);
  if (Buffer.byteLength(json, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error("payment payload too large");
  }
  return Buffer.from(json, "utf8").toString("base64");
}

/**
 * Re-point a payment_signature header value the same way. A value that does
 * not decode to an object is forwarded untouched: the backend owns the error.
 */
export function normalizeSignatureHeader(
  header: string,
  toolName: string,
  backendUrl: string,
): string {
  const decoded = decodeB64Json(header);
  if (!decoded) return header;
  try {
    return encodeForBackend(decoded, toolName, backendUrl);
  } catch {
    return header;
  }
}

// Transport-only arguments: never part of a tool's advertised input.
const TRANSPORT_ARGS = new Set(["payment_signature", "_bypass_key"]);

export interface BazaarToolInfo {
  name: string;
  description: string;
  inputSchema: object;
}

/**
 * The spec `extensions.bazaar` declaration for one MCP tool
 * (x402 specs/extensions/bazaar.md, `input.type: "mcp"`). Must match what
 * the backends attach at settle time (x402_baseline._bazaar_mcp_extension).
 */
export function mcpBazaarExtension(tool: BazaarToolInfo): Json {
  const schema = { ...(tool.inputSchema as Json) };
  if (isObject(schema.properties)) {
    schema.properties = Object.fromEntries(
      Object.entries(schema.properties).filter(([k]) => !TRANSPORT_ARGS.has(k)),
    );
  }
  if (Array.isArray(schema.required)) {
    schema.required = schema.required.filter((k) => !TRANSPORT_ARGS.has(String(k)));
  }
  // The Bazaar indexes an MCP tool by calling it with input.example.
  const example = bazaarExample(tool.name);
  return {
    info: {
      input: {
        type: "mcp",
        toolName: tool.name,
        inputSchema: schema,
        transport: "streamable-http",
        description: tool.description,
        ...(example ? { example } : {}),
      },
      output: { type: "json" },
    },
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        input: {
          type: "object",
          properties: {
            type: { type: "string", const: "mcp" },
            toolName: { type: "string" },
            inputSchema: { type: "object" },
            transport: { type: "string", enum: ["streamable-http"] },
            description: { type: "string" },
            example: { type: "object" },
          },
          required: ["type", "toolName", "inputSchema"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: { type: { type: "string" }, example: {} },
          required: ["type"],
        },
      },
      required: ["input"],
    },
  };
}

/**
 * Base (eip155) options first, everything else after, each group in the
 * backend's order. The backends lead with RLUSD on XRPL; every MCP server
 * the Coinbase Bazaar lists leads with Base, and Coinbase is the only
 * facilitator that lists MCP tools. Reordering drops nothing, so a client
 * that picks by network still finds its rail.
 */
export function baseFirst(accepts: unknown[]): unknown[] {
  const isBase = (a: unknown) =>
    isObject(a) && typeof a.network === "string" && a.network.startsWith("eip155:");
  return [...accepts.filter(isBase), ...accepts.filter((a) => !isBase(a))];
}

/**
 * Bazaar service metadata for a paid tool's challenge (x402 bazaar spec,
 * "Service Metadata on `resource`"). It mirrors x402_baseline.py
 * bazaar_service_metadata(service, mcp=True) in the backends, which attach the
 * same values to the settle request: the MCP's name and icon, the three shared
 * tags, "mcp", and the backend's first topical tag.
 */
export const MCP_SERVICE_NAME = "XRPL-Utilities MCP";
export const MCP_ICON_URL = "https://xrpl-utilities.com/assets/img/logo-512.webp";
const COMMON_TAGS = ["xrpl", "xrp", "on-chain", "mcp"];
const MAX_TAGS = 5;

export function mcpServiceTags(backendTags: unknown): string[] {
  const out = [...COMMON_TAGS];
  const seen = new Set(out);
  const extra = Array.isArray(backendTags) ? backendTags : [];
  for (const t of extra) {
    if (out.length >= MAX_TAGS) break;
    if (typeof t !== "string" || !/^[\x20-\x7e]{1,32}$/.test(t)) continue;
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/**
 * Build the PaymentRequired object an MCP client sees from the backend's 402.
 * Prefers the JSON body; falls back to the PAYMENT-REQUIRED header.
 *
 * The backend's 402 describes its HTTP route. Here the resource is the bare
 * MCP endpoint and the Bazaar declaration is the MCP tool, as the spec's MCP
 * example shows; a passed-through `type: "http"` declaration at an MCP URL
 * kept the tools out of the Bazaar on 2026-10-30.
 */
export function paymentRequiredFor(
  toolName: string,
  body: unknown,
  header: string | null,
  tool?: BazaarToolInfo,
): Json | undefined {
  const source = isObject(body) && Array.isArray(body.accepts) ? body : decodeB64Json(header);
  if (!source || !Array.isArray(source.accepts)) return undefined;
  const prior = isObject(source.resource) ? source.resource : {};
  const extensions: Json = isObject(source.extensions) ? { ...source.extensions } : {};
  if (tool) extensions.bazaar = mcpBazaarExtension(tool);
  else delete extensions.bazaar;
  const resource: Json = { ...prior, url: challengeResourceUrl(toolName) };
  if (tool) {
    resource.serviceName = MCP_SERVICE_NAME;
    resource.tags = mcpServiceTags(prior.tags);
    resource.iconUrl = MCP_ICON_URL;
  }
  const out: Json = {
    ...source,
    x402Version: typeof source.x402Version === "number" ? source.x402Version : 2,
    resource,
    accepts: baseFirst(source.accepts),
  };
  if (Object.keys(extensions).length) out.extensions = extensions;
  else delete out.extensions;
  return out;
}
