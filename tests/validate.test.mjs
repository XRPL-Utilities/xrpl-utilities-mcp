// "Could not check" and "checked, all clear" must never produce the same
// result. Before `checked`, an all-backends-down boot reported zero errors and
// the server started announcing schema-verified tools with nothing verified.

import test from "node:test";
import assert from "node:assert/strict";
import { validateAllServices } from "../dist/validate.js";

async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

// A genuinely permanent failure. The old fixture threw "getaddrinfo ENOTFOUND",
// which the corrected predicate reads as transient - these two would still have
// landed on checked:false, but via a retry, for the wrong reason and 750ms
// slower each.
const permanent = () => new TypeError("Invalid URL");

test("an unreachable manifest is reported as NOT CHECKED, not as clean", async () => {
  const results = await withFetch(
    async () => {
      throw permanent();
    },
    () => validateAllServices({ strict: false }),
  );
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.equal(r.checked, false, `${r.service} should be unchecked`);
    assert.equal(r.errors.length, 0, "non-strict keeps it a warning");
    assert.ok(r.warnings.length > 0);
  }
});

test("strict turns an unreadable manifest into an error", async () => {
  const results = await withFetch(
    async () => {
      throw permanent();
    },
    () => validateAllServices({ strict: true }),
  );
  for (const r of results) {
    assert.equal(r.checked, false);
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
  }
});

test("a non-transient error is attempted exactly once", async () => {
  // The other half of the contract: real outages must fail fast, not sit
  // through a retry-and-sleep for every service at boot.
  const attempts = new Map();
  await withFetch(
    async (url) => {
      const key = String(url);
      attempts.set(key, (attempts.get(key) ?? 0) + 1);
      throw permanent();
    },
    () => validateAllServices({ strict: false }),
  );
  assert.ok(attempts.size > 0);
  for (const [url, n] of attempts) {
    assert.equal(n, 1, `${url} should not have been retried`);
  }
});

test("a transient failure gets one retry so strict mode is usable at cold start", async () => {
  // Services are validated in parallel, so count attempts per URL.
  const attempts = new Map();
  const results = await withFetch(
    async (url) => {
      const key = String(url);
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      if (n === 1) throw new Error("The operation was aborted");
      return new Response(JSON.stringify({ schema_version: "0.0.0-test", endpoints: {} }), {
        headers: { "content-type": "application/json" },
      });
    },
    () => validateAllServices({ strict: true }),
  );
  for (const r of results) {
    assert.equal(r.checked, true, `${r.service} should have been read on the retry`);
  }
});

test("a refused connection retries: the cold-start shape Node reports as 'fetch failed'", async () => {
  // The whole point of the retry. undici hides ECONNREFUSED behind an opaque
  // TypeError("fetch failed") and puts the code on .cause, so a
  // message-substring predicate never fired for the case it was written for.
  const attempts = new Map();
  const results = await withFetch(
    async (url) => {
      const key = String(url);
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      if (n === 1) {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" }),
        });
      }
      return new Response(JSON.stringify({ schema_version: "0.0.0-test", endpoints: {} }), {
        headers: { "content-type": "application/json" },
      });
    },
    () => validateAllServices({ strict: true }),
  );
  for (const r of results) {
    assert.equal(r.checked, true, `${r.service} should have been read on the retry`);
  }
});

test("an AggregateError-wrapped DNS failure still retries", async () => {
  // undici wraps multi-address (A + AAAA) connect failures, so the code sits
  // two levels down: cause -> errors[] -> code.
  const attempts = new Map();
  const results = await withFetch(
    async (url) => {
      const key = String(url);
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      if (n === 1) {
        throw new TypeError("fetch failed", {
          cause: new AggregateError([Object.assign(new Error("x"), { code: "ENOTFOUND" })]),
        });
      }
      return new Response(JSON.stringify({ schema_version: "0.0.0-test", endpoints: {} }), {
        headers: { "content-type": "application/json" },
      });
    },
    () => validateAllServices({ strict: true }),
  );
  for (const r of results) {
    assert.equal(r.checked, true, `${r.service} should have been read on the retry`);
  }
});
