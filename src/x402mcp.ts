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
 * Resource URLs: a challenge names `${MCP_PUBLIC_URL}#<tool>` so a paying
 * client echoes the tool it bought. Before forwarding, a Base (eip155) payload
 * keeps that URL, which is the key the backend uses to attach the MCP-tool
 * Bazaar entry when it settles with Coinbase. Any other network gets the
 * backend's own route URL back, so the XRPL rail sees exactly what it sees
 * from a direct caller. The resource is metadata outside the signed
 * authorization, so rewriting it does not touch what the buyer signed.
 */

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

/**
 * Build the PaymentRequired object an MCP client sees from the backend's 402.
 * Prefers the JSON body; falls back to the PAYMENT-REQUIRED header.
 */
export function paymentRequiredFor(
  toolName: string,
  body: unknown,
  header: string | null,
): Json | undefined {
  const source = isObject(body) && Array.isArray(body.accepts) ? body : decodeB64Json(header);
  if (!source || !Array.isArray(source.accepts)) return undefined;
  const prior = isObject(source.resource) ? source.resource : {};
  return {
    ...source,
    x402Version: typeof source.x402Version === "number" ? source.x402Version : 2,
    resource: { ...prior, url: toolResourceUrl(toolName) },
  };
}
