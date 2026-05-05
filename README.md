# @xrpl-utilities/mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for the
XRPL-Utilities™ portfolio. Exposes the read endpoints of all four
services as MCP tools so AI agents can discover and use them — either
locally via stdio (Claude Desktop, MCP Inspector, etc.) or remotely
via the hosted endpoint at `mcp.xrpl-utilities.io`.

## Services covered

| Service       | What it does                                            | Tools |
|---------------|---------------------------------------------------------|-------|
| **XR-Sentinel**  | XRPL wallet activity-pattern classifier (0-100 score, 22-signal catalog, AI narrative) | `xrpl_sentinel_scan`, `xrpl_sentinel_scan_history` |
| **XR-Pulse**     | Normalized XRPL signal feed — public-source news + on-chain whale activity + XLS-70/80/81 lifecycle | `xrpl_pulse_recent_events` |
| **XR-Telemetry** | XRPL macro snapshot — supply, liquidity, AMM, Active Float, Burst Math utility floor | `xrpl_telemetry_snapshot`, `xrpl_telemetry_get_quote`, `xrpl_telemetry_get_status`, `xrpl_telemetry_get_results` |
| **XR-Trust**     | Directory + drill-down for XRPL permissioned-asset stack (XLS-70/80/81 + XLS-40 DID) | `xrpl_trust_list_domains`, `xrpl_trust_get_domain`, `xrpl_trust_credential_issuers`, `xrpl_trust_recent_events` |

11 tools total, all read-only. Every paid call is settled via x402 v2
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
returns its real `402 Payment Required` challenge with the XRP +
RLUSD requirements. The MCP server passes that back to the LLM as
a structured error so it can sign and retry.

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

Restart Claude Desktop. The 11 tools should appear with the prefix
`xrpl_`. Ask Claude to "scan the wallet rXXX with XR-Sentinel" or
"list permissioned domains on XRPL" and the tool calls flow through.

### Remotely (HTTP/SSE)

Point any MCP client at `https://mcp.xrpl-utilities.io/mcp`. Same
tool list, same auth model.

## What you need to actually pay

To avoid 402 challenges on every call, your client needs to:

1. Hold a funded XRPL wallet (XRP + optional RLUSD trustline).
2. On each paid tool call, sign a Payment matching one of the
   `accepts` entries from a prior probe.
3. Pass the base64-JSON-encoded header as `payment_signature`.

The Python reference implementation is
[`x402-xrpl`](https://pypi.org/project/x402-xrpl/) — useful as a
template even if you're using a different language.

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
that `package.json` version matches the tag, then publishes to npm
with sigstore provenance.

```bash
npm version patch       # or minor / major
git push --follow-tags  # pushes commit + tag, CI does the rest
```

The published artifact appears at
[npmjs.com/package/@xrpl-utilities/mcp](https://www.npmjs.com/package/@xrpl-utilities/mcp)
within ~90 seconds. Provenance attestation is visible on the package
page as a green check.

## License

MIT. Full portfolio at [xrpl-utilities.com](https://xrpl-utilities.com).
