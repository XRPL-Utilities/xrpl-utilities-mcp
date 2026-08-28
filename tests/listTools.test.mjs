// The dispatcher honours _bypass_key, but every tool schema is closed
// (additionalProperties: false). If the advertised schema doesn't declare it,
// any client that validates args before sending refuses to send it and the
// documented operator bypass is unusable.

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

test("every inline_x402 tool advertises both payment_signature and _bypass_key", async () => {
  const tools = await listTools();
  const paid = ALL_TOOLS.filter((t) => t.authMode === "inline_x402").map((t) => t.name);
  assert.ok(paid.length > 0);
  for (const name of paid) {
    const props = tools.find((t) => t.name === name)?.inputSchema?.properties ?? {};
    assert.ok(props.payment_signature, `${name} should advertise payment_signature`);
    assert.ok(props._bypass_key, `${name} should advertise _bypass_key`);
  }
});

test("free and async_invoice tools do not advertise _bypass_key", async () => {
  // Those paths never consult callerBypassKey, so advertising it would be a
  // false contract.
  const tools = await listTools();
  for (const t of ALL_TOOLS.filter((t) => t.authMode !== "inline_x402")) {
    const props = tools.find((x) => x.name === t.name)?.inputSchema?.properties ?? {};
    assert.equal(props._bypass_key, undefined, `${t.name} should not advertise _bypass_key`);
  }
});

test("_bypass_key is never required, and the registry is not mutated", async () => {
  await listTools();
  for (const t of ALL_TOOLS) {
    assert.equal(t.inputSchema.properties?._bypass_key, undefined, `${t.name} registry entry was mutated`);
    assert.ok(!(t.inputSchema.required ?? []).includes("_bypass_key"));
  }
});
