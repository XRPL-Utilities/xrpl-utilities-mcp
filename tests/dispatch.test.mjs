// Regression cover for tool-argument validation. The low-level MCP Server does
// no argument checking, so before these guards every declared pattern, limit
// and closed schema was advisory and raw values reached the upstream URL.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dispatchTool } from "../dist/dispatch.js";

async function withUpstream(handler, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url, method: req.method, headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(handler ?? { ok: true }));
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

test("a '..' path parameter is rejected instead of retargeting the service root", async () => {
  // /status/.. normalizes to the service root, so the tool would have returned
  // the root banner as a successful invoice poll. invoice_id declares no
  // pattern, so only the unconditional path guard catches this one.
  await assert.rejects(
    () => dispatchTool("xrpl_telemetry_get_status", { invoice_id: ".." }),
    /invalid value for path parameter invoice_id/,
  );
  // The trust tools also declare a pattern, so either layer may reject first;
  // what matters is that neither value ever reaches the URL builder.
  await assert.rejects(
    () => dispatchTool("xrpl_trust_get_domain", { domain_id: ".." }),
    /invalid value for (path parameter )?domain_id/,
  );
  await assert.rejects(
    () => dispatchTool("xrpl_trust_operator_drilldown", { owner_address: "a/b" }),
    /invalid value for (path parameter )?owner_address/,
  );
});

test("a declared pattern is enforced", async () => {
  await assert.rejects(
    () => dispatchTool("xrpl_sentinel_scan", { address: "not-an-address" }),
    /invalid value for address/,
  );
});

test("a declared maximum is enforced", async () => {
  await assert.rejects(
    () => dispatchTool("xrpl_pulse_recent_events", { limit: 9999 }),
    /must be <= 500/,
  );
});

test("a bodyless probe still reaches the service so the caller gets the 402", async () => {
  // Required args are not enforced locally: probing a paid tool with no args to
  // get the real challenge back is a supported discovery move.
  await withUpstream({ ok: true }, async (base, seen) => {
    await dispatchTool("xrpl_vault_scan", {}, { baseUrlOverride: () => base });
    assert.equal(seen.length, 1);
  });
});

test("unknown args are dropped, reserved args survive and still authenticate", async () => {
  await withUpstream({ ok: true }, async (base, seen) => {
    await dispatchTool(
      "xrpl_vault_scan",
      { issuer: "RLUSD", not_a_real_field: "injected", _bypass_key: "operator-key" },
      { baseUrlOverride: () => base, bypassKey: "operator-key" },
    );
    assert.equal(seen.length, 1);
    assert.deepEqual(JSON.parse(seen[0].body), { issuer: "RLUSD" });
    // _bypass_key is not declared on any tool schema, so the unknown-key drop
    // must exempt it or the documented operator bypass silently stops working.
    assert.equal(seen[0].headers["payment-signature"], "operator-key");
  });
});

test("a wrong _bypass_key is reported so the transport can budget guesses", async () => {
  await withUpstream({ ok: true }, async (base) => {
    let failures = 0;
    await dispatchTool(
      "xrpl_vault_scan",
      { issuer: "RLUSD", _bypass_key: "guess" },
      { baseUrlOverride: () => base, bypassKey: "operator-key", onBypassFailure: () => (failures += 1) },
    );
    assert.equal(failures, 1);
  });
});

test("numeric args sent as strings are still accepted", async () => {
  // LLM clients routinely send "10" for an integer arg and the backends coerce
  // it; rejecting that would break working callers without closing anything.
  await withUpstream({ ok: true }, async (base, seen) => {
    await dispatchTool("xrpl_vault_daily_flow", { days: "7" }, { baseUrlOverride: () => base });
    assert.match(seen[0].url, /days=7/);
  });
});
