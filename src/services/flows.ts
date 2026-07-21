/**
 * XR-Flows: ETF AUM ↔ XRPL on-chain flow correlation across fifteen
 * XRP-exposure funds in three tiers -- US spot, US indirect-basket
 * (XRP-attributable slice only), and European spot.
 *
 * Four free tools (correlation, launch-impact, cross-border-flow,
 * etf-flow-summary) plus the paid per-ETF /scan deep dive, which is
 * live and serves every tracked tier, not just US spot.
 */

import type { ServiceDef } from "../types.js";

export const flows: ServiceDef = {
  id: "flows",
  label: "XR-Flows",
  baseUrl: "https://flows.xrpl-utilities.io",
  manifestUrl: "https://flows.xrpl-utilities.io/agents.json",
  knownSchemaVersions: ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0", "1.9.0", "1.10.0", "1.11.0", "1.12.0", "1.13.0", "1.14.0", "1.15.0", "1.16.0", "1.16.1", "1.17.0", "1.18.0", "1.19.0", "1.19.1", "1.20.0", "1.20.1", "1.21.0", "1.22.0", "1.23.0", "1.23.1", "1.23.2", "1.24.0", "1.25.0", "1.26.0", "1.26.1", "1.26.2", "1.27.0", "1.27.1", "1.27.2", "1.27.3", "1.28.0", "1.28.1", "1.28.2"],
  tools: [
    {
      name: "xrpl_flows_scan",
      description:
        "Paid ($0.10 USD). " +
        "Per-ETF deep dive for any tracked XRP-exposure ETF across three tiers: " +
        "US spot (XRP/XRPC/XRPZ/GXRP/TOXR/XRPR), US indirect-basket " +
        "(BITW/GDLC/EZPZ/NCIQ/TTOP/TXBC, XRP-attributable slice only), and " +
        "European spot (AXRP.SW/WXRP.DE/GXRP.DE). Returns metadata, latest AUM " +
        "reading, daily history, and on-chain exchange-flow delta.",
      inputSchema: {
        type: "object",
        properties: {
          ticker: {
            type: "string",
            description: "ETF ticker, e.g. XRP, XRPC, GXRP.",
          },
          payment_signature: {
            type: "string",
            description: "x402 payment header.",
          },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/scan",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
    },
    {
      name: "xrpl_flows_correlation",
      description:
        "Free. " +
        "Daily ETF AUM vs XRPL exchange-flow delta across the tracked XRP-exposure " +
        "funds (US spot, US indirect-basket, and European spot tiers) with " +
        "7-day rolling Pearson correlation. Correlation only, not causation.",
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
      path: "/stats/correlation",
      authMode: "free",
    },
    {
      name: "xrpl_flows_cross_border_flow",
      description:
        "Free. " +
        "XRPL cross-border settlement flow: country-pair aggregates (inbound/outbound/net USD), " +
        "top corridors, and coverage block. Institutional/exchange wallets only.",
      inputSchema: {
        type: "object",
        properties: {
          window_days: {
            type: "integer",
            description: "Trailing days.",
            minimum: 1,
            maximum: 365,
            default: 30,
          },
          top_corridors: {
            type: "integer",
            description: "Max corridors returned.",
            minimum: 1,
            maximum: 200,
            default: 20,
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/cross-border-flow",
      authMode: "free",
    },
    {
      name: "xrpl_flows_launch_impact",
      description:
        "Free. " +
        "Per-ETF launch-window analysis: [L-30, L+30] exchange-flow delta and DEX " +
        "volume around each tracked XRP-exposure ETF launch date.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/launch-impact",
      authMode: "free",
    },
    {
      name: "xrpl_flows_etf_flow_summary",
      description:
        "Free. " +
        "Daily ETF flow summary: per-ticker AUM with day-over-day delta, growth rate, " +
        "and aggregate XRP supply share.",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "integer",
            description: "Lookback window in days (default 7, max 90).",
            default: 7,
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/etf-flow-summary",
      authMode: "free",
    },
  ],
};
