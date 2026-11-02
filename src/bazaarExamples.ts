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
};

/**
 * Paid tools whose backend route takes no arguments at all, so there is no
 * honest example to give. The Bazaar has not listed tools with an empty
 * example (2026-11-01), so these sell over x402 but may stay unlisted until
 * the route grows a real optional parameter.
 */
export const NO_ARGUMENT_PAID_TOOLS: ReadonlySet<string> = new Set([
  "xrpl_pulse_ripple_topology",
  "xrpl_pulse_whale_flow_24h",
  "xrpl_pulse_rwa_summary",
  "xrpl_pulse_escrow_calendar",
  "xrpl_desk_briefing",
]);

export function bazaarExample(toolName: string): Record<string, unknown> | undefined {
  const ex = BAZAAR_EXAMPLES[toolName];
  return ex ? { ...ex } : undefined;
}
