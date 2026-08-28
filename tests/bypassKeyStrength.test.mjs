// A weak operator bypass key must stop the public HTTP transport from booting.
//
// This was a console.error and nothing more. That left the two per-IP budgets
// in http.ts as the only thing standing between a short MCP_BYPASS_KEY and an
// online guesser, on an endpoint anyone can reach. The Python services already
// take the stronger line for the equivalent secret: x402_baseline.py raises at
// import when X402_REPLAY_HMAC_KEY is under 32 bytes. This pins the same floor
// here, and pins that the refusal happens before anything binds a port.
//
// Hermetic: no network, no sleeps, no listener.

import { test } from "node:test";
import assert from "node:assert/strict";

const { assertBypassKeyStrength, MIN_BYPASS_KEY_BYTES, runHttp } = await import(
  "../dist/transport/http.js"
);

test("the floor is 32 bytes", () => {
  assert.equal(MIN_BYPASS_KEY_BYTES, 32);
});

test("a short bypass key is refused, not warned about", () => {
  assert.throws(() => assertBypassKeyStrength("operator-key"), /MCP_BYPASS_KEY/);
  assert.throws(() => assertBypassKeyStrength("x"), /MCP_BYPASS_KEY/);
  // One byte under the floor is still under it.
  assert.throws(() => assertBypassKeyStrength("a".repeat(31)), /MCP_BYPASS_KEY/);
});

test("a key at or over the floor boots, and an unset key boots", () => {
  assert.doesNotThrow(() => assertBypassKeyStrength("a".repeat(32)));
  assert.doesNotThrow(() => assertBypassKeyStrength("a".repeat(64)));
  assert.doesNotThrow(() => assertBypassKeyStrength(undefined));
  assert.doesNotThrow(() => assertBypassKeyStrength(""));
});

test("the floor is bytes, not characters", () => {
  // 16 characters, 48 UTF-8 bytes. Measuring .length would reject a key that
  // carries well over the required entropy.
  assert.doesNotThrow(() => assertBypassKeyStrength("é".repeat(32)));
  assert.doesNotThrow(() => assertBypassKeyStrength("中".repeat(16)));
});

test("the refusal says what to do and never echoes the key", () => {
  const secret = "hunter2-short-operator-key";
  let msg = "";
  try {
    assertBypassKeyStrength(secret);
  } catch (e) {
    msg = e.message;
  }
  assert.ok(msg, "expected a refusal");
  assert.ok(!msg.includes(secret), "the refusal must not echo the key value");
  assert.match(msg, /openssl rand -hex 32/, "must say how to generate one");
  assert.match(msg, /unset MCP_BYPASS_KEY/, "must say how to opt out");
  assert.match(msg, new RegExp(`${secret.length} bytes`), "may report the length");
});

test("runHttp refuses before it binds a port", async () => {
  const prev = process.env["MCP_BYPASS_KEY"];
  process.env["MCP_BYPASS_KEY"] = "too-short";
  let refusal = null;
  try {
    // Port 0 would bind an ephemeral port if the guard were not the first
    // statement in runHttp. A rejection is what proves nothing listened.
    await runHttp(0);
  } catch (e) {
    refusal = e;
  } finally {
    if (prev === undefined) delete process.env["MCP_BYPASS_KEY"];
    else process.env["MCP_BYPASS_KEY"] = prev;
    // Without the guard runHttp resolves and leaves a listening server holding
    // the event loop open, which would hang this file instead of failing it.
    // Close whatever it bound so the assertion below is what gets reported.
    for (const h of process._getActiveHandles?.() ?? []) {
      if (h && typeof h.close === "function" && typeof h.address === "function") {
        try {
          h.unref?.();
          h.close();
        } catch {
          /* already closing */
        }
      }
    }
  }
  assert.ok(refusal, "runHttp must refuse to boot behind a short key");
  assert.match(refusal.message, /MCP_BYPASS_KEY is 9 bytes/);
});
