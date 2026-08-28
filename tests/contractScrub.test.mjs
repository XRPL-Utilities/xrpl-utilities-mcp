// --auto-fix splices a value fetched over the network into a TypeScript source
// file that CI then commits and force-pushes, in a repo that publishes to npm.
// A backend response must never be able to close the string literal.

import test from "node:test";
import assert from "node:assert/strict";
import { SCHEMA_VERSION_RE, spliceSchemaVersion, isTransientFetchError } from "../scripts/contract_scrub.mjs";

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
