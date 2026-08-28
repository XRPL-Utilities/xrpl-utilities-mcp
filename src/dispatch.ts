/**
 * Tool dispatcher: receives an MCP tool call, looks up the owning
 * service + tool, builds the underlying HTTP request, forwards the
 * response.
 *
 * Auth model (per-tool, see ToolDef.authMode):
 *
 *   inline_x402   - caller passes payment_signature in tool args; the
 *                   dispatcher forwards it as the PAYMENT-SIGNATURE
 *                   header. Standard x402 v2; \$0.10 USD settled inline
 *                   via the t54 facilitator on every successful call.
 *
 *   async_invoice - MCP wrapper around one step of Telemetry's three-
 *                   step flow (quote -> pay -> status -> results). The
 *                   wrapper itself doesn't carry a payment header; the
 *                   actual XRPL Payment happens out-of-band when the
 *                   caller pays the deeplink returned by quote.
 *
 *   free          - no payment ever. Reserved for future pure-metadata
 *                   wrappers; not used by any current tool.
 *
 * Operator-issued bypass: if MCP_BYPASS_KEY is set on the MCP process
 * AND an inline_x402 tool call includes a matching `_bypass_key` in
 * args, the dispatcher forwards it as the dev-bypass header on the
 * underlying service (rate-limited at the MCP transport layer).
 *
 * The web-origin bypass that the marketing site uses is deliberately
 * NOT honored here: that bypass is meant for the human-facing site,
 * not for agent traffic. Otherwise the MCP server would silently turn
 * a paid agent API into a free one.
 */

import { timingSafeEqual } from "node:crypto";

import { findToolOwner } from "./services/index.js";
import type { JSONSchema7 } from "./jsonschema.js";
import { SERVER_VERSION } from "./version.js";


function timingSafeStringEqual(a: string, b: string): boolean {
  // Length-prefix to avoid the timingSafeEqual length-mismatch throw.
  // The length check itself is a timing oracle of 1 bit (caller can
  // learn the secret length); acceptable trade-off matching how
  // hmac.compare_digest works on the Python side.
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface DispatchOptions {
  /**
   * Global bypass key from the MCP_BYPASS_KEY env var. When the caller
   * also presents this key (via the `_bypass_key` reserved tool arg),
   * the dispatcher uses it as the dev-bypass header on the underlying
   * service. Rate-limited by the caller (see transport-http).
   */
  bypassKey?: string;
  /** Override base URLs (useful for tests pointing at localhost). */
  baseUrlOverride?: (serviceId: string) => string | undefined;
  /**
   * Identity string put on the User-Agent header so service-side logs
   * can distinguish MCP traffic from direct API users.
   */
  userAgent?: string;
  /**
   * Called when a caller presented a `_bypass_key` that did not match.
   * The transport layer counts these per-IP: a 60/min request limit still
   * permits thousands of guesses a day against the shared bypass key, and
   * the 402-vs-200 divergence is a clean oracle, so failed attempts need
   * their own much tighter budget.
   */
  onBypassFailure?: () => void;
  /**
   * True while this caller has already burned through the failed-`_bypass_key`
   * budget. Checked here, at the point of the guess, not only at the start of
   * the HTTP request: one batched JSON-RPC POST carries thousands of messages,
   * so a per-request check let a single body spend thousands of guesses before
   * the lockout could apply.
   */
  isBypassBlocked?: () => boolean;
}

/**
 * Run a single tool call. Throws on missing tool / network error /
 * non-2xx upstream response. Caller (the MCP server adapter) is
 * responsible for catching and converting to an MCP-shaped error.
 */
export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>,
  opts: DispatchOptions = {},
): Promise<unknown> {
  const owner = findToolOwner(toolName);
  if (!owner) {
    throw new Error(`unknown tool: ${toolName}`);
  }
  const { service, tool } = owner;
  const baseUrl = opts.baseUrlOverride?.(service.id) ?? service.baseUrl;

  // The low-level MCP Server does NOT check arguments against the advertised
  // inputSchema - only McpServer.registerTool does - so every declared
  // pattern/enum/limit is advisory until we enforce it here.
  args = validateArgs(toolName, tool.inputSchema, args);

  // Substitute path params (e.g. /domain/{domain_id}) from args.
  let path = tool.path;
  const consumedPathArgs = new Set<string>();
  path = path.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, key: string) => {
    if (!(key in args)) {
      throw new Error(
        `tool ${toolName} requires path parameter ${key}, missing from args`,
      );
    }
    // Unconditional, schema-independent. "." / ".." / a slash survive
    // encodeURIComponent's intent because the WHATWG URL parser normalizes the
    // built URL afterwards: /domain/.. collapses to the service root, and the
    // paid drill-down tool then returns the root banner as a success - which,
    // with H-Seal on, gets co-signed as an answer to the tool that was called.
    const raw = String(args[key]);
    if (raw === "" || raw === "." || raw === ".." || /[/\\]/.test(raw)) {
      throw new Error(`tool ${toolName}: invalid value for path parameter ${key}`);
    }
    consumedPathArgs.add(key);
    return encodeURIComponent(raw);
  });

  // Strip args reserved for transport-level concerns (payment_signature,
  // _bypass_key) AND args already consumed by path params. What remains
  // is the actual API payload.
  const stripSet = new Set<string>([
    ...(tool.stripArgs ?? []),
    "_bypass_key",
    "payment_signature",
  ]);
  const apiArgs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (consumedPathArgs.has(k)) continue;
    if (stripSet.has(k)) continue;
    apiArgs[k] = v;
  }

  // Auth resolution. The caller can either supply payment_signature
  // (which we forward as PAYMENT-SIGNATURE) or _bypass_key (which we
  // verify against MCP_BYPASS_KEY before forwarding to the underlying
  // service as its dev-bypass header).
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": opts.userAgent ?? `xrpl-utilities-mcp/${SERVER_VERSION}`,
  };

  const callerPaymentSig = stringArg(args.payment_signature);
  const callerBypassKey = stringArg(args._bypass_key);

  if (tool.authMode === "inline_x402") {
    if (callerPaymentSig) {
      headers["PAYMENT-SIGNATURE"] = callerPaymentSig;
    } else if (callerBypassKey) {
      // Check BEFORE comparing. Gating only the failure branch would leave the
      // compare reachable, so a blocked caller who finally guesses right still
      // gets granted - the budget would cap the noise, not the attack.
      // Throwing rather than falling through to the 402 path also stops the
      // upstream fan-out a batched body would otherwise amplify, and it reads
      // the same for every key: the block is per-IP, so it leaks nothing.
      if (opts.isBypassBlocked?.()) {
        throw new Error("bypass key attempts exhausted; retry later");
      }
      if (opts.bypassKey && timingSafeStringEqual(callerBypassKey, opts.bypassKey)) {
        // Operator-issued bypass. Forward as the dev-bypass header that
        // the underlying services accept.
        headers["PAYMENT-SIGNATURE"] = callerBypassKey;
      } else {
        // A wrong key is a guess at the operator secret, not ordinary traffic.
        // Report it so the transport can budget guesses separately from requests.
        opts.onBypassFailure?.();
      }
    } else {
      // No auth supplied. Fire the request anyway so the caller gets
      // the real 402 challenge back from the underlying service - that
      // tells them what payment_signature shape to send next time. The
      // MCP server is a transparent proxy here, not an enforcer.
    }
  }
  // async_invoice + free both fall through with no PAYMENT-SIGNATURE
  // header. async_invoice tools wrap the Telemetry quote/status/results
  // flow where payment happens out-of-band; free is reserved for
  // future pure-metadata wrappers.

  // Build the request URL (query for GET, body for POST).
  let url = baseUrl + path;
  let body: string | undefined;
  if (tool.method === "GET") {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(apiArgs)) {
      if (v === undefined || v === null) continue;
      params.append(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += "?" + qs;
  } else if (tool.method === "POST") {
    if (tool.bodyFromArgs) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(apiArgs);
    }
  }

  // Run the request. The MCP SDK gives us 30+ seconds of headroom on
  // most clients; we cap at 60s here so an upstream stall surfaces as
  // a timeout error instead of hanging the MCP session forever.
  const ctl = new AbortController();
  const timeoutId = setTimeout(() => ctl.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(url, { method: tool.method, headers, body, signal: ctl.signal });
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  // Surface 402 challenges + 4xx/5xx errors as structured errors so
  // the LLM can reason over them and retry with a payment_signature.
  if (!res.ok) {
    return {
      _error: true,
      status: res.status,
      response: parsed,
      hint:
        res.status === 402
          ? "This endpoint requires x402 payment. Sign a payment matching one of the entries in 'accepts' (RLUSD or XRP on XRPL, or USDC on Base), base64-JSON-encode it, and pass as payment_signature. Prefer a stablecoin entry: RLUSD and USDC are quoted at a flat USD price, while the XRP entry is converted at spot and is absent whenever XRP/USD cannot be verified."
          : undefined,
    };
  }
  return parsed;
}

function stringArg(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// Args the dispatcher consumes itself. They are never part of the API payload
// and are not declared on every schema, so the unknown-key drop must not eat
// them or the operator bypass stops working.
const RESERVED_ARGS = new Set<string>(["payment_signature", "_bypass_key"]);

/**
 * Enforce the tool's advertised inputSchema. Throws on a violation; returns the
 * args to actually send, with unknown keys dropped when the schema is closed
 * (today every tool sets additionalProperties: false, so an invented key would
 * otherwise be forwarded verbatim into the upstream query string or body).
 *
 * Deliberately tolerant about numbers-as-strings: LLM clients routinely send
 * "10" for an integer arg and the backends coerce it, so rejecting that would
 * break working callers without closing anything.
 */
function validateArgs(
  toolName: string,
  schema: JSONSchema7,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const props = schema.properties ?? {};
  const closed = schema.additionalProperties === false;
  const out: Record<string, unknown> = {};

  // `required` is deliberately NOT enforced here. A caller probing a paid tool
  // with no args to get the real 402 challenge back is a supported discovery
  // move (see the auth block below); turning that into a local error would
  // break it.
  for (const [key, value] of Object.entries(args)) {
    const spec = props[key];
    if (!spec) {
      if (RESERVED_ARGS.has(key)) out[key] = value;
      else if (!closed) out[key] = value;
      continue;
    }
    if (value === undefined || value === null) {
      out[key] = value;
      continue;
    }
    const problem = valueProblem(spec, value);
    if (problem) {
      throw new Error(`tool ${toolName}: invalid value for ${key}: ${problem}`);
    }
    out[key] = value;
  }
  return out;
}

function valueProblem(spec: JSONSchema7, value: unknown): string | null {
  if (spec.enum && !spec.enum.some((e) => e === value || String(e) === String(value))) {
    return `must be one of [${spec.enum.map(String).join(", ")}]`;
  }
  if (spec.type === "number" || spec.type === "integer") {
    const n = typeof value === "number" ? value : Number(String(value));
    if (!Number.isFinite(n)) return `must be a ${spec.type}`;
    if (spec.type === "integer" && !Number.isInteger(n)) return "must be an integer";
    if (typeof spec.minimum === "number" && n < spec.minimum) return `must be >= ${spec.minimum}`;
    if (typeof spec.maximum === "number" && n > spec.maximum) return `must be <= ${spec.maximum}`;
    return null;
  }
  if (spec.type === "boolean") {
    if (typeof value === "boolean") return null;
    return value === "true" || value === "false" ? null : "must be a boolean";
  }
  if (spec.type === "string") {
    if (typeof value !== "string") return "must be a string";
    if (spec.pattern && !new RegExp(spec.pattern).test(value)) {
      return `must match ${spec.pattern}`;
    }
    return null;
  }
  return null;
}
