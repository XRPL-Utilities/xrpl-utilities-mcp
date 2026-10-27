// The README's tool table said "17 tools total" and settlement through t54
// only, while the server shipped 44 tools on three payment rails. Directory
// listings and buyers read the README first, so it has to track the code.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ALL_TOOLS } from "../dist/services/index.js";

const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("README tool count matches the registry", () => {
  const counts = [...readme.matchAll(/\b(\d+) tools\b/g)].map((m) => Number(m[1]));
  assert.ok(counts.length > 0, "README states a tool count");
  for (const n of counts) assert.equal(n, ALL_TOOLS.length);
});

test("README lists every registered tool", () => {
  for (const t of ALL_TOOLS) assert.ok(readme.includes("`" + t.name + "`"), `${t.name} missing from README`);
});

test("README names all three payment rails", () => {
  for (const rail of ["XRP", "RLUSD", "USDC on Base"]) assert.ok(readme.includes(rail), rail);
});
