/**
 * Single source of truth for per-tool pricing.
 *
 * Two surfaces need the same answer and must not drift:
 *   - `tools/list` `_meta.pricing`, so MCP clients can render a paid/free
 *     badge without parsing prose.
 *   - `/.well-known/x402` `resources[]`, which agent directories crawl.
 *
 * Prices are the USD peg, not a drops figure. The MCP server is a stateless
 * passthrough: it holds no wallets and takes no cut, and the underlying
 * service quotes the XRP leg at spot on every 402, so a fixed drops number
 * published here would go stale within the hour.
 */

import type { AuthMode } from "./types.js";

export interface ToolPricing {
  paid: boolean;
  priceUsd: number;
  priceUsdMax?: number;
  settlement?: string;
  note?: string;
}

/** Pulse stream subscriptions are tiered by window rather than flat-rate. */
const TIERED_TOOLS: Record<string, ToolPricing> = {
  xrpl_pulse_stream_purchase: {
    paid: true,
    priceUsd: 0.5,
    priceUsdMax: 7.5,
    settlement: "x402_inline",
    note: "tiered_1h_6h_24h",
  },
};

/**
 * Steps of the Telemetry async-invoice flow that carry no charge of their
 * own. The flow is quote -> pay -> status -> results: one $0.10 purchase made
 * at the quote step. Marking status and results as paid told clients that
 * read `_meta.pricing` that one snapshot cost $0.30.
 */
export const NON_CHARGING_FLOW_STEPS: ReadonlySet<string> = new Set([
  "xrpl_telemetry_get_status",
  "xrpl_telemetry_get_results",
]);

/**
 * Data routes: $0.01 per call for agents (XR-Pulse schema 1.116.0,
 * PULSE_DATA_GATE, and the same gate on Telemetry, Trust and Flows). Free on xrpl-utilities.com, which this server never sees.
 */
export const DATA_ROUTE_TOOLS: ReadonlySet<string> = new Set([
  "xrpl_pulse_ripple_counterparties",
  "xrpl_pulse_ripple_topology",
  "xrpl_pulse_cex_attribution",
  "xrpl_pulse_xrpl_primitives",
  "xrpl_pulse_whale_flow_24h",
  "xrpl_pulse_exchange_flow_delta",
  "xrpl_pulse_rwa_summary",
  "xrpl_pulse_exchange_net_flow",
  "xrpl_pulse_escrow_calendar",
  "xrpl_pulse_entity_positioning",
  "xrpl_pulse_rlusd_distribution",
  "xrpl_desk_briefing",
  "xrpl_pulse_token_health",
  // Telemetry 1.32.0, Trust 2026-44 and Flows 1.32.0 (<SVC>_DATA_GATE).
  "xrpl_telemetry_settlement_series",
  "xrpl_telemetry_dex_pair_volume",
  "xrpl_trust_operator_attribution",
  "xrpl_trust_usage_summary",
  "xrpl_trust_permissioned_activity",
  "xrpl_trust_recent_events",
  "xrpl_trust_jurisdictions",
  "xrpl_flows_correlation",
  "xrpl_flows_etf_flow_summary",
  "xrpl_flows_cross_border_flow",
  "xrpl_flows_launch_impact",
]);

/**
 * Bundles: one call and one payment that combine several services
 * (XR-Pulse schema 1.118.0, /bundles/*). Priced per bundle.
 */
export const BUNDLE_TOOLS: Readonly<Record<string, number>> = {
  xrpl_wallet_check: 0.25,
  xrpl_xrp_market_briefing: 0.05,
};

export function pricingFor(name: string, authMode: AuthMode): ToolPricing {
  if (authMode === "free") return { paid: false, priceUsd: 0 };
  if (DATA_ROUTE_TOOLS.has(name)) return { paid: true, priceUsd: 0.01, settlement: "x402_inline" };
  const bundle = BUNDLE_TOOLS[name];
  if (bundle !== undefined) return { paid: true, priceUsd: bundle, settlement: "x402_inline", note: "bundle" };
  if (NON_CHARGING_FLOW_STEPS.has(name)) {
    return { paid: false, priceUsd: 0, settlement: "xrpl_invoice", note: "covered_by_get_quote" };
  }
  const tiered = TIERED_TOOLS[name];
  if (tiered) return tiered;
  if (authMode === "async_invoice") {
    return { paid: true, priceUsd: 0.1, settlement: "xrpl_invoice" };
  }
  return { paid: true, priceUsd: 0.1, settlement: "x402_inline" };
}
