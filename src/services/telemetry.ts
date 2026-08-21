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
  knownSchemaVersions: ["1.2.0", "1.3.0", "1.4.0", "1.4.1", "1.5.0", "1.6.0", "1.7.0", "1.8.0", "1.9.0", "1.10.0", "1.11.0", "1.11.1", "1.11.2", "1.12.0", "1.13.0", "1.14.0", "1.15.0", "1.16.0", "1.17.0", "1.18.0", "1.19.0", "1.20.0", "1.21.0", "1.21.1", "1.21.2", "1.21.3", "1.21.4", "1.21.5", "1.21.6", "1.21.7", "1.21.8", "1.21.9", "1.22.0", "1.23.0", "1.24.0", "1.25.0"],
  tools: [
    {
      name: "xrpl_telemetry_snapshot",
      description:
        "Paid ($0.10 USD). " +
        "One-shot XRPL macro snapshot: supply breakdown, liquidity flows, AMM state, " +
        "derived Active Float model, and utility floor price.",
      inputSchema: {
        type: "object",
        properties: {
          payment_signature: {
            type: "string",
            description: "x402 payment header.",
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
        "Start async invoice flow: returns invoice_id, payTo address, deepLink, QR, " +
        "and expiry. Pay via XRPL Payment, then poll get_status, then call get_results.",
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
        "Paid flow step 2 (no extra charge). " +
        "Poll invoice status from get_quote. Returns paid (bool), amount, " +
        "ledger_index, and expiry.",
      inputSchema: {
        type: "object",
        properties: {
          invoice_id: {
            type: "string",
            description: "Invoice id from get_quote.",
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
        "Paid flow step 3 (no extra charge). " +
        "Fetch full Telemetry snapshot payload once invoice is paid. Same shape as " +
        "xrpl_telemetry_snapshot.",
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
        "XRPL settlement volume rollup: 24h/7d/30d USD volume across XRP and RLUSD, " +
        "annualized run rate, and payment counts.",
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
        "Bucketed XRPL settlement volume time-series (daily / weekly / monthly) " +
        "with USD totals, payment counts, XRP drops, and RLUSD value per bucket. " +
        "Newest first, UTC-aligned. For charting or change-point detection.",
      inputSchema: {
        type: "object",
        properties: {
          bucket: {
            type: "string",
            enum: ["daily", "weekly", "monthly"],
            description: "Bucket granularity.",
            default: "daily",
          },
          count: {
            type: "integer",
            description: "Number of buckets, newest first. Default 30 (daily) / 12 (weekly/monthly).",
            minimum: 1,
            maximum: 366,
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
        "Per-pair DEX volume on XRPL: 24h and 7d volume, fill counts, orderbook vs AMM " +
        "source split, and annualized run rate.",
      inputSchema: {
        type: "object",
        properties: {
          pair: {
            type: "string",
            description: "Pair filter, e.g. 'XRP/RLUSD'. Omit for all.",
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
