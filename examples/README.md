# Examples — an AI agent paying for XR-* data over x402

These show an autonomous agent discovering and paying an XR-* API the way
Ripple's [XRPL AI Starter Kit](https://ripple.com/insights/xrpl-ai-starter-kit/)
intends — no API key, no account, just an HTTP request that settles on the XRP
Ledger. XR-* endpoints run on the same [t54 x402 facilitator](https://xrpl-x402.t54.ai)
the kit ships, so a kit-built Payment-Skill agent can pay them out of the box.

## `agent_pays_for_scan.py`

A complete x402 round-trip against the **live mainnet** XR-Sentinel `/scan`
endpoint using the t54 `x402-xrpl` payer SDK:

```
pip install x402-xrpl xrpl-py
python3 agent_pays_for_scan.py            # preview: free, prints the 402
export XRPL_PAYER_SEED=sEd...             # a mainnet wallet with a few XRP
python3 agent_pays_for_scan.py            # pays ~$0.10 in XRP, returns the scan
```

**Preview mode** (no wallet) fetches the 402 and prints what an agent must pay:

```
HTTP 402 from https://sentinel.xrpl-utilities.io/scan
  x402Version: 2
  the agent may pay any one of:
    - 0.087241 XRP   on xrpl:0       ->  rKxTzCKYKPPdXEzuioEQ6KekQK26w2DBd5
    - 0.10 RLUSD     on xrpl:0       ->  rKxTzCKYKPPdXEzuioEQ6KekQK26w2DBd5
    - 0.10 USDC      on eip155:8453  ->  0xADB77e932516298660C47e390676c2F053D7f3c8
```

**Paid mode** (funded wallet) lets the `x402_requests` session auto-sign the
XRPL payment, retry, and return the scan result plus the on-chain settlement
reference. The seed is read only from `XRPL_PAYER_SEED` and is never persisted.

Every XR-* service (Sentinel, Pulse, Telemetry, Trust, Vault, Flows) speaks the
same x402 flow, so the same pattern pays any of them — or use the
[MCP server](https://www.npmjs.com/package/@xrpl-utilities/mcp), which wraps the
paid endpoints as agent tools.
