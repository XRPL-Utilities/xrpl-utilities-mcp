// --auto-fix splices a value fetched over the network into a TypeScript source
// file that CI then commits and force-pushes, in a repo that publishes to npm.
// A backend response must never be able to close the string literal.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCHEMA_VERSION_RE, spliceSchemaVersion, isTransientFetchError, rateLimitWaitMs, RATE_LIMIT_WAIT_CAP_MS } from "../scripts/contract_scrub.mjs";

const SOURCE = '  knownSchemaVersions: ["1.0.0", "1.1.0"],\n';

test("a well-formed version is appended", () => {
  const out = spliceSchemaVersion(SOURCE, "1.2.0");
  assert.equal(out.ok, true);
  assert.equal(out.source, '  knownSchemaVersions: ["1.0.0", "1.1.0", "1.2.0"],\n');
});

test("a version that closes the literal and injects TypeScript is refused", () => {
  const payload = '1.0", ...]; (globalThis as any).x = process.env; const _z = ["';
  assert.equal(SCHEMA_VERSION_RE.test(payload), false);
  const out = spliceSchemaVersion(SOURCE, payload);
  assert.equal(out.ok, false);
  assert.match(out.reason, /malformed/);
});

test("quotes, backslashes and replacement patterns are refused", () => {
  for (const bad of ['1.0"', "1.0\\", "$&", "$'", "1.0\n2.0", "x".repeat(33), ""]) {
    assert.equal(spliceSchemaVersion(SOURCE, bad).ok, false, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("a non-string schema_version is refused", () => {
  for (const bad of [1, {}, [], null, undefined, true]) {
    assert.equal(spliceSchemaVersion(SOURCE, bad).ok, false);
  }
});

test("an already-known version is a no-op", () => {
  assert.equal(spliceSchemaVersion(SOURCE, "1.1.0").ok, false);
});

test("the scrubber's retry recognises the shape Node actually throws", () => {
  // The scrubber and src/validate.ts share this contract, so a message-only
  // predicate here propagates the defect instead of fixing it: undici reports
  // every connection failure as an opaque TypeError("fetch failed") with the
  // code on .cause.
  assert.equal(
    isTransientFetchError(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" }),
      }),
    ),
    true,
  );
  assert.equal(
    isTransientFetchError(
      new TypeError("fetch failed", {
        cause: new AggregateError([Object.assign(new Error("x"), { code: "ENOTFOUND" })]),
      }),
    ),
    true,
  );
  assert.equal(isTransientFetchError(Object.assign(new Error("x"), { name: "AbortError" })), true);
  // Real outages still fail fast.
  assert.equal(isTransientFetchError(new TypeError("Invalid URL")), false);
  assert.equal(isTransientFetchError(new Error("HTTP 500")), false);
  assert.equal(isTransientFetchError(undefined), false);
});

test("the scrubber and the boot-time validator share one retry classifier", async () => {
  // Both copies were ~20 lines of security-adjacent retry classification, each
  // green against its own fixtures: add a code to one and the daily 08:00 UTC
  // scrubber and the boot validator classify the same undici error
  // differently, which is the drift class the pair was written to remove. The
  // stated reason for the copy - "the scrubber runs from source and must not
  // depend on dist/" - was already untrue: contract_scrub.mjs imports
  // ../dist/services/index.js on its first line.
  const { isTransientFetchError: fromValidate } = await import("../dist/validate.js");
  assert.equal(isTransientFetchError, fromValidate,
    "contract_scrub.mjs has its own copy of isTransientFetchError again");
});

test("contract_scrub.mjs declares no second retry classifier", () => {
  const src = readFileSync(new URL("../scripts/contract_scrub.mjs", import.meta.url), "utf-8");
  assert.equal(/function\s+isTransientFetchError/.test(src), false,
    "a local isTransientFetchError is back in contract_scrub.mjs");
  assert.equal(/TRANSIENT_CODES\s*=/.test(src), false,
    "a local TRANSIENT_CODES table is back in contract_scrub.mjs");
});

// 2026-11-02: the scrub failed on every agent-paid data route (Pulse
// rwa-summary and desk-briefing, Telemetry settlement/series) because public
// CI has no visitor pass. A well-formed 402 offer is a pass; anything else
// still fails.
import { gatedOutcome } from "../scripts/contract_scrub.mjs";

const OFFER = { accepts: [{ payTo: "rTreasury", amount: "0.01" }, { payTo: "0xabc", amount: "10000" }] };

test("a valid 402 offer on a data route counts as up and priced", () => {
  assert.equal(gatedOutcome(402, OFFER), "agent_paid");
});

test("a 402 with no usable offer is not a pass", () => {
  for (const body of [null, {}, { accepts: [] }, { accepts: [{}] }, { accepts: [{ amount: "1" }] }]) {
    assert.equal(gatedOutcome(402, body), null);
  }
});

test("403 passes only on routes marked site-only", () => {
  assert.equal(gatedOutcome(403, {}, { siteOnly: true }), "site_only");
  assert.equal(gatedOutcome(403, {}), null);
  assert.equal(gatedOutcome(500, OFFER), null);
  assert.equal(gatedOutcome(200, OFFER), null);
});

test("address discovery reads the free Sentinel registry, not a paid route", () => {
  const src = readFileSync(new URL("../scripts/contract_scrub.mjs", import.meta.url), "utf8");
  const i = src.indexOf("A live XRPL address for the address-keyed paid tools");
  const block = src.slice(i, i + 900);
  assert.match(block, /sentinel\.xrpl-utilities\.io\/registry\/rwa-issuers/);
  assert.doesNotMatch(block, /fetchJson\("https:\/\/pulse\.xrpl-utilities\.io\/stats\/rwa-summary"\)/);
});

// Pulse's free reads are 30 a minute per client with no Retry-After, and the
// scrubber's own 429s failed the job on 2026-11-03 and 2026-11-05. A 429 must
// be waited out once, not reported as a broken contract.
test("a 429 with no Retry-After waits out a full 60 second window", () => {
  assert.equal(rateLimitWaitMs(429, null), 61_000);
  assert.equal(rateLimitWaitMs(429, undefined), 61_000);
});

test("a 429 honours a numeric Retry-After up to the cap", () => {
  assert.equal(rateLimitWaitMs(429, "5"), 5_000);
  assert.equal(rateLimitWaitMs(429, "9999"), RATE_LIMIT_WAIT_CAP_MS);
});

test("a malformed Retry-After falls back to the full window", () => {
  assert.equal(rateLimitWaitMs(429, "-3"), 61_000);
  assert.equal(rateLimitWaitMs(429, "5abc"), 61_000);
  assert.equal(rateLimitWaitMs(429, "Wed, 21 Oct 2015 07:28:00 GMT"), 61_000);
});

test("anything other than a 429 is not retried for rate limiting", () => {
  for (const s of [200, 402, 403, 500, 502, 503]) assert.equal(rateLimitWaitMs(s, "1"), null);
});
