// Docs audit, 2026-11-03. The served /llms.txt said every paid tool cost
// $0.10 and that XR-Ledger took the two XRPL rails only; data tools cost
// $0.01, bundles $0.05 to $0.25, and Ledger's 402 offers USDC on Base too.
// The README priced only two of the six bundles, and docs/architecture.md
// named the old treasury wallet and four services.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("served llms.txt gives the real price tiers and rails", () => {
  const src = read("src/transport/http.ts");
  assert.ok(!src.includes("XR-Ledger takes the two XRPL"), "Ledger takes Base too");
  assert.ok(!src.includes('call. $0.10 USD per call.'), "single $0.10 price claim is back");
  for (const p of ["$0.01 USD per call", "$0.05", "$0.15", "$0.25"]) assert.ok(src.includes(p), `missing ${p}`);
  assert.ok(src.includes("## Provenance") && src.includes("xrpl-utilities.com/verify/"));
});

test("README prices all six bundles and explains provenance", () => {
  const md = read("README.md");
  for (const b of ["$0.05 (XRP market briefing)", "$0.15 (RWA token report)", "$0.25 (wallet check)", "fund flow report", "permissioned venue", "network snapshot"]) {
    assert.ok(md.includes(b), `README missing ${b}`);
  }
  assert.ok(md.includes("`provenance`"));
});

test("architecture doc names the current treasury, not the old one", () => {
  const md = read("docs/architecture.md");
  assert.ok(!md.includes("rKxTz"), "old treasury wallet");
  assert.ok(md.includes("r9sr13PJ4u6ZvmkCWEQCs5AEenBo4zU3xF"));
  assert.ok(md.includes("XR-Ledger") && md.includes("XR-Vault") && md.includes("XR-Flows"));
});
