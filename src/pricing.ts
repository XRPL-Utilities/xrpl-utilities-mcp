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

export function pricingFor(name: string, authMode: AuthMode): ToolPricing {
  if (authMode === "free") return { paid: false, priceUsd: 0 };
  const tiered = TIERED_TOOLS[name];
  if (tiered) return tiered;
  if (authMode === "async_invoice") {
    return { paid: true, priceUsd: 0.1, settlement: "xrpl_invoice" };
  }
  return { paid: true, priceUsd: 0.1, settlement: "x402_inline" };
}
