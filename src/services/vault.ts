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
  knownSchemaVersions: ["1.0.0", "1.0.1", "1.0.2", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.5.1", "1.6.0", "1.7.0", "1.8.0", "1.9.0", "1.9.1", "1.10.0", "1.11.0", "1.12.0"],
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
        "TBL, Ripple RLUSD, AUDD, Circle USDCAllow, Ctrl Alt DIA-L-COL1, " +
        "Ctrl Alt DLD-25-24722-IAHG, Quantoz EURQ, plus Archax abrdn USD " +
        "Liquidity Fund as rails-only for first-mint capture. $0.10 USD per call paid via " +
        "x402 v2 (XRP/RLUSD on XRPL via t54 facilitator, or USDC on Base via " +
        "Coinbase facilitator).",
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
    {
      name: "xrpl_vault_daily_flow",
      description:
        "Free cross-issuer daily flow series built from Vault's accruing " +
        "snapshots. Returns settlement_events_daily (mint + burn event " +
        "counts per UTC day, stacked by logical_label, currency-agnostic " +
        "so BRL/EUR/AUD/MWh issuers contribute alongside USD ones) and " +
        "usd_pegged_net_flow_daily (sums net dollar inflow per UTC day " +
        "across asset classes at or near 1 USD: fiat_stable_usd, " +
        "treasuries, commercial_paper, money_market). EUR/BRL/AUD/MWh " +
        "issuers appear in per_issuer_series in native units but are " +
        "deliberately omitted from the USD aggregate. Cross-issuer view " +
        "complementing the paid per-issuer /scan deep dive. Free, public.",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "integer",
            description: "Trailing day count (1-90). Default 30.",
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
