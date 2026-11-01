// Coinbase's Bazaar indexes an MCP tool by calling it with
// extensions.bazaar.info.input.example as its arguments. A paid tool without
// a valid example cannot be indexed, so every inline_x402 tool needs one that
// validates against its own input schema, and the challenge must carry it.

import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { ALL_TOOLS } from "../dist/services/index.js";
import { BAZAAR_EXAMPLES } from "../dist/bazaarExamples.js";
import { mcpBazaarExtension, paymentRequiredFor } from "../dist/x402mcp.js";

const paid = ALL_TOOLS.filter((t) => t.authMode === "inline_x402");

test("every paid tool has a Bazaar example, and no example is orphaned", () => {
  assert.ok(paid.length > 0);
  for (const t of paid) assert.ok(BAZAAR_EXAMPLES[t.name], `${t.name} has no Bazaar example`);
  const names = new Set(paid.map((t) => t.name));
  for (const k of Object.keys(BAZAAR_EXAMPLES)) assert.ok(names.has(k), `example for unknown or unpaid tool ${k}`);
});

test("each example validates against its tool's input schema", () => {
  const ajv = new Ajv({ strict: false, allErrors: true });
  for (const t of paid) {
    const ok = ajv.validate(t.inputSchema, BAZAAR_EXAMPLES[t.name]);
    assert.ok(ok, `${t.name}: ${ajv.errorsText()}`);
    assert.ok(!("payment_signature" in BAZAAR_EXAMPLES[t.name]));
    assert.ok(!("_bypass_key" in BAZAAR_EXAMPLES[t.name]));
  }
});

test("the challenge's Bazaar declaration carries the example and validates", () => {
  const ajv = new Ajv2020({ strict: false });
  for (const t of paid) {
    const ext = mcpBazaarExtension(t);
    assert.deepEqual(ext.info.input.example, BAZAAR_EXAMPLES[t.name], t.name);
    assert.ok(ajv.validate(ext.schema, ext.info), `${t.name}: ${ajv.errorsText()}`);
  }
  const pr = paymentRequiredFor(paid[0].name, { x402Version: 2, accepts: [{ network: "xrpl:0" }] }, null, paid[0]);
  assert.ok(pr.extensions.bazaar.info.input.example);
});

test("the example is a copy, so a caller cannot mutate the registry", () => {
  const t = paid.find((x) => Object.keys(BAZAAR_EXAMPLES[x.name]).length > 0);
  const ext = mcpBazaarExtension(t);
  ext.info.input.example.injected = true;
  assert.equal(BAZAAR_EXAMPLES[t.name].injected, undefined);
});
