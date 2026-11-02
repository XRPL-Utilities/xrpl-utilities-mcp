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
  knownSchemaVersions: ["1.0.0", "1.0.1", "1.0.2", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.5.1", "1.6.0", "1.7.0", "1.8.0", "1.9.0", "1.9.1", "1.10.0", "1.11.0", "1.12.0", "1.12.1", "1.13.0", "1.14.0", "1.15.0", "1.15.1", "1.16.0", "1.17.0", "1.18.0", "1.19.0"],
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
        "Free sample. " +
        "Cross-issuer daily RWA flow for the last 7 days at most: mint/burn event " +
        "counts per day and the dollar-pegged net inflow. For up to 90 days with " +
        "issuer wallets and candidates use xrpl_vault_daily_flow_history.",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "integer",
            description: "Trailing days (max 7).",
            minimum: 1,
            maximum: 7,
            default: 7,
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/daily-flow",
      authMode: "free",
    },
    {
      name: "xrpl_vault_daily_flow_history",
      description:
        "Paid ($0.01 USD). " +
        "Cross-issuer daily RWA flow for up to 90 days: mint/burn event counts per " +
        "day, dollar-pegged net inflow, per-issuer series in native units, each " +
        "tracked issuer's wallets and the auto-discovered issuer candidates.",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "integer",
            description: "Trailing days (default 30, max 90).",
            minimum: 1,
            maximum: 90,
          },
          payment_signature: {
            type: "string",
            description: "x402 payment header.",
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/daily-flow-history",
      authMode: "inline_x402",
    },
  ],
};
