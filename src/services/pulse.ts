/**
 * XR-Pulse: normalized XRPL signal feed bridging public-source news,
 * on-chain whale activity, and XLS-70/80/81 permissioned-domain
 * lifecycle events into one time-ordered stream.
 *
 * News carries a four-hour XRPL price-window correlation. Whale rows
 * carry sender + receiver addresses with XRPScan institutional
 * labels. Permissioned-domain rows mirror XR-Trust's /events with
 * cross-product enrichment. Paid via x402 ($0.10 USD per query).
 */

import type { ServiceDef } from "../types.js";

export const pulse: ServiceDef = {
  id: "pulse",
  label: "XR-Pulse",
  baseUrl: "https://pulse.xrpl-utilities.io",
  manifestUrl: "https://pulse.xrpl-utilities.io/agents.json",
  knownSchemaVersions: ["1.13.0", "1.14.0", "1.15.0", "1.16.0", "1.16.1", "1.17.0", "1.18.0", "1.19.0", "1.20.0", "1.21.0", "1.21.1", "1.21.2", "1.21.3", "1.22.0", "1.22.1", "1.23.0", "1.24.0", "1.25.0", "1.25.1", "1.25.2", "1.26.0", "1.27.0", "1.28.0", "1.28.1", "1.29.0", "1.30.0", "1.31.0", "1.32.0", "1.32.1", "1.32.2", "1.32.3", "1.33.0", "1.34.0", "1.34.1", "1.34.2", "1.35.0", "1.36.0", "1.37.0", "1.38.0", "1.39.0", "1.39.1", "1.39.2", "1.39.3", "1.40.0", "1.40.1", "1.41.0", "1.41.1", "1.42.0", "1.43.0", "1.44.0", "1.45.0", "1.46.0", "1.46.1", "1.46.2", "1.47.0", "1.48.0", "1.49.0", "1.50.0", "1.51.0", "1.52.0", "1.53.0", "1.54.0", "1.55.0", "1.56.0", "1.57.0", "1.57.1", "1.58.0", "1.58.1", "1.59.0", "1.60.0", "1.61.0", "1.62.0", "1.63.0", "1.64.0", "1.64.1", "1.65.0", "1.66.0", "1.66.1", "1.67.0", "1.68.0", "1.69.0", "1.70.0", "1.70.1", "1.71.0", "1.72.0", "1.73.0", "1.74.0", "1.75.0", "1.76.0", "1.77.0", "1.78.0", "1.79.0", "1.80.0"],
  tools: [
    {
      name: "xrpl_pulse_recent_events",
      description:
        "Paid ($0.10 USD). " +
        "Most-recent XRPL signal events newest-first. Mixes news, whale activity, " +
        "permissioned-domain lifecycle, Sentinel signals, and RWA issuer flows. " +
        "Filterable by kind, time range, and min whale USD.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            default: 50,
          },
          since_iso: {
            type: "string",
            description: "ISO 8601 lower bound on published_at.",
          },
          before_iso: {
            type: "string",
            description: "ISO 8601 upper bound for backward pagination.",
          },
          kind: {
            type: "string",
            enum: ["news", "activity"],
            description: "Filter by source bucket. Omit for mixed feed.",
          },
          min_whale_usd: {
            type: "number",
            description: "USD floor for whale events. Default $1M.",
            minimum: 0,
          },
          payment_signature: {
            type: "string",
            description: "x402 payment header.",
          },
        },
        additionalProperties: false,
      },
      method: "POST",
      path: "/events/recent",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
    },
    {
      name: "xrpl_pulse_events_by_address",
      description:
        "Paid ($0.10 USD). " +
        "Pulse events referencing a specific XRPL address (whale, sentinel signal, " +
        "news, permissioned-domain). Complements xrpl_sentinel_scan with event history.",
      inputSchema: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "XRPL r-address.",
            pattern: "^r[1-9A-HJ-NP-Za-km-z]{24,34}$",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 200,
            default: 50,
          },
          since_iso: {
            type: "string",
            description: "ISO 8601 lower bound on published_at.",
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
      path: "/events/by-address",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
    },
    {
      name: "xrpl_pulse_stream_purchase",
      description:
        "Paid (tiered: 1h ~$0.50 / 6h ~$2.50 / 24h ~$7.50). " +
        "Buy a time-boxed WebSocket subscription to live Pulse events. Returns " +
        "a stream_token JWT and ws_url. Server-side filtering by source, signal, " +
        "and min USD is bound into the token at purchase.",
      inputSchema: {
        type: "object",
        properties: {
          duration: {
            type: "string",
            enum: ["1h", "6h", "24h"],
            default: "1h",
          },
          min_usd: {
            type: "number",
            description: "USD floor for whale events. Bound into JWT.",
            minimum: 0,
          },
          sources: {
            type: "array",
            items: { type: "string" },
            description: "Source allowlist. Omit for all sources.",
            maxItems: 32,
          },
          signals: {
            type: "array",
            items: { type: "string" },
            description: "Signal allowlist. Omit for all signals.",
            maxItems: 32,
          },
          payment_signature: {
            type: "string",
            description: "x402 payment header.",
          },
        },
        additionalProperties: false,
      },
      method: "POST",
      path: "/stream/purchase",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
    },
    {
      name: "xrpl_pulse_ripple_counterparties",
      description:
        "Free. " +
        "Anonymized Ripple-counterparty auto-discovery and relay-burst detector findings. " +
        "Score-tier and funding-source distributions; specific wallet addresses not exposed.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 200,
            default: 50,
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/ripple-counterparties",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_ripple_topology",
      description:
        "Free. " +
        "Ripple ecosystem topology map: Source (treasury/issuer/escrow wallets), " +
        "Pipeline (curated middle layer by role), and Exits (named CEX hot wallets).",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/ripple-topology",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_cex_attribution",
      description:
        "Free. " +
        "CEX attribution walker findings: backward-walked payment chains ending at " +
        "named exchanges. Hop count, total USD, anchor and terminal labels; " +
        "specific addresses not exposed.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 200,
            default: 50,
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/cex-attribution",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_network_stats",
      description:
        "Free. " +
        "XRPL network summary: funded addresses, trustline count, offer count, " +
        "24h active addresses, and snapshot freshness.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/network",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_whale_flow_24h",
      description:
        "Free. " +
        "Trailing 24h whale Payment aggregate: total USD, tx count, top labels, " +
        "per-currency breakdown. No specific addresses returned.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/whale-flow-24h",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_exchange_flow_delta",
      description:
        "Free. " +
        "Per-UTC-day series of net XRPL exchange flow: inbound, outbound, net, " +
        "and settlement volume. Same series used in XR-Flows ETF correlation.",
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
      path: "/stats/exchange-flow-delta",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_rwa_summary",
      description:
        "Free. " +
        "Cross-issuer RWA rollup: obligations, net-circulating supply, trustline count, " +
        "24h mint/burn flow, and AMM pool exposure per tracked issuer.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/rwa-summary",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_exchange_net_flow",
      description:
        "Free. " +
        "Per-exchange directional net flow from labeled whale events. " +
        "Inflow/outflow/net per named exchange with trend and market positioning flag.",
      inputSchema: {
        type: "object",
        properties: {
          hours: {
            type: "integer",
            description: "Lookback window in hours (default 24, max 336 = 14 days).",
            default: 24,
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/exchange-net-flow",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_escrow_calendar",
      description:
        "Free. " +
        "Forward-looking Ripple XRP escrow release calendar with monthly unlock " +
        "schedule, relock history, and net release rate.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/escrow-calendar",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_entity_positioning",
      description:
        "Free. " +
        "Per-entity (exchange, treasury, MM) accumulation vs distribution scoring " +
        "from labeled whale events with daily breakdown.",
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
      path: "/stats/entity-positioning",
      authMode: "free",
    },
    {
      name: "xrpl_desk_briefing",
      description:
        "Free. " +
        "Composite desk briefing: market posture, headline narrative, positioning " +
        "(top accumulator/distributor + reversals), RLUSD health (velocity + growth + peg), " +
        "supply pressure (escrow + relock), RWA market, whale activity, and alerts. " +
        "One call replaces 6-8 separate tool calls.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/desk-briefing",
      authMode: "free",
    },
  ],
};
