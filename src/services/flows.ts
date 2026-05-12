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
  knownSchemaVersions: ["1.0.0", "1.1.0"],
  tools: [
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
