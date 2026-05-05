# XRPL-Utilities MCP Server

Pay-per-call XRPL data for AI agents. One MCP server, eleven tools, four
backend services. Every paid call settles on XRPL mainnet via x402 v2 -
no API keys, no subscriptions, no rate-limit-then-upsell.

## What it covers

**XR-Sentinel** classifies any XRPL wallet by its on-chain activity
pattern. You get a 0-100 activity_score, an activity_level
(Low / Medium / High / Dormant / Unknown), a confidence tier, behavioral
signals from a 22-entry catalog, the top 20 counterparties with XRPScan
labels, and an AI-generated reasoning narrative. When the address has
been scanned before, the response also carries a `_delta` block so
agents can read trajectory without scanning N times.

**XR-Pulse** is a normalized signal feed. Three sources mixed into one
time-ordered stream: public-source news (regulatory press, central
banks, crypto media filtered for XRP / RLUSD / XRPL / Ripple),
on-chain whale activity (every Payment above the storage threshold with
sender + receiver + XRPScan labels), and XLS-70/80/81 permissioned-domain
lifecycle events sourced from XR-Trust. News rows carry a 4-hour
XRPL price-window correlation. Whale rows carry institutional watchlist
labels and Sentinel cross-references.

**XR-Telemetry** is a macro snapshot of XRPL supply and liquidity. Total
/ circulating / escrowed / dormant XRP, AMM-locked, exchange omnibus
(with venue + address counts), DEX orderbook depth, and a derived
Active Float model that estimates the supply available for
3-second settlement. The full additive `mathematical_bridge` ships
with every snapshot so you can audit each component.

**XR-Trust** is a directory + drill-down for the XRPL permissioned-asset
stack. PermissionedDomain (XLS-80) enumeration, credential issuer
aggregation, XLS-81 permissioned-DEX trade economics, and an XLS-40
DID identity bridge that resolves `.well-known/xrp-ledger.toml` when
domain owners publish one.

## Tools (11)

| Tool | What it does | Auth |
|---|---|---|
| `xrpl_sentinel_scan` | Classify a wallet | inline x402 ($0.10) |
| `xrpl_sentinel_scan_history` | Prior recorded scans for trajectory | inline x402 ($0.10) |
| `xrpl_pulse_recent_events` | Normalized signal feed | inline x402 ($0.10) |
| `xrpl_telemetry_snapshot` | One-shot macro snapshot | inline x402 ($0.10) |
| `xrpl_telemetry_get_quote` | Start the async invoice flow | wrapper free; $0.10 paid via deeplink |
| `xrpl_telemetry_get_status` | Poll an invoice | wrapper free |
| `xrpl_telemetry_get_results` | Fetch snapshot once paid | wrapper free |
| `xrpl_trust_list_domains` | All PermissionedDomain objects | inline x402 ($0.10) |
| `xrpl_trust_get_domain` | Drill-down by domain_id | inline x402 ($0.10) |
| `xrpl_trust_credential_issuers` | Issuer aggregation | inline x402 ($0.10) |
| `xrpl_trust_recent_events` | XLS-70/80/81 lifecycle stream | inline x402 ($0.10) |

Tool names are globally namespaced (`xrpl_<service>_<verb>`) so they
never collide with other MCP servers a user has connected.

## Install (Claude Desktop)

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

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the equivalent on your platform, then restart Claude Desktop.
The 11 tools should appear with the `xrpl_` prefix.

## Connect remotely (any MCP client)

```
URL:       https://mcp.xrpl-utilities.io/mcp
Transport: streamable-http (with SSE)
```

Same tools, same auth model, no install needed.

## How payment works

Every paid tool requires the caller to provide a `payment_signature`
argument: a base64-JSON-encoded x402 v2 payment header signing an
XRPL Payment that matches one of the requirements returned by an
unauthenticated probe. The MCP server forwards it as the
`PAYMENT-SIGNATURE` header on the underlying call. $0.10 USD lands on
the operator wallet per successful call, settled inline via the
[t54](https://t54.ai) facilitator.

Both XRP (dynamic, ~71,428 drops at $1.40 spot) and RLUSD (flat 0.10)
are accepted. Pick the asset that matches your wallet's holdings.

If you call a paid tool without `payment_signature`, the server
returns the actual 402 challenge wrapped in the MCP response so the
LLM can sign and retry on the next turn. No work runs and no money
moves until a valid signature is supplied.

The Telemetry async invoice tools (`get_quote`, `get_status`,
`get_results`) are an alternative payment path for clients that don't
sign x402 headers inline. The wrapper itself doesn't need a payment
header; the $0.10 settles when the caller sends an XRPL Payment to
the deeplink returned by `get_quote`.

The Python reference client is
[`x402-xrpl`](https://pypi.org/project/x402-xrpl/) - useful as a
template even if you build in another language.

## Stateless passthrough

The MCP server holds no wallets, takes no cut, and runs no proprietary
logic. It's a thin proxy that translates MCP tool calls into HTTP
requests against the four underlying services. Source is MIT-licensed
and public; the published npm artifact carries sigstore provenance
attestation showing it was built from this repo by GitHub Actions.

## Links

- Source: https://github.com/XRPL-Utilities/xrpl-utilities-mcp
- npm: https://www.npmjs.com/package/@xrpl-utilities/mcp
- Hosted endpoint: https://mcp.xrpl-utilities.io/mcp
- Marketing site: https://xrpl-utilities.com
- License: MIT
