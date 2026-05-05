/**
 * Shared types for the XRPL-Utilities MCP server.
 *
 * Each registered service has a base URL, a manifest URL (for the
 * startup schema-discipline check), and a list of tools that wrap
 * specific endpoints. Tools are MCP-callable functions; the server
 * dispatches incoming MCP tool calls to the underlying HTTP endpoint
 * and forwards the response.
 */

import type { JSONSchema7 } from "./jsonschema.js";

export type HttpMethod = "GET" | "POST";

/**
 * Three auth modes are possible per tool:
 *
 *  - inline_x402:  caller passes `payment_signature` in tool args; the
 *                  dispatcher forwards it as the PAYMENT-SIGNATURE
 *                  header on the underlying call. Standard x402 v2
 *                  verify-then-work-then-settle. $0.10 USD lands on
 *                  the operator wallet per successful call.
 *
 *  - async_invoice: this MCP tool wraps one step of the Telemetry
 *                  three-step flow (quote -> pay -> status -> results).
 *                  The MCP wrapper itself doesn't need a payment header
 *                  - the actual XRPL Payment happens out-of-band via
 *                  the deeplink / QR returned by quote. The operator
 *                  still earns $0.10 per snapshot, just settled via a
 *                  regular Payment instead of an inline x402 header.
 *
 *  - free:          truly free. Reserved for endpoints like /healthz
 *                  or /schema mirrors. Not used today; placeholder for
 *                  future XR-* services that may expose pure metadata.
 *
 * The `paid` field has been retained as a deprecated alias - true was
 * inline_x402, false was async_invoice or free. New code should switch
 * on authMode.
 */
export type AuthMode = "inline_x402" | "async_invoice" | "free";

/**
 * A single tool definition. The MCP server exposes one MCP tool per
 * entry. Auth/payment is handled per-call by the dispatcher based on
 * the tool's authMode and the caller-supplied `payment_signature` arg.
 */
export interface ToolDef {
  /** MCP tool name. Convention: xrpl_<service>_<verb>. */
  name: string;
  /** Description shown to the LLM. Be specific about pricing + return shape. */
  description: string;
  /** JSON Schema for the input arguments the LLM provides. */
  inputSchema: JSONSchema7;
  /** Underlying HTTP method on the target service. */
  method: HttpMethod;
  /**
   * Path template on the target service. May contain {param} placeholders
   * that get substituted from the input args before the request fires.
   * Example: "/domain/{domain_id}".
   */
  path: string;
  /** Auth model for this tool. See AuthMode docs above. */
  authMode: AuthMode;
  /**
   * If true, the body of the HTTP request comes from the input args
   * (minus payment_signature). If false, args go in the query string
   * for GETs and there is no body. Only meaningful on POST.
   */
  bodyFromArgs?: boolean;
  /**
   * Args to drop from the body/query before sending. Used to strip
   * payment_signature so it doesn't leak into the API call as a
   * regular field.
   */
  stripArgs?: string[];
}

export interface ServiceDef {
  /** Service identifier. Lowercased, used as a tool name prefix. */
  id: string;
  /** Human label for logs / errors. */
  label: string;
  /** Live HTTPS base. e.g. "https://sentinel.xrpl-utilities.io". */
  baseUrl: string;
  /** /agents.json URL — fetched at startup for schema-discipline check. */
  manifestUrl: string;
  /** Schema versions this MCP build is known to be compatible with. */
  knownSchemaVersions: string[];
  /** All tools this service exposes. */
  tools: ToolDef[];
}
