# @xrpl-utilities/mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for the
XRPL-Utilities™ portfolio. Exposes the read endpoints of every
service as MCP tools so AI agents can discover and use them, either
locally via stdio (Claude Desktop, MCP Inspector, etc.) or remotely
via the hosted endpoint at `mcp.xrpl-utilities.io`.

## Services covered

| Service       | What it does | Tools |
|---------------|--------------|-------|
| **XR-Sentinel** | XRPL wallet activity-pattern classifier: activity score, signal catalog, label context, AI narrative; a free check that an x402 seller controls the XRPL account it advertises | `xrpl_sentinel_scan` (paid), `xrpl_sentinel_scan_history` (paid), `xrpl_sentinel_verify_origin` (free) |
| **XR-Pulse** | Normalized XRPL event feed (news, whale moves, RWA mints and burns, Sentinel signals) plus market views at $0.01 per call: Ripple counterparties, exchange flows, escrow calendar, RLUSD distribution, RWA summary, token health. Live WebSocket streams are sold through `xrpl_pulse_stream_purchase` | `xrpl_pulse_recent_events` (paid), `xrpl_pulse_events_by_address` (paid), `xrpl_pulse_stream_purchase` (paid), `xrpl_pulse_ripple_counterparties` (paid, $0.01), `xrpl_pulse_ripple_topology` (paid, $0.01), `xrpl_pulse_cex_attribution` (paid, $0.01), `xrpl_pulse_network_stats` (free), `xrpl_pulse_xrpl_primitives` (paid, $0.01), `xrpl_pulse_whale_flow_24h` (paid, $0.01), `xrpl_pulse_exchange_flow_delta` (paid, $0.01), `xrpl_pulse_rwa_summary` (paid, $0.01), `xrpl_pulse_exchange_net_flow` (paid, $0.01), `xrpl_pulse_escrow_calendar` (paid, $0.01), `xrpl_pulse_entity_positioning` (paid, $0.01), `xrpl_pulse_rlusd_distribution` (paid, $0.01), `xrpl_pulse_token_health` (paid, $0.01), `xrpl_pulse_whale_census` (paid, $0.01), `xrpl_pulse_whale_flow_history` (paid, $0.01), `xrpl_pulse_rwa_supply_history` (paid, $0.01), `xrpl_pulse_xls85_totals` (paid, $0.01), `xrpl_pulse_ripple_counterparty_graph` (paid, $0.01), `xrpl_pulse_recent_choreographies` (paid, $0.01), `xrpl_pulse_top_destinations` (paid, $0.01), `xrpl_pulse_moex_xrp_index` (paid, $0.01) |
| **XR-Telemetry** | XRPL macro snapshot (supply, liquidity, AMM, Active Float) and settlement and DEX volume series | `xrpl_telemetry_snapshot` (paid), `xrpl_telemetry_get_quote` (paid, invoice), `xrpl_telemetry_get_status` (free, completes the invoice), `xrpl_telemetry_get_results` (free, completes the invoice), `xrpl_telemetry_settlement_totals` (free), `xrpl_telemetry_settlement_series` (paid, $0.01), `xrpl_telemetry_dex_pair_volume` (paid, $0.01), `xrpl_telemetry_liquidity` (paid, $0.01), `xrpl_telemetry_exchange_flow_history` (paid, $0.01) |
| **XR-Trust** | Directory and drill-down for the XRPL permissioned-asset stack (XLS-70/80/81, XLS-40 DID), operator index, jurisdictions and permissioned-domain activity | `xrpl_trust_list_domains` (paid), `xrpl_trust_get_domain` (paid), `xrpl_trust_credential_issuers` (paid), `xrpl_trust_recent_events` (paid, $0.01), `xrpl_trust_list_operators_index` (free), `xrpl_trust_operator_drilldown` (paid), `xrpl_trust_operator_attribution` (paid, $0.01), `xrpl_trust_usage_summary` (paid, $0.01), `xrpl_trust_jurisdictions` (paid, $0.01), `xrpl_trust_permissioned_activity` (paid, $0.01) |
| **XR-Vault** | Real-world asset tracker: per-issuer supply, mint and burn flow, AMM pool exposure | `xrpl_vault_scan` (paid), `xrpl_vault_daily_flow` (free, 7-day sample), `xrpl_vault_daily_flow_history` (paid, $0.01) |
| **XR-Flows** | XRP ETF AUM against XRPL exchange flow, launch impact and cross-border flow | `xrpl_flows_scan` (paid), `xrpl_flows_correlation` (paid, $0.01), `xrpl_flows_cross_border_flow` (paid, $0.01), `xrpl_flows_launch_impact` (paid, $0.01), `xrpl_flows_etf_flow_summary` (paid, $0.01), `xrpl_flows_etf_candidates` (paid, $0.01) |
| **XR-Ledger** | Account statements for one XRPL address or a watchlist of up to 10: monthly XRP in/out, fees, activity categories, token net change, counterparties | `xrpl_ledger_statement` (paid), `xrpl_ledger_schema` (free) |
| **XR-Desk** | Composite desk briefing: market posture, positioning, RLUSD health, supply pressure, RWA market | `xrpl_desk_briefing` (paid, $0.01) |
| **Bundles** | One call and one payment that answer a whole question from several services. Wallet check: who an XRPL wallet is and what it has been doing (Sentinel scan, domain check, Pulse events, 90-day XR-Ledger statement, XR-Trust role). XRP market briefing: posture, whale count, exchange net flow, positioning, escrow calendar, fund holdings, on-ledger sell impact. RWA token report: supply, holders, growth, AMM pools and the issuer wallet. Fund flow report: fund flows against net exchange flow on the ledger. Permissioned venue report: who runs a permissioned domain and how active it is. Network snapshot: accounts, activity, ledger objects, supply and payment volume | `xrpl_wallet_check` (paid, $0.25), `xrpl_xrp_market_briefing` (paid, $0.05), `xrpl_rwa_token_report` (paid, $0.15), `xrpl_fund_flow_report` (paid, $0.10), `xrpl_permissioned_venue_report` (paid, $0.10), `xrpl_network_snapshot` (paid, $0.10) |

64 tools total: 56 paid, 8 free, all read-only.
Paid calls settle over x402 v2 in XRP or RLUSD on XRPL, or USDC on Base.

## Auth model

The MCP server is a **stateless passthrough proxy**. It does not hold
wallets, manage user accounts, or subsidize calls.

Paid tools speak standard x402 over MCP. Data tools (every tool marked $0.01 above)
cost $0.01 USD per call. Deep dives, event queries and the Ledger statement cost $0.10.
Bundles cost $0.05 (XRP market briefing), $0.10 (fund flow report, permissioned venue
report, network snapshot), $0.15 (RWA token report) and $0.25 (wallet check).

Every successful paid answer carries a `provenance` block: the service, its
`schema_version`, `served_at`, and the newest validated XRP Ledger it had read
(`index`, `hash`, `close_time`). Each evening a fingerprint of the day's published
figures is written to the XRP Ledger; anyone can check a day at
[xrpl-utilities.com/verify](https://xrpl-utilities.com/verify/).
Call a paid tool without payment and you get a tool result with
`isError: true` and the x402 `PaymentRequired` object in
`structuredContent`. It lists three payment options: XRP and RLUSD on
XRPL via the t54 facilitator, or USDC on Base mainnet via the Coinbase
x402 facilitator. Sign one and retry the same call with the payment
payload object in `_meta["x402/payment"]`. A settled call returns the
settlement in `_meta["x402/payment-response"]`. Any x402 MCP client
library handles this loop for you.

Clients that can't set `_meta` can still pass the payload as a
`payment_signature` argument, base64-JSON-encoded. Either way the
server forwards it as the `PAYMENT-SIGNATURE` header on the underlying
call, and the backend verifies and settles it.

Operators can set `MCP_BYPASS_KEY` on the server to enable an opt-in
bypass for friendlies / demos. The caller passes the matching key as
`_bypass_key` in the tool args. It is not listed in the public tool
schemas, so send it from a client that does not validate arguments
against `tools/list` (a raw JSON-RPC call works).

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

Restart Claude Desktop. The 64 tools should appear with the prefix
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
3. Send the payload in `_meta["x402/payment"]`, or base64-JSON-encode it
   and pass it as `payment_signature`.

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
take the other healthy services' tools down with it, whenever one
backend is cold. Either way, a service whose manifest was not read logs
`NOT CHECKED` - "could not check" is never reported as "all clear".

## Releases

Bump the version and merge it to `main`. The `Release` workflow sees a
version npm doesn't have yet, builds and tests, publishes to npm with
sigstore provenance, creates the `v<version>` tag, then mirrors the same
version to the official MCP Registry via GitHub OIDC (no extra secrets
needed).

```bash
npm version patch --no-git-tag-version   # or minor / major
# commit, open a PR, merge to main; CI does the rest
```

Pushing a `v*` tag still works too (`npm version patch && git push --follow-tags`).

The published artifact appears at
[npmjs.com/package/@xrpl-utilities/mcp](https://www.npmjs.com/package/@xrpl-utilities/mcp)
within ~90 seconds. Provenance attestation is visible on the package
page as a green check. The MCP Registry entry lives at
[registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.XRPL-Utilities/mcp)
under the reverse-DNS name `io.github.XRPL-Utilities/mcp`.

## License

MIT. Full portfolio at [xrpl-utilities.com](https://xrpl-utilities.com).
