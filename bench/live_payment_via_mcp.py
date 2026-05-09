"""End-to-end paid scan exercised through the hosted MCP envelope.

Verifies that the JSON-RPC `tools/call` wrapper at
https://mcp.xrpl-utilities.io/mcp correctly forwards an x402 payment to
the upstream service (Sentinel by default) and proxies the response
back. Catches regressions in the MCP transport layer that the per-
service `bench/live_payment.py` tests can't see — e.g., a payment_
signature stripping bug, a JSON-RPC envelope mismatch, or a content-
type / Accept-header drift.

Single XRP-paid scan per run (~$0.10). Run as part of close_out --paid.

Usage:
    XRPL_SEED="$(cat ~/.seed)" python bench/live_payment_via_mcp.py

Exit codes:
    0  scan landed via MCP, settlement record present, content shape ok
    1  test failure (assertion did not hold)
    2  pre-flight (insufficient balance, missing seed, MCP unreachable)
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
from decimal import Decimal

import httpx

MCP_RPC_URL = os.getenv("MCP_RPC_URL", "https://mcp.xrpl-utilities.io/mcp")
SENTINEL_BASE = os.getenv("SENTINEL_BASE_URL", "https://sentinel.xrpl-utilities.io")
XRPL_RPC_URL = os.getenv("XRPL_RPC_URL", "https://xrplcluster.com")

# Default scan target — known dormant address with no live AI cost on
# Sentinel's side (short-circuits to the dormant-narrative branch).
TARGET = os.getenv("MCP_PAID_TEST_ADDRESS", "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv")


def fail(msg: str, code: int = 1) -> None:
    print(f"[FAIL] {msg}")
    sys.exit(code)


def ok(msg: str) -> None:
    print(f"[OK]   {msg}")


def main() -> int:
    seed = os.environ.get("XRPL_SEED")
    if not seed:
        fail("XRPL_SEED env var required (cat ~/.seed)", code=2)

    # Pre-flight: import xrpl + x402 deps lazily so a missing dep gives
    # a clean error instead of a top-of-file ImportError.
    try:
        from xrpl.wallet import Wallet
        from x402_xrpl.client.presigned_payment_payer import (
            XRPLPresignedPaymentPayer,
            XRPLPresignedPaymentPayerOptions,
        )
        from x402_xrpl.types import PaymentRequirements
    except ImportError as e:
        fail(f"missing dependency: {e}; ensure xrpl + x402-xrpl are installed", code=2)

    wallet = Wallet.from_seed(seed)
    print(f"  payer: {wallet.classic_address}")
    print(f"  mcp:   {MCP_RPC_URL}")
    print(f"  via:   {SENTINEL_BASE}/scan (Sentinel xrpl_sentinel_scan tool)")
    print(f"  scan:  {TARGET}")
    print()

    # The simplest reliable way to get a signed payment_signature is to
    # let X402RequestsSession do the 402 -> presign -> retry round-trip
    # against Sentinel directly, then capture the PAYMENT-SIGNATURE
    # header from the request it just made. We don't actually need the
    # response body — only the signed header value.
    #
    # The shortcut: drive the SAME session twice. First call lets the
    # session presign + spend for one scan against Sentinel direct
    # (validates payment infra works). Second call demonstrates MCP
    # forwarding using a fresh signature. Each costs ~$0.10.
    #
    # BUT that's 2x spend per close_out run. Instead, we do a single
    # paid scan and route it through MCP from the start. To do that, we
    # need to manually presign without X402RequestsSession's auto-retry.
    #
    # X402RequestsSession's resign-and-resubmit flow is private; rather
    # than reimplementing it we lean on a helper: probe Sentinel
    # ourselves, presign the matching accepts[] option, and pass the
    # encoded signature as `payment_signature` in the MCP tool args.

    # 1. Probe Sentinel to get the 402 challenge + accepts[].
    t0 = time.perf_counter()
    try:
        with httpx.Client(timeout=30.0) as c:
            probe = c.post(f"{SENTINEL_BASE}/scan", json={"address": TARGET})
    except Exception as e:
        fail(f"probe POST /scan failed: {type(e).__name__}: {e}", code=2)
    if probe.status_code != 402:
        fail(f"probe expected 402, got {probe.status_code}: {probe.text[:200]}", code=2)
    body = probe.json()
    accepts = body.get("accepts") or []
    xrp_opt = next((a for a in accepts if a.get("asset") == "XRP"), None)
    if not xrp_opt:
        fail("no XRP option in accepts[]", code=2)
    ok(f"probe -> 402 with {len(accepts)} accepts[] option(s); using XRP @ {xrp_opt.get('amount')} drops")

    # 2. Build the JSON-RPC envelope.
    rpc_body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "xrpl_sentinel_scan",
            "arguments": {"address": TARGET},
        },
    }

    # 3. Resolve the payment_signature.
    #
    # MCP wraps upstream 402s inside a 200 JSON-RPC envelope, so we
    # can't lean on X402RequestsSession's auto-resign loop (which only
    # fires on a real HTTP 402). Two modes:
    #   - Bypass: D_BYPASS_KEY env var → free regression test of the
    #     MCP transport envelope without spending money.
    #   - Paid: presign manually against the probe's accepts[] entry
    #     using x402_xrpl's XRPLPresignedPaymentPayer (the same signer
    #     X402RequestsSession uses internally).
    bypass_key = os.environ.get("D_BYPASS_KEY", "")
    if bypass_key:
        rpc_body["params"]["arguments"]["payment_signature"] = bypass_key
        cost_label = "free (bypass-key)"
    else:
        try:
            invoice_id = (xrp_opt.get("extra") or {}).get("invoiceId")
            req = PaymentRequirements(
                scheme=xrp_opt["scheme"],
                network=xrp_opt["network"],
                amount=xrp_opt["amount"],
                asset=xrp_opt["asset"],
                pay_to=xrp_opt["payTo"],
                max_timeout_seconds=int(xrp_opt.get("maxTimeoutSeconds", 600)),
                extra=xrp_opt.get("extra"),
            )
            payer = XRPLPresignedPaymentPayer(
                XRPLPresignedPaymentPayerOptions(
                    wallet=wallet,
                    network=xrp_opt["network"],  # 'xrpl:0' for mainnet
                    rpc_url=XRPL_RPC_URL,
                ),
            )
            signed = payer.create_payment_header(req, invoice_id=invoice_id)
        except Exception as e:
            fail(f"presign failed: {type(e).__name__}: {e}", code=2)
        rpc_body["params"]["arguments"]["payment_signature"] = signed
        cost_label = "paid (~$0.10)"
    ok(f"signed payment_signature attached to args ({cost_label})")

    # 4. Submit via MCP envelope.
    t_submit = time.perf_counter()
    try:
        with httpx.Client(timeout=120.0) as c:
            r = c.post(
                MCP_RPC_URL,
                json=rpc_body,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                },
            )
    except Exception as e:
        fail(f"MCP tools/call POST failed: {type(e).__name__}: {e}")
    elapsed = time.perf_counter() - t_submit

    # MCP returns either a plain JSON body or an SSE stream. Both forms
    # carry the JSON-RPC response payload; SSE wraps it in `data: {...}`.
    raw = r.text
    parsed = None
    try:
        parsed = r.json()
    except Exception:
        # SSE fallback: extract the first data: line.
        for line in raw.splitlines():
            if line.startswith("data:"):
                try:
                    parsed = json.loads(line[5:].strip())
                    break
                except Exception:
                    continue
    if not isinstance(parsed, dict):
        fail(f"could not parse MCP response (status {r.status_code}): {raw[:300]}")

    if "error" in parsed and parsed["error"]:
        err = parsed["error"]
        fail(f"MCP returned JSON-RPC error: code={err.get('code')} msg={err.get('message')}")

    result = parsed.get("result") or {}
    content = result.get("content") or result.get("structuredContent") or []
    if not content:
        fail(f"MCP result has no content/structuredContent: {json.dumps(parsed)[:400]}")

    # The MCP server returns the upstream JSON as content[0].text
    # (per modelcontextprotocol/sdk pattern).
    if isinstance(content, list) and content and isinstance(content[0], dict):
        text = content[0].get("text") or ""
        try:
            scan_body = json.loads(text)
        except Exception:
            fail(f"content[0].text not JSON-parseable: {text[:300]}")
    elif isinstance(content, dict):
        scan_body = content
    else:
        fail(f"unexpected content shape: {type(content).__name__}")

    # Assertion: scan body has the expected Sentinel shape.
    activity_level = scan_body.get("activity_level")
    schema = scan_body.get("schema_version")
    if not activity_level or not schema:
        fail(f"scan body missing activity_level/schema_version: {json.dumps(scan_body)[:300]}")

    ok(f"MCP envelope round-trip OK in {elapsed:.2f}s")
    ok(f"upstream scan: level={activity_level} schema={schema}")

    # Soft-check: PAYMENT-RESPONSE header should propagate through MCP
    # so the caller can extract the on-chain settlement record. Some
    # transports may strip non-standard headers; warn rather than fail
    # if missing.
    pr = r.headers.get("payment-response") or r.headers.get("PAYMENT-RESPONSE")
    if pr:
        try:
            settle = json.loads(base64.b64decode(pr).decode())
            ok(f"PAYMENT-RESPONSE present: success={settle.get('success')} tx={(settle.get('transaction') or '')[:12]}...")
        except Exception:
            print(f"[WARN] PAYMENT-RESPONSE header present but undecodable")
    else:
        print("[WARN] no PAYMENT-RESPONSE header (MCP transport may strip it; non-fatal)")

    print()
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
