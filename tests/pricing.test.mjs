// tools/list `_meta.pricing` marked the Telemetry status and results steps as
// paid $0.10 each, so a client adding up the badges read one snapshot as
// $0.30, and the README repeated "16 paid". The Ledger tool also said "no Base
// rail" after Ledger went live on Base. These checks pin all three to the code.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ALL_TOOLS } from "../dist/services/index.js";
import { pricingFor } from "../dist/pricing.js";

const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
const priced = ALL_TOOLS.map((t) => ({ name: t.name, ...pricingFor(t.name, t.authMode) }));

test("Telemetry invoice charges once, at the quote step", () => {
  const byName = Object.fromEntries(priced.map((p) => [p.name, p]));
  assert.equal(byName.xrpl_telemetry_get_quote.paid, true);
  assert.equal(byName.xrpl_telemetry_get_quote.priceUsd, 0.1);
  for (const n of ["xrpl_telemetry_get_status", "xrpl_telemetry_get_results"]) {
    assert.equal(byName[n].paid, false, n);
    assert.equal(byName[n].priceUsd, 0, n);
  }
});

test("README paid and free counts match pricing", () => {
  const paid = priced.filter((p) => p.paid).length;
  const m = readme.match(/(\d+) paid, (\d+) free/);
  assert.ok(m, "README states paid and free counts");
  assert.equal(Number(m[1]), paid);
  assert.equal(Number(m[2]), ALL_TOOLS.length - paid);
});

test("Ledger statement names the Base rail it takes", () => {
  const t = ALL_TOOLS.find((x) => x.name === "xrpl_ledger_statement");
  assert.ok(t.description.includes("USDC on Base"), t.description);
  assert.ok(!/no Base rail/i.test(t.description));
});
