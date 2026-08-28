// The per-IP limiter is the only access control on the public /mcp endpoint.
// Keying it on the left-most X-Forwarded-For entry keyed it on a value the
// caller types, so a fresh value per request bought a fresh bucket.

import test from "node:test";
import assert from "node:assert/strict";
import { dispatchTool } from "../dist/dispatch.js";

const req = (xff, peer = "10.0.0.1") => ({
  headers: xff === undefined ? {} : { "x-forwarded-for": xff },
  socket: { remoteAddress: peer },
});

test("a spoofed X-Forwarded-For prefix does not change the bucket key", async () => {
  const { clientKey } = await import("../dist/transport/http.js");
  const appended = "203.0.113.7";
  assert.equal(clientKey(req(`1.1.1.1, ${appended}`)), appended);
  assert.equal(clientKey(req(`9.9.9.9, 8.8.8.8, ${appended}`)), appended);
  assert.equal(clientKey(req(appended)), appended);
});

test("a request with no forwarded header falls back to the socket peer", async () => {
  const { clientKey } = await import("../dist/transport/http.js");
  assert.equal(clientKey(req(undefined)), "10.0.0.1");
  assert.equal(clientKey(req("")), "10.0.0.1");
});

test("TRUST_PROXY_HOPS=0 ignores the header entirely", async () => {
  process.env.TRUST_PROXY_HOPS = "0";
  // Query string busts the ESM module cache: the hop count is read at load.
  const { clientKey } = await import("../dist/transport/http.js?hops=0");
  delete process.env.TRUST_PROXY_HOPS;
  assert.equal(clientKey(req("1.1.1.1, 203.0.113.7")), "10.0.0.1");
});

test("a private trusted hop degrades to the first public entry, not to one shared bucket", async () => {
  // TRUST_PROXY_HOPS has not been measured against the live Railway chain. If
  // it is one too low the trusted entry is an internal proxy address and every
  // caller collapses into a single bucket - which turns the failed-bypass
  // lockout into a whole-endpoint outage.
  const { clientKey } = await import("../dist/transport/http.js");
  assert.equal(clientKey(req("203.0.113.7, 10.0.0.9")), "203.0.113.7");
  assert.equal(clientKey(req("203.0.113.7, 10.0.0.9, 172.16.4.4")), "203.0.113.7");
  assert.equal(clientKey(req("::ffff:203.0.113.7, 127.0.0.1")), "203.0.113.7");
  // Nothing public anywhere: fall back to the peer rather than to a bucket key
  // every caller shares.
  assert.equal(clientKey(req("10.0.0.5, 10.0.0.9")), "10.0.0.1");
});

const fakeRes = () => {
  const out = { code: 0, body: null };
  return {
    status(c) { out.code = c; return this; },
    json(b) { out.body = b; return this; },
    seen: out,
  };
};
const mkReq = (peer, body) => ({ headers: {}, socket: { remoteAddress: peer }, body });
// BYPASS_FAIL_LIMIT is 10; one over it is where the lockout engages.
const OVER_BUDGET = 11;

test("the failed-bypass lockout stops guesses without taking the endpoint offline", async () => {
  const { rateLimit, recordBypassFailure, isBypassBlocked } = await import("../dist/transport/http.js");
  const ip = "203.0.113.44";
  for (let i = 0; i < OVER_BUDGET; i += 1) recordBypassFailure(ip);
  assert.equal(isBypassBlocked(ip), true);

  // tools/list, initialize, free tools and paid x402 calls carry no key and
  // must keep flowing: otherwise eleven wrong guesses are an outage for
  // everyone sharing the bucket key.
  const open = fakeRes();
  assert.equal(rateLimit(mkReq(ip, { jsonrpc: "2.0", id: 1, method: "tools/list" }), open), true);
  assert.equal(open.seen.code, 0);

  // A request that actually carries a key is refused.
  const guess = fakeRes();
  const call = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "xrpl_vault_scan", arguments: { _bypass_key: "g" } } };
  assert.equal(rateLimit(mkReq(ip, call), guess), false);
  assert.equal(guess.seen.code, 429);

  // Including when it is buried in a batch.
  const batched = fakeRes();
  assert.equal(rateLimit(mkReq(ip, [{ jsonrpc: "2.0", id: 3, method: "tools/list" }, call]), batched), false);
  assert.equal(batched.seen.code, 429);
});

test("a batched body is charged as N requests, not one", async () => {
  // One POST carries thousands of messages at the 1mb body cap; counting it as
  // a single request made the 60/min limit meaningless for batch callers.
  const { rateLimit } = await import("../dist/transport/http.js");
  const ip = "203.0.113.55";
  const batch = Array.from({ length: 20 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "tools/list" }));
  for (let i = 0; i < 3; i += 1) {
    assert.equal(rateLimit(mkReq(ip, batch), fakeRes()), true, `batch ${i} should fit in the window`);
  }
  const over = fakeRes();
  assert.equal(rateLimit(mkReq(ip, batch), over), false);
  assert.equal(over.seen.code, 429);
});

test("the over-budget alert fires once, and cannot be stepped over", async () => {
  const { recordBypassFailure } = await import("../dist/transport/http.js");
  const real = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(" "));
  try {
    for (let i = 0; i < 25; i += 1) recordBypassFailure("203.0.113.66");
  } finally {
    console.error = real;
  }
  assert.equal(lines.filter((l) => l.includes("exceeded the failed _bypass_key budget")).length, 1);
});

test("a caller past the budget is refused at the guess, before any compare or fetch", async () => {
  // The budget was only checked at the start of an HTTP request, so one batched
  // POST spent thousands of guesses before the lockout could apply. Gating only
  // the failure branch would not have fixed it either: the compare stays
  // reachable, so a blocked caller who finally guesses right is still granted.
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async (...a) => {
    fetched += 1;
    return realFetch(...a);
  };
  try {
    for (const key of ["guess", "operator-key"]) {
      let failures = 0;
      await assert.rejects(
        () =>
          dispatchTool(
            "xrpl_vault_scan",
            { issuer: "RLUSD", _bypass_key: key },
            { bypassKey: "operator-key", onBypassFailure: () => (failures += 1), isBypassBlocked: () => true },
          ),
        /bypass key attempts exhausted/,
        `${key} should be refused while blocked`,
      );
      assert.equal(failures, 0, "a refused guess is not counted twice");
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(fetched, 0, "a blocked caller must not reach the upstream service");
});
