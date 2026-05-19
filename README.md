# @xrpl-utilities/mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for the
XRPL-Utilities™ portfolio. Exposes the read endpoints of all six
services as MCP tools so AI agents can discover and use them, either
locally via stdio (Claude Desktop, MCP Inspector, etc.) or remotely
via the hosted endpoint at `mcp.xrpl-utilities.io`.

## Services covered

| Service       | What it does                                            | Tools |
|---------------|---------------------------------------------------------|-------|
| **XR-Sentinel**  | XRPL wallet activity-pattern classifier (0-100 score, 35-signal catalog including account-genesis chain + provenance flags + AI narrative) | `xrpl_sentinel_scan`, `xrpl_sentinel_scan_history` |
| **XR-Pulse**     | Normalized XRPL signal feed: public-source news, on-chain whale activity, XLS-70/80/81 lifecycle, RWA mint/burn flow, AMM-of-RWA pool snapshots. Also streamable live via `POST /stream/purchase` + WebSocket (1h/6h/24h tiers) directly on the backend; MCP exposes the snapshot endpoints here. | `xrpl_pulse_recent_events`, `xrpl_pulse_events_by_address`, `xrpl_pulse_stream_purchase` |
| **XR-Telemetry** | XRPL macro snapshot: supply, liquidity, AMM, Active Float, Burst Math utility floor | `xrpl_telemetry_snapshot`, `xrpl_telemetry_get_quote`, `xrpl_telemetry_get_status`, `xrpl_telemetry_get_results` |
| **XR-Trust**     | Directory + drill-down for XRPL permissioned-asset stack (XLS-70/80/81 + XLS-40 DID) | `xrpl_trust_list_domains`, `xrpl_trust_get_domain`, `xrpl_trust_credential_issuers`, `xrpl_trust_recent_events` |
| **XR-Vault**     | Real-world asset tracker for XRPL: per-issuer mint/burn flow, daily circulating snapshots, AMM-of-RWA pool exposure across tokenized treasuries, stablecoins, commercial paper, MMFs, and energy commodities | `xrpl_vault_scan` |
| **XR-Flows**     | ETF AUM vs XRPL exchange-flow correlation across every US-listed XRP-exposure ETF (spot + indirect-basket tiers), including SEC EDGAR filing list and launch-window flow analysis | `xrpl_flows_correlation`, `xrpl_flows_launch_impact`, `xrpl_flows_scan` |

17 tools total, all read-only. Every paid call is settled via x402 v2
on the XRPL mainnet through the t54 facilitator.

## Auth model

The MCP server is a **stateless passthrough proxy**. It does not hold
wallets, manage user accounts, or subsidize calls.

For paid tools (every endpoint at $0.10 USD), the caller supplies a
`payment_signature` argument: a base64-JSON-encoded x402 v2 payment
header signing an XRPL Payment that matches one of the requirements
returned by an unauthenticated probe. The server forwards it as the
`PAYMENT-SIGNATURE` header on the underlying call.

If you don't supply `payment_signature`, the underlying service
returns its real `402 Payment Required` challenge listing three
payment options: XRP and RLUSD on XRPL via the t54 facilitator, or
USDC on Base mainnet via the Coinbase x402 facilitator. The MCP
server passes that back to the LLM as a structured error so it can
sign and retry against whichever rail its wallet supports.

Operators can set `MCP_BYPASS_KEY` on the server to enable an opt-in
bypass for friendlies / demos. The caller passes the matching key as
`_bypass_key` in the tool args. Rate-limited at the proxy layer.

## Use it

### Locally via Claude Desktop (stdio)

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

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

Restart Claude Desktop. The 17 tools should appear with the prefix
`xrpl_`. Ask Claude to "scan the wallet rXXX with XR-Sentinel" or
"list permissioned domains on XRPL" and the tool calls flow through.

### Remotely (HTTP/SSE)

Point any MCP client at `https://mcp.xrpl-utilities.io/mcp`. Same
tool list, same auth model.

## What you need to actually pay

To avoid 402 challenges on every call, your client needs to:

1. Hold a wallet on at least one of the supported rails:
   an XRPL wallet with XRP (and optional RLUSD trustline) OR
   an EVM wallet with USDC on Base mainnet.
2. On each paid tool call, sign a payment matching one of the
   `accepts` entries from a prior probe. XRPL rails take an
   XRPL Payment; the Base rail takes an EIP-3009
   `transferWithAuthorization`.
3. Pass the base64-JSON-encoded envelope as `payment_signature`.

Reference implementations:
[`x402-xrpl`](https://pypi.org/project/x402-xrpl/) covers the
XRPL rails. The official [`x402`](https://pypi.org/project/x402/)
package (with `[evm]` extras) covers the Base USDC rail. Both are
useful as templates in any language.

## Local dev

```bash
npm install
npm run build
node dist/index.js --transport http --port 8080
```

Point MCP Inspector at `http://localhost:8080/mcp` to walk through
tool definitions interactively.

## Releases

Releases are cut by tag push. The `Release` workflow builds, validates
that `package.json` version matches the tag, publishes to npm with
sigstore provenance, then mirrors the same version to the official
MCP Registry via GitHub OIDC (no extra secrets needed).

```bash
npm version patch       # or minor / major
git push --follow-tags  # pushes commit + tag, CI does the rest
```

The published artifact appears at
[npmjs.com/package/@xrpl-utilities/mcp](https://www.npmjs.com/package/@xrpl-utilities/mcp)
within ~90 seconds. Provenance attestation is visible on the package
page as a green check. The MCP Registry entry lives at
[registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.XRPL-Utilities/mcp)
under the reverse-DNS name `io.github.XRPL-Utilities/mcp`.

## License

MIT. Full portfolio at [xrpl-utilities.com](https://xrpl-utilities.com).
