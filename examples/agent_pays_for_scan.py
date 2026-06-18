#!/usr/bin/env python3
"""Demo: an AI agent pays for an XR-Sentinel wallet scan over x402 on the XRP
Ledger — the same t54 rails Ripple's XRPL AI Starter Kit ships.

XR-* APIs are x402-payable: an unauthenticated request gets HTTP 402 with
machine-readable payment requirements; the client pays (XRP or RLUSD on XRPL,
or USDC on Base) and retries with proof. No API keys, no accounts. This script
shows the full loop against the *live mainnet* endpoint using the t54
`x402-xrpl` payer SDK (`pip install x402-xrpl xrpl-py`).

Run modes:
  • No wallet  -> PREVIEW: fetch the 402 and print the payment requirements
                  (free; shows exactly what an agent must pay).
  • Funded wallet (XRPL_PAYER_SEED set) -> pays ~$0.10 in XRP and prints the
                  scan result + on-chain settlement reference.

    export XRPL_PAYER_SEED=sEd...        # a mainnet wallet with a few XRP
    python3 agent_pays_for_scan.py

The seed is read only from the environment and is never written anywhere.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

ENDPOINT = "https://sentinel.xrpl-utilities.io/scan"
TARGET = "rHuiXXjHLpMP8ZE9sSQU5aADQVWDwv6h5p"  # Ondo OUSG issuer (any r-address works)
RPC_URL = "https://xrplcluster.com/"
BODY = {"address": TARGET}


def preview() -> None:
    """Fetch the 402 challenge without paying — shows what an agent would owe."""
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(BODY).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=20)
        print("Unexpected: endpoint did not require payment.")
        return
    except urllib.error.HTTPError as e:
        if e.code != 402:
            raise
        challenge = json.loads(e.read())
    print(f"HTTP 402 from {ENDPOINT}\n  x402Version: {challenge.get('x402Version')}")
    print("  the agent may pay any one of:")
    _RLUSD_HEX = "524C555344000000000000000000000000000000"
    for a in challenge.get("accepts", []):
        asset, amount, net = a.get("asset"), a.get("amount"), a.get("network")
        if asset == "XRP":
            disp = f"{int(amount) / 1_000_000:.6f} XRP"  # amount is drops
        elif asset == _RLUSD_HEX:
            disp = f"{amount} RLUSD"
        elif net == "eip155:8453":
            disp = f"{int(amount) / 1_000_000:.2f} USDC (Base)"  # 6-decimal token
        else:
            disp = f"{amount} {asset}"
        print(f"    - {disp:24} on {net}  ->  {a.get('payTo')}")
    print("\nSet XRPL_PAYER_SEED (a mainnet wallet with a few XRP) and re-run to "
          "pay the XRP option and get the scan result.")


def pay_and_scan(seed: str) -> None:
    """Pay the 402 in XRP and print the scan result + settlement reference."""
    from xrpl.wallet import Wallet
    from x402_xrpl.clients import x402_requests, decode_x_payment_response

    wallet = Wallet.from_seed(seed)
    print(f"Agent wallet: {wallet.classic_address}")

    # x402_requests returns a requests.Session that, on a 402, selects a payment
    # requirement, signs an XRPL presigned Payment, and retries automatically.
    # network_filter pins XRPL mainnet; scheme_filter 'exact' is the XRPL scheme.
    session = x402_requests(
        wallet, rpc_url=RPC_URL, network_filter="xrpl:0", scheme_filter="exact")

    resp = session.post(ENDPOINT, json=BODY, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    print(f"\nPaid + scanned {TARGET}:")
    print(f"  activity_score: {data.get('activity_score')} ({data.get('activity_level')})")
    print(f"  signals: {', '.join(data.get('signals', [])[:6])}")

    settle = resp.headers.get("PAYMENT-RESPONSE") or resp.headers.get("X-PAYMENT-RESPONSE")
    if settle:
        try:
            s = decode_x_payment_response(settle)
            print(f"  settled on XRPL: tx {s.get('transaction') or s.get('txHash')}")
        except Exception:
            print(f"  settlement header present ({len(settle)} bytes)")


def main() -> int:
    seed = os.getenv("XRPL_PAYER_SEED")
    if not seed:
        print("[preview mode — no XRPL_PAYER_SEED set]\n")
        preview()
    else:
        pay_and_scan(seed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
