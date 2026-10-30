// Standard x402-over-MCP (spec transports-v2/mcp.md). Before this, a paid tool
// only took a custom payment_signature argument and returned the backend's 402
// as ordinary content, so a standard x402 MCP client could not pay at all.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { dispatchToolDetailed } from "../dist/dispatch.js";
import { buildServer } from "../dist/server.js";
import { encodeForBackend, MCP_PUBLIC_URL } from "../dist/x402mcp.js";

const CHALLENGE = {
  x402Version: 2,
  resource: { url: "https://vault.xrpl-utilities.io/scan", description: "Vault", mimeType: "application/json" },
  extensions: { bazaar: { info: { input: { type: "http", method: "POST" } }, schema: {} } },
  accepts: [{ scheme: "exact", network: "eip155:8453", amount: "100000", asset: "0xA", payTo: "0xB" }],
};
const SETTLED = { success: true, transaction: "0xabc", network: "eip155:8453", payer: "0xC" };

function b64(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}
function unb64(s) {
  return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
}
function basePayload(extra = {}) {
  return {
    x402Version: 2,
    resource: { url: "https://somewhere.example/else" },
    accepted: { scheme: "exact", network: "eip155:8453" },
    payload: { signature: "0xsig", authorization: { from: "0xC", to: "0xB", value: "100000", nonce: "0x1" } },
    ...extra,
  };
}

// Upstream that answers 402 until it sees PAYMENT-SIGNATURE, then 200 + PAYMENT-RESPONSE.
async function withPaidUpstream(fn) {
  const seen = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push({ url: req.url, headers: req.headers });
      if (!req.headers["payment-signature"]) {
        res.writeHead(402, { "content-type": "application/json", "payment-required": b64(CHALLENGE) });
        res.end(JSON.stringify(CHALLENGE));
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "payment-response": b64(SETTLED) });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base, seen);
  } finally {
    server.close();
  }
}

test("a Base payload keeps the MCP tool URL as its resource", () => {
  const out = unb64(encodeForBackend(basePayload(), "xrpl_vault_scan", "https://vault/scan"));
  assert.equal(out.resource.url, `${MCP_PUBLIC_URL}#xrpl_vault_scan`);
  assert.deepEqual(out.payload, basePayload().payload);
});

test("an XRPL payload gets the backend route URL back", () => {
  const xrpl = basePayload({ accepted: { scheme: "exact", network: "xrpl:0" } });
  const out = unb64(encodeForBackend(xrpl, "xrpl_vault_scan", "https://vault/scan"));
  assert.equal(out.resource.url, "https://vault/scan");
});

test("a non-object or oversized payment is refused", () => {
  assert.throws(() => encodeForBackend("not-an-object", "t", "u"), /PaymentPayload object/);
  const huge = basePayload({ pad: "x".repeat(20_000) });
  assert.throws(() => encodeForBackend(huge, "t", "u"), /too large/);
});

test("a 402 becomes a PaymentRequired naming the MCP tool", async () => {
  await withPaidUpstream(async (base) => {
    const out = await dispatchToolDetailed("xrpl_vault_scan", {}, { baseUrlOverride: () => base });
    assert.equal(out.status, 402);
    assert.equal(out.paymentRequired.resource.url, MCP_PUBLIC_URL);
    assert.deepEqual(out.paymentRequired.accepts, CHALLENGE.accepts);
    // The backend's http declaration must not leak out at the MCP URL.
    const input = out.paymentRequired.extensions.bazaar.info.input;
    assert.equal(input.type, "mcp");
    assert.equal(input.toolName, "xrpl_vault_scan");
    assert.equal(input.transport, "streamable-http");
    assert.ok(!("payment_signature" in (input.inputSchema.properties ?? {})));
    assert.ok(!(input.inputSchema.required ?? []).includes("payment_signature"));
  });
});

test("_meta payment wins over payment_signature and the settlement is decoded", async () => {
  await withPaidUpstream(async (base, seen) => {
    const out = await dispatchToolDetailed(
      "xrpl_vault_scan",
      { payment_signature: b64({ other: true }) },
      { baseUrlOverride: () => base },
      basePayload(),
    );
    assert.equal(out.status, 200);
    assert.deepEqual(out.paymentResponse, SETTLED);
    const sent = unb64(seen[0].headers["payment-signature"]);
    assert.equal(sent.accepted.network, "eip155:8453");
    assert.equal(sent.resource.url, `${MCP_PUBLIC_URL}#xrpl_vault_scan`);
  });
});

test("a payment_signature that is not base64 JSON is forwarded untouched", async () => {
  await withPaidUpstream(async (base, seen) => {
    await dispatchToolDetailed("xrpl_vault_scan", { payment_signature: "opaque-token" }, { baseUrlOverride: () => base });
    assert.equal(seen[0].headers["payment-signature"], "opaque-token");
  });
});

test("end to end over MCP: challenge, pay via _meta, settlement in _meta", async () => {
  await withPaidUpstream(async (base) => {
    const server = buildServer({ baseUrlOverride: () => base });
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const unpaid = await client.callTool({ name: "xrpl_vault_scan", arguments: {} });
      assert.equal(unpaid.isError, true);
      assert.equal(unpaid.structuredContent.resource.url, MCP_PUBLIC_URL);
      assert.equal(unpaid.structuredContent.extensions.bazaar.info.input.type, "mcp");
      assert.deepEqual(JSON.parse(unpaid.content[0].text), unpaid.structuredContent);

      const paid = await client.callTool({
        name: "xrpl_vault_scan",
        arguments: {},
        _meta: { "x402/payment": basePayload() },
      });
      assert.ok(!paid.isError);
      assert.deepEqual(paid._meta["x402/payment-response"], SETTLED);
    } finally {
      await client.close();
    }
  });
});
