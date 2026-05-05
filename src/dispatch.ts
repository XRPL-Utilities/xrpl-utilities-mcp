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

import { findToolOwner } from "./services/index.js";

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

  // Substitute path params (e.g. /domain/{domain_id}) from args.
  let path = tool.path;
  const consumedPathArgs = new Set<string>();
  path = path.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, key: string) => {
    if (!(key in args)) {
      throw new Error(
        `tool ${toolName} requires path parameter ${key}, missing from args`,
      );
    }
    consumedPathArgs.add(key);
    return encodeURIComponent(String(args[key]));
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
    "User-Agent": opts.userAgent ?? "xrpl-utilities-mcp/0.1.6",
  };

  const callerPaymentSig = stringArg(args.payment_signature);
  const callerBypassKey = stringArg(args._bypass_key);

  if (tool.authMode === "inline_x402") {
    if (callerPaymentSig) {
      headers["PAYMENT-SIGNATURE"] = callerPaymentSig;
    } else if (callerBypassKey && opts.bypassKey && callerBypassKey === opts.bypassKey) {
      // Operator-issued bypass. Forward as the dev-bypass header that
      // the underlying services accept.
      headers["PAYMENT-SIGNATURE"] = callerBypassKey;
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
          ? "This endpoint requires x402 payment. Sign an XRPL Payment matching one of the entries in 'accepts', base64-JSON-encode it, and pass as payment_signature."
          : undefined,
    };
  }
  return parsed;
}

function stringArg(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
