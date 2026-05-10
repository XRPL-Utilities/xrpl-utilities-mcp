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
  knownSchemaVersions: ["1.0.0"],
  tools: [
    {
      name: "xrpl_vault_scan",
      description:
        "Per-issuer real-world-asset deep dive on the XRP Ledger. Accepts " +
        "{issuer: <wallet OR logical_label OR currency>} and returns the " +
        "issuer's metadata, current obligations + net-circulating supply " +
        "(treasury-adjusted where applicable), trustline count, last-24h " +
        "mint and burn flow, AMM-of-RWA pool exposure (every XLS-30 pool " +
        "containing this issuer's IOU with native-unit balances + LP " +
        "supply), and a daily history series that accrues over time. " +
        "Tracked issuer set covers Ondo OUSG (permissioned + public), " +
        "Schuman EUROP, Braza USDB, Braza BBRL, SG-FORGE EURCV, Guggenheim " +
        "DCP (Zeconomy SPV), Justoken JMWH (in MWh, not USD), OpenEden " +
        "TBL, Ripple RLUSD, AUDD, plus Archax abrdn USD Liquidity Fund as " +
        "rails-only for first-mint capture. $0.10 USD per call paid via " +
        "x402 v2 (XRP or RLUSD via t54 facilitator).",
      inputSchema: {
        type: "object",
        properties: {
          issuer: {
            type: "string",
            description:
              "Wallet (r-prefix XRPL classic address; exact match) OR " +
              "logical_label (e.g. 'Ondo OUSG', 'Justoken JMWH'; " +
              "case-insensitive) OR currency code (e.g. 'OUSG', 'TBL', " +
              "'RLUSD'; case-insensitive). Resolution priority: wallet > " +
              "logical_label > currency. Returns 404 when no tracked " +
              "issuer matches.",
          },
          payment_signature: {
            type: "string",
            description: "x402 v2 PAYMENT-SIGNATURE header.",
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
  ],
};
