// H-Seal was retired on 2026-11-01. Guard against its code, dependency or
// result fields coming back.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("no H-Seal code or dependency remains", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(!Object.keys(pkg.dependencies ?? {}).some((d) => d.includes("h-seal")));
  const dir = fileURLToPath(new URL("../src/", import.meta.url));
  for (const f of readdirSync(dir, { recursive: true })) {
    if (!String(f).endsWith(".ts")) continue;
    const src = readFileSync(join(dir, String(f)), "utf8").toLowerCase();
    assert.ok(!src.includes("hseal"), `${f} still mentions hseal`);
  }
});

test("the H-Index listing draft makes no H-Seal or receipt claim", () => {
  const raw = readFileSync(new URL("../h-index-listing.json", import.meta.url), "utf8");
  const listing = JSON.parse(raw);
  assert.ok(!("slaReceiptRef" in listing), "slaReceiptRef points at the retired H-Seal topic");
  assert.ok(!/h-?seal/i.test(listing.description), "description still pitches H-Seal");
  assert.ok(!/co-sign/i.test(raw), "listing still claims co-signed responses");
});
