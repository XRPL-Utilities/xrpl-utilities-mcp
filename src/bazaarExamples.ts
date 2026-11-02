/**
 * Example arguments for every paid (inline_x402) MCP tool, sent as
 * `extensions.bazaar.info.input.example` in the payment challenge.
 *
 * Coinbase's Bazaar indexes an MCP tool by calling it with this example as
 * `arguments` and expecting an x402 payment challenge back. Without an
 * example the tool cannot be indexed (docs.cdp.coinbase.com/x402/seller/
 * get-discovered, checked 2026-11-01). Each value here must validate against
 * the tool's own inputSchema and must reach the backend's 402, not a 400:
 * tests/bazaarExamples.test.mjs enforces both the schema match and full
 * coverage of the paid tools.
 *
 * The values are real, public mainnet identifiers so a paid call with them
 * returns useful data. The same examples are written into each backend's
 * mcp_bazaar_tools.json by scripts/gen_bazaar_manifests.mjs.
 */
export const BAZAAR_EXAMPLES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  xrpl_sentinel_scan: { address: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" },
  xrpl_sentinel_scan_history: { address: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" },
  xrpl_pulse_recent_events: { limit: 10 },
  xrpl_pulse_events_by_address: { address: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", limit: 10 },
  xrpl_pulse_stream_purchase: { duration: "1h" },
  xrpl_telemetry_snapshot: { sections: ["supply", "utility_floor"] },
  xrpl_trust_list_domains: { limit: 10 },
  xrpl_trust_get_domain: {
    domain_id: "D94C864FE55B649E33907370D68D4F4776387BBB62814AEE646672F1265B177A",
  },
  xrpl_trust_credential_issuers: { limit: 10 },
  xrpl_trust_operator_drilldown: { owner_address: "rHgk8sXaXEG4kFDXJgCoKk2WaWPBYXvhWr" },
  xrpl_vault_scan: { issuer: "RLUSD" },
  xrpl_flows_scan: { ticker: "XRPC" },
  xrpl_ledger_statement: { address: ["rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De"], since_days: 30 },
  xrpl_pulse_ripple_counterparties: { limit: 50 },
  xrpl_pulse_cex_attribution: { limit: 50 },
  xrpl_pulse_xrpl_primitives: { window_days: 30 },
  xrpl_pulse_exchange_flow_delta: { days: 30 },
  xrpl_pulse_exchange_net_flow: { hours: 24 },
  xrpl_pulse_entity_positioning: { days: 7 },
  xrpl_pulse_rlusd_distribution: { days: 7 },
  xrpl_pulse_token_health: { code: "RLUSD", limit: 10 },
  xrpl_pulse_ripple_topology: { layer: "exits" },
  xrpl_pulse_whale_flow_24h: { include_hourly: false },
  xrpl_pulse_rwa_summary: { asset_class: "treasuries" },
  xrpl_pulse_escrow_calendar: { months: 6 },
  xrpl_desk_briefing: { sections: "positioning,rwa_market" },
  xrpl_wallet_check: { address: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" },
  xrpl_xrp_market_briefing: { sections: "briefing,whales,liquidity" },
  xrpl_rwa_token_report: { issuer: "rHuiXXjHLpMP8ZE9sSQU5aADQVWDwv6h5p" },
  xrpl_fund_flow_report: { days: 7 },
  xrpl_permissioned_venue_report: { operator: "rHgk8sXaXEG4kFDXJgCoKk2WaWPBYXvhWr" },
  xrpl_network_snapshot: { sections: "network,ledger_objects,settlement" },
  xrpl_pulse_whale_census: { history_days: 30 },
  xrpl_pulse_whale_flow_history: { days: 30 },
  xrpl_pulse_rwa_supply_history: { days: 30 },
  xrpl_pulse_xls85_totals: { include_issuers: true },
  xrpl_pulse_ripple_counterparty_graph: { limit: 50 },
  xrpl_pulse_recent_choreographies: { window_hours: 24, limit: 10 },
  xrpl_pulse_top_destinations: { min_distinct_sources: 2, limit: 30 },
  xrpl_pulse_moex_xrp_index: { history_days: 30 },
  xrpl_telemetry_liquidity: { include_slippage: true },
  xrpl_telemetry_exchange_flow_history: { days: 14 },
  xrpl_flows_etf_candidates: { status: "unverified" },
  xrpl_vault_daily_flow_history: { days: 30 },
  xrpl_telemetry_settlement_series: { bucket: "daily", count: 30 },
  xrpl_telemetry_dex_pair_volume: { pair: "XRP/RLUSD" },
  xrpl_trust_operator_attribution: { operator_address: "rHgk8sXaXEG4kFDXJgCoKk2WaWPBYXvhWr" },
  xrpl_trust_usage_summary: { window_days: 30 },
  xrpl_trust_permissioned_activity: { limit: 50 },
  xrpl_trust_recent_events: { limit: 100 },
  xrpl_trust_jurisdictions: { addresses_limit: 50 },
  xrpl_flows_correlation: { days: 30 },
  xrpl_flows_etf_flow_summary: { days: 7 },
  xrpl_flows_cross_border_flow: { window_days: 30, top_corridors: 20 },
  xrpl_flows_launch_impact: { window_days: 7 },
};

/**
 * Paid tools whose backend route takes no arguments at all, so there is no
 * honest example to give. The Bazaar does not list a tool with an empty
 * example. Empty since 2026-11-02, when the last five Pulse routes gained a
 * real optional argument; keep it that way.
 */
export const NO_ARGUMENT_PAID_TOOLS: ReadonlySet<string> = new Set([]);

export function bazaarExample(toolName: string): Record<string, unknown> | undefined {
  const ex = BAZAAR_EXAMPLES[toolName];
  return ex ? { ...ex } : undefined;
}
