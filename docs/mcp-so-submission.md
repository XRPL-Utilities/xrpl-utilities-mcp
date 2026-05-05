# mcp.so submission text

Copy-paste-ready content for the [mcp.so](https://mcp.so/submit) web form
or PR. Also works for the Anthropic MCP servers list and the
[awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)
community list.

---

## Name

```
xrpl-utilities
```

## Display name

```
XRPL-Utilities (Sentinel · Pulse · Telemetry · Trust)
```

## Short description (≤ 160 chars, used for cards / search results)

```
Agent-payable XRPL data: wallet activity classifier, normalized signal feed, supply + utility floor, permissioned-domain directory. x402 + RLUSD/XRP.
```

## Long description (1–3 paragraphs, used on the detail page)

```
MCP server for the XRPL-Utilities portfolio. 11 tools across four services:

  • XR-Sentinel — classify any XRPL wallet by its on-chain activity pattern.
    Returns a 0–100 activity_score, a Low/Medium/High/Dormant level,
    behavioral signals from a 22-entry catalog, top counterparties with
    XRPScan labels, and an AI-generated reasoning narrative.

  • XR-Pulse — normalized signal feed mixing public-source news (regulatory
    press + central banks + crypto media filtered for XRP/RLUSD/XRPL),
    on-chain whale activity, and XLS-70/80/81 permissioned-domain
    lifecycle events. Each row carries 4-hour XRPL price correlation,
    institutional watchlist labels, and Sentinel cross-references.

  • XR-Telemetry — XRPL macro snapshot. Total/circulating/escrowed/dormant
    supply, AMM-locked, exchange omnibus, DEX orderbook depth, and a
    derived Active Float model with the full additive mathematical bridge.
    Two payment flows: inline x402 OR async invoice (deeplink + QR).

  • XR-Trust — directory + drill-down for the XRPL permissioned-asset
    stack. PermissionedDomain (XLS-80) enumeration, credential issuer
    aggregation, XLS-81 permissioned-DEX trade economics, and XLS-40 DID
    identity bridge with .well-known/xrp-ledger.toml resolution.

Stateless passthrough proxy — every paid call uses the caller's own
x402 v2 payment header (XRP or RLUSD), settled on XRPL mainnet via the
t54 facilitator. $0.10 USD per query. The MCP server holds no wallets
and takes no cut.
```

## Repository URL

```
https://github.com/XRPL-Utilities/xrpl-utilities-mcp
```

## Homepage URL

```
https://xrpl-utilities.com
```

## Hosted endpoint URL (for clients that connect over HTTP/SSE)

```
https://mcp.xrpl-utilities.io/mcp
```

## Author

```
XRPL-Utilities™
```

## License

```
MIT
```

## Tags / categories

```
xrpl, ripple, xrp, rlusd, x402, payments, on-chain, blockchain, ai-agents, finance
```

## Installation — Claude Desktop config

```json
{
  "mcpServers": {
    "xrpl-utilities": {
      "command": "npx",
      "args": ["-y", "@xrpl-utilities/mcp", "--transport", "stdio"]
    }
  }
}
```

## Installation — remote (any MCP client)

```
URL: https://mcp.xrpl-utilities.io/mcp
Transport: streamable-http (with SSE)
Auth: caller provides x402 PAYMENT-SIGNATURE header in tool args
```

## Tool list (11)

```
xrpl_sentinel_scan              — classify wallet (paid, $0.10)
xrpl_sentinel_scan_history      — prior recorded scans (paid, $0.10)
xrpl_pulse_recent_events        — normalized signal feed (paid, $0.10)
xrpl_telemetry_snapshot         — one-shot macro snapshot (paid, $0.10)
xrpl_telemetry_get_quote        — start async invoice flow
xrpl_telemetry_get_status       — poll an invoice
xrpl_telemetry_get_results      — fetch snapshot once paid
xrpl_trust_list_domains         — enumerate PermissionedDomains (paid, $0.10)
xrpl_trust_get_domain           — drill-down on a domain (paid, $0.10)
xrpl_trust_credential_issuers   — issuer aggregation (paid, $0.10)
xrpl_trust_recent_events        — XLS-70/80/81 lifecycle stream (paid, $0.10)
```

## Why an agent should care

```
This is one of the first MCP servers where every paid tool call
generates real per-call revenue settled on a public blockchain — no
API keys, no subscription, no rate-limit-then-upsell. An LLM with a
funded XRPL wallet can scan a wallet, fetch a signal feed, or pull a
macro snapshot for $0.10 USD with a one-call x402 flow. The hosted
endpoint at mcp.xrpl-utilities.io is a stateless passthrough; the
underlying services run on the operator's infrastructure and pay
revenue to a single XRPL treasury wallet via the t54 facilitator.
```

## Tagline (for the directory listing card)

```
Pay-per-call XRPL data for AI agents — wallet classifier, signal feed, macro snapshot, permissioned-domain directory. x402-native.
```
