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
 * A single tool definition. The MCP server exposes one MCP tool per
 * entry. Auth/payment is handled per-call by the dispatcher based on
 * the `paid` flag and the caller-supplied `payment_signature` arg.
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
  /**
   * Whether this endpoint requires x402 payment. When true, the caller
   * must supply `payment_signature` in the tool args (forwarded as the
   * PAYMENT-SIGNATURE header) OR the operator must have set MCP_BYPASS_KEY
   * (forwarded as the dev-bypass header on the underlying service).
   */
  paid: boolean;
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
