/**
 * XR-Ledger: per-wallet account statements for the XRP Ledger.
 *
 * Paid POST /statement rolls one address, or a watchlist of up to 10, into
 * monthly periods: XRP in/out/net from balance deltas, fees, activity
 * categories, per-token net change and top counterparties, with plain-English
 * statement lines. $0.10 USD per call via x402, payable in RLUSD or XRP on
 * XRPL only (Ledger does not offer the Base rail).
 *
 * The free /statement/preview is not wrapped: it is IP-throttled for the
 * XR-Desk browser surface, and every caller of the hosted MCP would share the
 * one MCP egress address and its throttle.
 */

import type { ServiceDef } from "../types.js";

export const ledger: ServiceDef = {
  id: "ledger",
  label: "XR-Ledger",
  baseUrl: "https://ledger.xrpl-utilities.io",
  manifestUrl: "https://ledger.xrpl-utilities.io/agents.json",
  knownSchemaVersions: ["1.5.0"],
  tools: [
    {
      name: "xrpl_ledger_statement",
      description:
        "Paid ($0.10 USD, RLUSD or XRP on XRPL; no Base rail). " +
        "Account statement for 1-10 XRPL addresses rolled into one: monthly periods with " +
        "XRP in/out/net, fees, activity categories, per-token net change (exact decimal " +
        "strings), top counterparties and plain-English statement lines.",
      inputSchema: {
        type: "object",
        properties: {
          address: {
            type: "array",
            description: "XRPL r-addresses (1-10). Pass one address as a one-item list.",
            items: {
              type: "string",
              pattern: "^r[1-9A-HJ-NP-Za-km-z]{24,34}$",
            },
            minItems: 1,
            maxItems: 10,
          },
          since_days: {
            type: "integer",
            description: "Lookback window in days.",
            minimum: 1,
            maximum: 366,
            default: 90,
          },
          include_lines: {
            type: "boolean",
            description: "Keep every statement line; by default periods above 60 transactions are collapsed.",
            default: false,
          },
          payment_signature: {
            type: "string",
            description: "x402 payment header.",
          },
        },
        required: ["address"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/statement",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
    },
    {
      name: "xrpl_ledger_schema",
      description:
        "Free. " +
        "XR-Ledger response schema: request fields, every statement field and its meaning, " +
        "and the payment rails the paid statement accepts.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/schema",
      authMode: "free",
    },
  ],
};
