// What tools/list advertises: payment_signature on paid tools, and never the
// operator-only _bypass_key (removed from public schemas 2026-11-01).

import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../dist/server.js";
import { ALL_TOOLS } from "../dist/services/index.js";

async function listTools() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

test("every inline_x402 tool advertises payment_signature", async () => {
  const tools = await listTools();
  const paid = ALL_TOOLS.filter((t) => t.authMode === "inline_x402").map((t) => t.name);
  assert.ok(paid.length > 0);
  for (const name of paid) {
    const props = tools.find((t) => t.name === name)?.inputSchema?.properties ?? {};
    assert.ok(props.payment_signature, `${name} should advertise payment_signature`);
  }
});

test("no tool advertises the operator-only _bypass_key", async () => {
  // A public schema must not invite strangers to guess an operator secret.
  // The dispatcher still honours the argument when an operator sends it.
  const tools = await listTools();
  for (const t of tools) {
    assert.equal(t.inputSchema?.properties?._bypass_key, undefined, `${t.name} advertises _bypass_key`);
    assert.ok(!JSON.stringify(t).includes("_bypass_key"), `${t.name} mentions _bypass_key`);
  }
});

test("_bypass_key is never required, and the registry is not mutated", async () => {
  await listTools();
  for (const t of ALL_TOOLS) {
    assert.equal(t.inputSchema.properties?._bypass_key, undefined, `${t.name} registry entry was mutated`);
    assert.ok(!(t.inputSchema.required ?? []).includes("_bypass_key"));
  }
});
