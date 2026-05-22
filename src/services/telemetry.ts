/**
 * XR-Telemetry: XRPL macro snapshot — supply, liquidity, AMM, derived
 * Active Float (3-second settlement supply), and the Burst Math
 * utility floor.
 *
 * Two payment flows are exposed:
 *
 *  1. The async invoice flow (quote → pay → status → results), which
 *     mirrors how a human user buys a snapshot. Useful for agents
 *     that hold a wallet and can do the polling themselves.
 *
 *  2. The one-shot /scan endpoint, which uses the standard x402
 *     verify-then-work-then-settle pattern (caller provides
 *     PAYMENT-SIGNATURE in the request, server verifies, runs the
 *     snapshot, settles, returns).
 *
 * MCP exposes both — agents pick the path that matches their wallet
 * abstraction. $0.10 USD per call.
 */

import type { ServiceDef } from "../types.js";

export const telemetry: ServiceDef = {
  id: "telemetry",
  label: "XR-Telemetry",
  baseUrl: "https://telemetry.xrpl-utilities.io",
  manifestUrl: "https://telemetry.xrpl-utilities.io/agents.json",
  knownSchemaVersions: ["1.2.0", "1.3.0", "1.4.0", "1.4.1", "1.5.0", "1.6.0", "1.7.0", "1.8.0", "1.9.0", "1.10.0", "1.11.0", "1.11.1", "1.11.2", "1.12.0", "1.13.0", "1.14.0", "1.15.0", "1.16.0", "1.17.0", "1.18.0", "1.19.0"],
  tools: [
    {
      name: "xrpl_telemetry_snapshot",
      description:
        "Paid ($0.10 USD). " +
        "One-shot XRPL macro snapshot. Returns supply (total / circulating " +
        "/ escrowed / dormant / AMM-locked / exchange omnibus / DEX " +
        "orderbook depth), liquidity (per-region 24h flows), amm (top " +
        "pairs + vaults), derived_models.active_float (modeled supply " +
        "available for 3-second settlement, with the full additive " +
        "mathematical_bridge), and utility_floor (baseline equilibrium " +
        "price + premium ratio). Standard x402 verify-then-work-then-" +
        "settle. $0.10 USD per call. Pass payment_signature.",
      inputSchema: {
        type: "object",
        properties: {
          payment_signature: {
            type: "string",
            description: "x402 v2 PAYMENT-SIGNATURE header.",
          },
        },
        additionalProperties: false,
      },
      method: "POST",
      path: "/scan",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
    },
    {
      name: "xrpl_telemetry_get_quote",
      description:
        "Paid flow step 1 ($0.10 USD total). " +
        "Start the async invoice flow: returns invoice_id, amount in " +
        "drops, payTo address, deepLink + QR, and expiry. The caller " +
        "pays the XRPL Payment to that address from any wallet, then " +
        "polls xrpl_telemetry_get_status until paid: true, then calls " +
        "xrpl_telemetry_get_results. The MCP wrapper itself doesn't " +
        "require a payment_signature header, but the snapshot still " +
        "costs $0.10 USD - the payment just happens out-of-band as a " +
        "regular XRPL Payment instead of an inline x402 header.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "POST",
      path: "/quote",
      authMode: "async_invoice",
      bodyFromArgs: true,
    },
    {
      name: "xrpl_telemetry_get_status",
      description:
        "Paid flow step 2 (no extra charge, polls invoice from step 1). " +
        "Poll the status of an invoice from xrpl_telemetry_get_quote. " +
        "Returns paid (bool), amount, ledger_index when settled, and " +
        "expiry. The MCP wrapper itself doesn't require a payment header " +
        "(the operator's check is just reading the validated XRPL ledger " +
        "for the deposit transaction).",
      inputSchema: {
        type: "object",
        properties: {
          invoice_id: {
            type: "string",
            description: "Invoice id from the /quote response.",
          },
        },
        required: ["invoice_id"],
        additionalProperties: false,
      },
      method: "GET",
      path: "/status/{invoice_id}",
      authMode: "async_invoice",
    },
    {
      name: "xrpl_telemetry_get_results",
      description:
        "Paid flow step 3 (no extra charge, returns results from settled invoice). " +
        "Fetch the full TelemetryPayload for an invoice once paid. Same " +
        "shape as xrpl_telemetry_snapshot. The MCP wrapper doesn't need " +
        "a payment header here because the $0.10 already settled when " +
        "the caller paid the deeplink in step 2 of the flow.",
      inputSchema: {
        type: "object",
        properties: {
          invoice_id: {
            type: "string",
            description: "Paid invoice id.",
          },
        },
        required: ["invoice_id"],
        additionalProperties: false,
      },
      method: "GET",
      path: "/results/{invoice_id}",
      authMode: "async_invoice",
    },
    {
      name: "xrpl_telemetry_settlement_totals",
      description:
        "Free. " +
        "Aggregate XRPL settlement volume rollup: USD-denominated " +
        "Payment volume across XRP and RLUSD legs over 24h / 7d / 30d, " +
        "annualized run rate, payment counts, coverage block describing " +
        "the first and latest hour bucket recorded by the settlement " +
        "walker. Walker is a continuous async loop (not a slow-task); " +
        "see /healthz checks.settlement_walker for freshness. Bootstrapping " +
        "flag surfaces in the settlement block during the first 7d / 30d " +
        "post-deploy. Free, public.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/settlement/totals",
      authMode: "free",
    },
    {
      name: "xrpl_telemetry_settlement_series",
      description:
        "Free. " +
        "Time-series of XRPL settlement volume: per-hour USD volume " +
        "stacked by currency leg (XRP at ledger-close spot, RLUSD at " +
        "$1.00) plus payment count. Complements the rollup endpoint; use " +
        "this for charting or change-point detection. Free, public.",
      inputSchema: {
        type: "object",
        properties: {
          hours: {
            type: "integer",
            description: "Trailing hour count (1-720). Default 168 (7 days).",
            minimum: 1,
            maximum: 720,
            default: 168,
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/settlement/series",
      authMode: "free",
    },
    {
      name: "xrpl_telemetry_dex_pair_volume",
      description:
        "Free. " +
        "Per-pair DEX volume rollup on XRPL: 24h, 7d, fill counts, " +
        "volume by source (orderbook OfferCreate vs AMM), annualized run " +
        "rate. Curated pair set: XRP/RLUSD plus secondary pools. Reads " +
        "partial during the first week post-deploy; bootstrapping flag " +
        "surfaces this. Free, public.",
      inputSchema: {
        type: "object",
        properties: {
          pair: {
            type: "string",
            description: "Optional pair filter (e.g. 'XRP/RLUSD'). Omit for all tracked pairs.",
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/dex-pair-volume",
      authMode: "free",
    },
  ],
};
