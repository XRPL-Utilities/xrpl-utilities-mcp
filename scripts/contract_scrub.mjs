#!/usr/bin/env node
// Contract-drift scrubber for the XR-* portfolio.
//
// Walks every MCP tool exported by SERVICES, calls the backend it points
// at, and asserts:
//   1. Free tools     -> HTTP 200, JSON body, schema_version (when present)
//                        is listed in knownSchemaVersions.
//   2. Paid tools     -> HTTP 402 challenge (proves the gate is still up).
//   3. agents.json    -> 200 + live schema_version is in knownSchemaVersions.
//
// Plus a hand-maintained list of cross-service edges (Pulse reading from
// Telemetry, XR-Desk reading from Pulse, etc.) where one service hard-codes
// field names from another. Each entry asserts the producing endpoint
// returns the specific fields the consumer reads.
//
// Exit code is 0 when every check passes, non-zero otherwise. The GitHub
// Action wraps this and opens an Issue on failure.
//
// Run locally:  npm run build && node scripts/contract_scrub.mjs

import { SERVICES, ALL_TOOLS } from "../dist/services/index.js";

const TIMEOUT_MS = 15_000;

let pass = 0;
let fail = 0;
const failures = [];

function ok(label) {
  pass += 1;
  console.log(`PASS  ${label}`);
}

function bad(label, reason) {
  fail += 1;
  failures.push(`${label} — ${reason}`);
  console.log(`FAIL  ${label} — ${reason}`);
}

async function fetchJsonOnce(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, init = {}) {
  // One retry on transient timeout/abort/network error. Real outages still
  // fail twice in a row; cold-start blips on freshly-deployed services
  // (Pulse, Telemetry, Trust) get a second chance.
  try {
    return await fetchJsonOnce(url, init);
  } catch (e) {
    const msg = e?.message || String(e);
    const transient = msg.includes("aborted") || msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET");
    if (!transient) throw e;
    return await fetchJsonOnce(url, init);
  }
}

function pickPath(tmpl, args) {
  return tmpl.replace(/\{([^}]+)\}/g, (_, k) => encodeURIComponent(args[k] ?? ""));
}

function buildQueryString(args) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// Minimal arg synthesis from a JSONSchema-ish inputSchema. We only need
// defaults so the request is well-formed; the goal is "did the call work,"
// not "did we enumerate every shape." Anything required without a default
// is left blank — those tools are documented separately in NEEDS_INPUT and
// validated with a hardcoded arg map.
function synthesizeArgs(schema) {
  const args = {};
  const props = schema?.properties || {};
  for (const [name, spec] of Object.entries(props)) {
    if (spec.default !== undefined) {
      args[name] = spec.default;
    } else if (Array.isArray(spec.enum) && spec.enum.length) {
      args[name] = spec.enum[0];
    } else if (spec.type === "integer" && typeof spec.minimum === "number") {
      args[name] = spec.minimum;
    }
  }
  return args;
}

// Tools that require an input the schema doesn't default — provide one
// here so the scrubber can issue a sensible request.
const TOOL_ARG_OVERRIDES = {
  // Stateful invoice polling — no fixture; covered by the paid /scan check
  // on the same service.
  xrpl_telemetry_get_status: { __skip: "stateful invoice poll, no fixture" },
  xrpl_telemetry_get_results: { __skip: "stateful invoice poll, no fixture" },
  xrpl_pulse_get_status: { __skip: "stateful invoice poll, no fixture" },
  xrpl_pulse_get_results: { __skip: "stateful invoice poll, no fixture" },
  // Path-param tools without a deterministic fixture. Skipped here; the
  // free index/list endpoint of the same service validates the listing
  // is alive.
  xrpl_trust_get_domain: { __skip: "needs real 64-hex domain_id fixture" },
  xrpl_trust_operator_drilldown: { __skip: "needs real operator address fixture" },
  xrpl_trust_operator_attribution: { __skip: "needs real operator address fixture" },
};

async function checkAgentsJson(service) {
  const label = `agents.json :: ${service.id}`;
  try {
    const { status, body } = await fetchJson(service.manifestUrl);
    if (status !== 200) return bad(label, `HTTP ${status}`);
    if (!body || typeof body !== "object") return bad(label, "no JSON body");
    const live = body.schema_version;
    if (!live) return bad(label, "missing schema_version");
    if (!service.knownSchemaVersions.includes(live)) {
      return bad(label, `live schema ${live} not in MCP knownSchemaVersions[last=${service.knownSchemaVersions.at(-1)}] — bump src/services/${service.id}.ts`);
    }
    ok(`${label} schema=${live}`);
  } catch (e) {
    bad(label, e.message || String(e));
  }
}

async function checkTool(tool) {
  const label = `tool :: ${tool.name}`;
  const overrides = TOOL_ARG_OVERRIDES[tool.name];
  if (overrides?.__skip) {
    console.log(`SKIP  ${label} — ${overrides.__skip}`);
    return;
  }
  const args = { ...synthesizeArgs(tool.inputSchema), ...(overrides || {}) };
  const method = (tool.method || "GET").toUpperCase();
  let path = pickPath(tool.path, args);
  const remaining = { ...args };
  // Drop path-template keys from query/body params.
  for (const k of Object.keys(args)) {
    if (tool.path.includes(`{${k}}`)) delete remaining[k];
  }
  let url = tool._baseUrl + path;
  const init = { method, headers: {} };
  if (method === "GET") {
    url += buildQueryString(remaining);
  } else if (tool.bodyFromArgs) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(remaining);
  }
  try {
    const { status, body } = await fetchJson(url, init);
    // inline_x402 = payment must accompany the request. 402 is the canonical
    // challenge; 422 is "body validation tripped before the payment dep
    // ran" (FastAPI/Pydantic order). Both prove the endpoint is alive +
    // still paid. 200 means the gate dropped — a real regression.
    if (tool.authMode === "inline_x402") {
      if (status === 402 || status === 422) return ok(`${label} (paid, got ${status})`);
      if (status === 200) return bad(label, `paid tool returned 200 — payment gate dropped?`);
      return bad(label, `expected 402/422 challenge, got ${status}`);
    }
    // async_invoice covers a 3-step flow: get_quote (free, returns invoice
    // metadata), get_status, get_results. The quote step is intentionally
    // free; poll steps are skipped above.
    if (tool.authMode === "async_invoice") {
      if (status === 200) return ok(`${label} (async_invoice quote, got 200)`);
      return bad(label, `expected 200 on quote step, got ${status}`);
    }
    if (status !== 200) return bad(label, `HTTP ${status}`);
    if (body === null) return bad(label, "non-JSON response");
    ok(label);
  } catch (e) {
    bad(label, e.message || String(e));
  }
}

// Cross-service edges: places where one service hard-codes a field name
// from another. Update this list when you wire a new service call.
const CROSS_SERVICE_EDGES = [
  {
    label: "Pulse briefing.py -> Telemetry /settlement/totals",
    url: "https://telemetry.xrpl-utilities.io/settlement/totals",
    requiredFields: [
      "volume_24h_usd", "volume_24h_rlusd_usd",
      "volume_7d_usd", "volume_30d_usd",
      "annualized_run_rate_usd", "annualized_run_rate_30d_usd",
      "permissioned_share_30d_pct",
    ],
  },
  {
    label: "XR-Desk index.html -> Pulse /stats/desk-briefing",
    url: "https://pulse.xrpl-utilities.io/stats/desk-briefing",
    requiredFields: ["market_posture", "headline", "sections"],
    requiredNested: {
      sections: ["positioning", "stablecoin_health", "supply_pressure",
                 "rwa_market", "whale_activity", "network_settlement"],
    },
  },
  {
    label: "XR-Desk index.html -> Pulse /stats/desk-trends",
    url: "https://pulse.xrpl-utilities.io/stats/desk-trends?days=7",
    requiredFields: ["series"],
    requiredNested: {
      series: ["rlusd_velocity_24h", "rlusd_circulating", "xrp_price_usd",
               "exchange_net_flow_usd", "whale_volume_usd",
               "settlement_volume_24h_usd", "whale_coverage_24h_pct"],
    },
  },
  {
    label: "XR-Vault -> Pulse /stats/rwa-summary",
    url: "https://pulse.xrpl-utilities.io/stats/rwa-summary",
    requiredFields: ["issuers", "totals", "stablecoin_velocity"],
  },
  {
    label: "Pulse pulse/index.html -> Telemetry /settlement/series",
    url: "https://telemetry.xrpl-utilities.io/settlement/series?bucket=daily&count=3",
    requiredFields: ["series", "bucket", "count"],
    extraCheck: (body) => {
      if (!Array.isArray(body.series)) return "series is not an array";
      if (body.series.length === 0) return "series is empty";
      const row = body.series[0];
      for (const f of ["bucket_start_ts", "total_usd", "payments_count"]) {
        if (!(f in row)) return `series[0] missing ${f}`;
      }
      return null;
    },
  },
  {
    // Param-sanity: if the endpoint silently ignores bucket=monthly we'd
    // get the daily default. Catch the exact class of bug the MCP
    // settlement_series schema mismatch fell into.
    label: "param-sanity :: Telemetry /settlement/series bucket=monthly vs daily",
    url: "https://telemetry.xrpl-utilities.io/settlement/series?bucket=monthly&count=2",
    requiredFields: ["bucket"],
    extraCheck: (body) => body.bucket === "monthly" ? null : `expected bucket=monthly in response, got ${body.bucket}`,
  },
];

function deepFieldCheck(label, body, fields, nested = {}) {
  for (const f of fields) {
    if (!(f in body)) return bad(label, `missing field ${f}`);
  }
  for (const [parent, children] of Object.entries(nested)) {
    const sub = body[parent];
    if (!sub || typeof sub !== "object") return bad(label, `${parent} is not an object`);
    for (const c of children) {
      if (!(c in sub)) return bad(label, `${parent}.${c} missing`);
    }
  }
  ok(label);
}

async function checkEdge(edge) {
  try {
    const { status, body } = await fetchJson(edge.url);
    if (status !== 200) return bad(edge.label, `HTTP ${status}`);
    if (!body || typeof body !== "object") return bad(edge.label, "no JSON body");
    // Detect the silent-fallback shape before per-field checks
    if (edge.extraCheck) {
      const reason = edge.extraCheck(body);
      if (reason) return bad(edge.label, reason);
    }
    deepFieldCheck(edge.label, body, edge.requiredFields || [], edge.requiredNested || {});
  } catch (e) {
    bad(edge.label, e.message || String(e));
  }
}

async function main() {
  console.log(`Contract scrub at ${new Date().toISOString()}\n`);

  console.log("== Manifest schema-version drift ==");
  for (const s of SERVICES) {
    await checkAgentsJson(s);
  }

  console.log("\n== MCP tool endpoints ==");
  for (const tool of ALL_TOOLS) {
    await checkTool(tool);
  }

  console.log("\n== Cross-service edges ==");
  for (const edge of CROSS_SERVICE_EDGES) {
    await checkEdge(edge);
  }

  console.log(`\n----------------------------------------`);
  console.log(`Total: ${pass} pass, ${fail} fail`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("scrubber crashed:", e);
  process.exit(2);
});
