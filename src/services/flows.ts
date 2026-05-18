/**
 * XR-Flows: ETF AUM ↔ XRPL on-chain flow correlation for US-listed
 * spot XRP ETFs.
 *
 * v1.0.0 preview ships two free MCP tools (correlation + launch-impact)
 * and stubbed per-issuer scrapers. The paid /scan deep dive returns
 * 503 in v1.0.0 and is intentionally not registered here; it lands
 * in v1.1+ once at least four issuer scrapers return real readings.
 */

import type { ServiceDef } from "../types.js";

export const flows: ServiceDef = {
  id: "flows",
  label: "XR-Flows",
  baseUrl: "https://flows.xrpl-utilities.io",
  manifestUrl: "https://flows.xrpl-utilities.io/agents.json",
  knownSchemaVersions: ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0", "1.9.0", "1.10.0", "1.11.0", "1.12.0", "1.13.0", "1.14.0", "1.15.0", "1.16.0", "1.16.1", "1.17.0", "1.18.0", "1.19.0", "1.19.1", "1.20.0", "1.20.1", "1.21.0", "1.22.0"],
  tools: [
    {
      name: "xrpl_flows_scan",
      description:
        "Per-ETF deep dive for any of the six US-listed spot XRP ETFs " +
        "(Bitwise XRP, Canary XRPC, Franklin Templeton XRPZ, Grayscale " +
        "GXRP, 21Shares TOXR, REX-Osprey XRPR). Returns the ticker's " +
        "registry metadata (launch date, expense ratio, source URL, " +
        "asset class, any operator caveat), latest reading (current " +
        "AUM, xrp_held when available, NAV, source lineage), full " +
        "accruing daily history with per-day AUM and source labels, " +
        "and the latest XRPL exchange-flow delta row from XR-Pulse " +
        "as the on-chain side of the correlation. An inline re-scrape " +
        "fires before the response is built so the latest_reading is " +
        "current-as-of-call, not as-of-last-hourly-loop. $0.10 USD " +
        "per call paid via x402 v2 (XRPL `exact` scheme, t54 " +
        "facilitator; XRP and RLUSD both accepted).",
      inputSchema: {
        type: "object",
        properties: {
          ticker: {
            type: "string",
            description:
              "ETF ticker (case-insensitive). One of XRP, XRPC, XRPZ, " +
              "GXRP, TOXR, XRPR. Returns 404 when the ticker is not " +
              "in the operator-curated registry.",
          },
          payment_signature: {
            type: "string",
            description: "x402 v2 PAYMENT-SIGNATURE header.",
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
        "Daily ETF AUM and XRPL exchange-flow delta for the six US-listed " +
        "spot XRP ETFs (Bitwise XRP, Canary XRPC, Franklin XRPZ, Grayscale " +
        "GXRP, 21Shares TOXR, REX-Osprey XRPR). Returns per-ticker daily " +
        "AUM with day-over-day delta, a chain_flow_daily series from " +
        "XR-Pulse, and a 7-day rolling Pearson coefficient measuring how " +
        "tightly ETF flow aligns with on-chain flow. CORRELATION ONLY, " +
        "NEVER CAUSATION: ETFs hold XRP via pooled institutional custody " +
        "so on-chain wallets cannot be attributed to a specific fund. " +
        "v1.0.0: per-issuer scrapers are stubbed; AUM fields return null " +
        "until v1.x lands real readings.",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "integer",
            minimum: 1,
            maximum: 90,
            default: 30,
            description: "Days of history to return (1-90, default 30).",
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
        "XRPL institutional cross-border settlement edges: country-pair " +
        "flow aggregates over a configurable window. A Payment counts " +
        "as a cross-border edge only when BOTH sender and receiver " +
        "XRPScan labels resolve to operator-curated jurisdictions AND " +
        "those countries differ. Returns per-country inbound/outbound/net " +
        "USD plus top corridors plus an honest coverage block. Labeled " +
        "wallets only - the institutional/exchange/issuer layer, not " +
        "retail. Free; aggregates of public on-chain data.",
      inputSchema: {
        type: "object",
        properties: {
          window_days: {
            type: "integer",
            minimum: 1,
            maximum: 365,
            default: 30,
            description: "Trailing window in UTC days.",
          },
          top_corridors: {
            type: "integer",
            minimum: 1,
            maximum: 200,
            default: 20,
            description: "Cap on the top_corridors[] list.",
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
        "Per-ETF launch-window analysis: for each tracked spot XRP ETF, " +
        "returns its launch date and a [L-30, L+30] window summary of " +
        "XRPL exchange-flow delta + DEX volume. The post-window vs " +
        "pre-window ratio is the headline 'launch impact' figure. Static " +
        "analysis; recomputed on demand rather than polled. v1.0.0 " +
        "returns the launch metadata only; the on-chain delta window " +
        "analysis lands once Pulse /stats/exchange-flow-delta is shipped " +
        "and a recompute pass runs.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/launch-impact",
      authMode: "free",
    },
  ],
};
