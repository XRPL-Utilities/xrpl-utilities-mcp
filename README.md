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
`_bypass_key` in the tool args.

The hosted endpoint budgets failed `_bypass_key` attempts per caller
separately from, and far more tightly than, ordinary requests: a 60
requests-per-minute cap is a fair-use limit, not an access control on a
secret. The budget is spent per guess, not per HTTP request, so a batched
JSON-RPC body cannot outrun it, and only requests that actually carry a
`_bypass_key` are held off once it is exhausted - `tools/list`, free tools
and paid x402 calls keep working. Batches are capped at 20 messages. Use a key of at least 32 random bytes, and scope or rotate it
per service rather than sharing one portfolio-wide key. Bucket keying
depends on `TRUST_PROXY_HOPS` matching the real number of proxies in
front of the container - see `.env.example`.

### H-Seal receipt co-signing (optional)

Set `PROVIDER_IDENTITY` (our CAIP-10, e.g. `xrpl:0:r...`) and
`PROVIDER_KEY_RAW` (32-byte ed25519 seed, hex) on the server to have every
tool response co-signed with an [H-Seal](https://h-seal.xr-utilities.com)
provider attestation. The attestation rides on the tool result's
`_meta.hSeal`, so a caller can anchor a tamper-evident, independently
verifiable on-chain receipt of the interaction. When either var is unset the
feature is inert and responses are unchanged. Never hardcode the key — env
only.

When a backend co-signs its own output, the MCP also builds a 2-party
receipt (`_meta.hSealReceipt`). That signs with the operator key, so set
`HSEAL_ALLOWED_PROVIDERS` to the CAIP-10 identities of the XR-* backends
you are willing to vouch for. Without it any provider that proves it holds
the key for the identity it names is accepted. The `responseHash` is always
recomputed from the delivered body; `requestHash` stays provider-asserted
(the backends hash a synthetic request object the MCP cannot reproduce) and
the result says so via `requestHashBasis`. See `src/hSeal.ts` and the ops runbook
[`docs/hseal-provider.md`](docs/hseal-provider.md) (current identity, the
ed25519 curve gotcha, and how to rotate/recover the key).

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
npm test          # builds, then runs the node:test suite in tests/
```

Point MCP Inspector at `http://localhost:8080/mcp` to walk through
tool definitions interactively.

Set `STRICT_VALIDATE=1` to treat a manifest that could not be read as
drift instead of a warning. It is off by default because Railway restarts
`ON_FAILURE`: failing closed on boot would crash-loop the endpoint, and
take the other five healthy services' tools down with it, whenever one
backend is cold. Either way, a service whose manifest was not read logs
`NOT CHECKED` - "could not check" is never reported as "all clear".

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
