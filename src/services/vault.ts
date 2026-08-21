/**
 * XR-Vault: real-world asset tracker for the XRP Ledger.
 *
 * Single paid endpoint: POST /scan returns a per-issuer deep dive
 * (current circulating, 24h mint/burn flow, AMM-of-RWA pool exposure,
 * accruing daily history). Native unit-of-account only — no fabricated
 * USD valuation. $0.10 USD per call via x402.
 */

import type { ServiceDef } from "../types.js";

export const vault: ServiceDef = {
  id: "vault",
  label: "XR-Vault",
  baseUrl: "https://vault.xrpl-utilities.io",
  manifestUrl: "https://vault.xrpl-utilities.io/agents.json",
  knownSchemaVersions: ["1.0.0", "1.0.1", "1.0.2", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.5.1", "1.6.0", "1.7.0", "1.8.0", "1.9.0", "1.9.1", "1.10.0", "1.11.0", "1.12.0", "1.12.1", "1.13.0", "1.14.0"],
  tools: [
    {
      name: "xrpl_vault_scan",
      description:
        "Paid ($0.10 USD). " +
        "Per-issuer RWA deep dive: supply, mint/burn flow, AMM exposure, and daily " +
        "history. Accepts wallet address, issuer label, or currency code.",
      inputSchema: {
        type: "object",
        properties: {
          issuer: {
            type: "string",
            description: "r-address, label (e.g. 'Ondo OUSG'), or currency code (e.g. 'RLUSD').",
          },
          payment_signature: {
            type: "string",
            description: "x402 payment header.",
          },
        },
        required: ["issuer"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/scan",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
    },
    {
      name: "xrpl_vault_daily_flow",
      description:
        "Free. " +
        "Cross-issuer daily RWA flow series: mint/burn event counts per day and " +
        "USD-pegged net inflow aggregate. Complements the paid per-issuer scan.",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "integer",
            description: "Trailing days.",
            minimum: 1,
            maximum: 90,
            default: 30,
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/daily-flow",
      authMode: "free",
    },
  ],
};
