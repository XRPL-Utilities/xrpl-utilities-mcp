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
// One definition of "the connection did not happen", shared with the boot-time
// validator. The scrubber already runs from dist/ (the import above), so the
// copy that used to live here bought nothing and left two security-adjacent
// retry classifiers to drift apart - each green against its own fixtures.
// Re-exported so tests/contractScrub.test.mjs keeps exercising it through this
// module's surface.
import { isTransientFetchError } from "../dist/validate.js";
export { isTransientFetchError };
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const TIMEOUT_MS = 15_000;

// schema_version arrives over the network and --auto-fix splices it into a
// TypeScript source file that CI then commits and pushes. Anything outside this
// allowlist (a quote, a backslash, a `$&` replacement pattern) either corrupts
// the file or closes the string literal and injects code into a repo that
// publishes to npm. One definition, used at ingest and again at the write.
export const SCHEMA_VERSION_RE = /^[0-9A-Za-z._-]{1,32}$/;
const KNOWN_SCHEMA_RE = /(knownSchemaVersions:\s*\[)([^\]]*)(\])/;

/**
 * Append one live schema_version to a service module's knownSchemaVersions.
 * Pure so the guard is testable: `before` in, `{ ok, source, reason }` out.
 * The replacement is built by a function callback, not a replacement string —
 * `$&`, `$'` and friends are honoured in the string form and would splice
 * response bytes into the source file.
 */
export function spliceSchemaVersion(before, addVersion) {
  if (typeof addVersion !== "string" || !SCHEMA_VERSION_RE.test(addVersion)) {
    return { ok: false, reason: "refusing to write malformed version" };
  }
  const m = before.match(KNOWN_SCHEMA_RE);
  if (!m) return { ok: false, reason: "knownSchemaVersions array not found" };
  if (m[2].includes(`"${addVersion}"`)) {
    return { ok: false, reason: `${addVersion} already in array, skipping` };
  }
  return { ok: true, source: before.replace(KNOWN_SCHEMA_RE, (_m, a, b, c) => `${a}${b}, "${addVersion}"${c}`) };
}

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
    if (!isTransientFetchError(e)) throw e;
    // Cold containers need real time to come up; an immediate retry re-hits
    // the same refused socket.
    await new Promise((r) => setTimeout(r, 750));
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
// here so the scrubber can issue a sensible request. Some are populated
// dynamically by discoverFixtures() before the tool loop runs.
const TOOL_ARG_OVERRIDES = {
  // Stateful invoice polling — no fixture; covered by the paid /scan check
  // on the same service.
  xrpl_telemetry_get_status: { __skip: "stateful invoice poll, no fixture" },
  xrpl_telemetry_get_results: { __skip: "stateful invoice poll, no fixture" },
  xrpl_pulse_get_status: { __skip: "stateful invoice poll, no fixture" },
  xrpl_pulse_get_results: { __skip: "stateful invoice poll, no fixture" },
  // Paid POST tools whose required arg has no schema default. Sent bodyless
  // they 422 at the request model, which proved nothing about the payment
  // gate; with a real fixture the request reaches the gate and must 402.
  xrpl_vault_scan: { issuer: "RLUSD" },
  xrpl_flows_scan: { ticker: "XRP" },
  // Trust path-param tools and the address-keyed paid tools are populated by
  // discoverFixtures() from the free index/event endpoints. If discovery
  // fails, the __skip is set there so the scrubber surfaces a clear reason
  // instead of a 404.
};

// Tools whose fixture comes from discovery and therefore may be absent.
const ADDRESS_FIXTURE_TOOLS = [
  "xrpl_sentinel_scan",
  "xrpl_sentinel_scan_history",
  "xrpl_pulse_events_by_address",
];

// Pulls live values off free endpoints so the scrubber can exercise tools
// that take an opaque path param (domain_id, operator address). Self-
// maintaining: no hardcoded addresses to rot. If a discovery step fails
// the affected tool falls back to SKIP with a clear reason.
async function discoverFixtures() {
  console.log("== Discovering fixtures from free endpoints ==");

  // Trust operator address — first row of the free operator index
  try {
    const { status, body } = await fetchJson(
      "https://trust.xrpl-utilities.io/permissioned-domains/operators/index?limit=1"
    );
    const op = body?.operators?.[0]?.operator_address;
    if (status === 200 && op) {
      TOOL_ARG_OVERRIDES.xrpl_trust_operator_drilldown = { owner_address: op };
      TOOL_ARG_OVERRIDES.xrpl_trust_operator_attribution = { operator_address: op };
      console.log(`  + operator_address = ${op}`);
    } else {
      const reason = `discovery failed (operators index status=${status})`;
      TOOL_ARG_OVERRIDES.xrpl_trust_operator_drilldown = { __skip: reason };
      TOOL_ARG_OVERRIDES.xrpl_trust_operator_attribution = { __skip: reason };
      console.log(`  ! operator_address: ${reason}`);
    }
  } catch (e) {
    const reason = `discovery exception: ${e.message || e}`;
    TOOL_ARG_OVERRIDES.xrpl_trust_operator_drilldown = { __skip: reason };
    TOOL_ARG_OVERRIDES.xrpl_trust_operator_attribution = { __skip: reason };
    console.log(`  ! operator_address: ${reason}`);
  }

  // Trust domain_id — first event in /events with a non-null domain_id
  try {
    const { status, body } = await fetchJson(
      "https://trust.xrpl-utilities.io/events?limit=50"
    );
    const evs = Array.isArray(body?.events) ? body.events : [];
    const ev = evs.find((e) => e?.domain_id);
    if (status === 200 && ev?.domain_id) {
      TOOL_ARG_OVERRIDES.xrpl_trust_get_domain = { domain_id: ev.domain_id };
      console.log(`  + domain_id      = ${ev.domain_id}`);
    } else {
      const reason = `discovery found no domain_id in /events (status=${status}, events=${evs.length})`;
      TOOL_ARG_OVERRIDES.xrpl_trust_get_domain = { __skip: reason };
      console.log(`  ! domain_id: ${reason}`);
    }
  } catch (e) {
    const reason = `discovery exception: ${e.message || e}`;
    TOOL_ARG_OVERRIDES.xrpl_trust_get_domain = { __skip: reason };
    console.log(`  ! domain_id: ${reason}`);
  }
  // A live XRPL address for the address-keyed paid tools. Sourced from the
  // Pulse RWA issuer map so there is no hardcoded address to rot.
  try {
    const { status, body } = await fetchJson("https://pulse.xrpl-utilities.io/stats/rwa-summary");
    const addr = body?.issuers?.find((i) => i?.wallet)?.wallet;
    if (status === 200 && addr) {
      for (const t of ADDRESS_FIXTURE_TOOLS) TOOL_ARG_OVERRIDES[t] = { address: addr };
      console.log(`  + address        = ${addr}`);
    } else {
      const reason = `discovery found no issuer wallet in rwa-summary (status=${status})`;
      for (const t of ADDRESS_FIXTURE_TOOLS) TOOL_ARG_OVERRIDES[t] = { __skip: reason };
      console.log(`  ! address: ${reason}`);
    }
  } catch (e) {
    const reason = `discovery exception: ${e.message || e}`;
    for (const t of ADDRESS_FIXTURE_TOOLS) TOOL_ARG_OVERRIDES[t] = { __skip: reason };
    console.log(`  ! address: ${reason}`);
  }

  console.log("");
}

async function checkAgentsJson(service) {
  const label = `agents.json :: ${service.id}`;
  try {
    const { status, body } = await fetchJson(service.manifestUrl);
    if (status !== 200) return bad(label, `HTTP ${status}`);
    if (!body || typeof body !== "object") return bad(label, "no JSON body");
    const live = body.schema_version;
    if (!live) return bad(label, "missing schema_version");
    if (typeof live !== "string" || !SCHEMA_VERSION_RE.test(live)) {
      // bad() exits 1, which opens the drift Issue for a human. Never exit 2,
      // which is the path that commits and pushes.
      return bad(label, "malformed schema_version (refusing to auto-fix)");
    }
    if (!service.knownSchemaVersions.includes(live)) {
      schemaFixes.push({ serviceId: service.id, addVersion: live });
      return bad(label, `live schema ${live} not in MCP knownSchemaVersions[last=${service.knownSchemaVersions.at(-1)}] — bump src/services/${service.id}.ts`);
    }
    ok(`${label} schema=${live}`);
  } catch (e) {
    bad(label, e.message || String(e));
  }
}

// Every required arg present means the request reaches the payment gate rather
// than the request model. payment_signature / _bypass_key are transport-only
// and never part of a fixture.
function requiredArgsSatisfied(tool, args) {
  const required = tool.inputSchema?.required || [];
  return required
    .filter((k) => k !== "payment_signature" && k !== "_bypass_key")
    .every((k) => args[k] !== undefined && args[k] !== "");
}

// The 402 challenge should name the resource that was actually called. Live
// Pulse /events/by-address advertises resource.url = .../events/recent. That is
// real drift, but it is the backend's to fix and failing the daily scrub on it
// would bury every other check, so it is a warning, not a failure.
function warnOnChallengeUrlDrift(label, url, body) {
  const res = body?.resource ?? body?.accepts?.[0]?.resource;
  const advertised = typeof res === "string" ? res : res?.url;
  if (typeof advertised !== "string") return;
  if (advertised.split("?")[0] !== url.split("?")[0]) {
    console.log(`WARN  ${label} — 402 challenge advertises resource ${advertised}, called ${url}`);
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
    // inline_x402 = payment must accompany the request. 402 is the only status
    // that proves the runtime payment check still runs. A bodyless probe also
    // 402s — every paid service installs a RequestValidationError shim that
    // returns 402 for one — so a 402 without a fixture proves only that the
    // path is listed in that service's _PAID_PATHS. Hence: with every required
    // arg supplied, 402 is the only pass and 422 means the fixture went stale;
    // without a fixture, SKIP rather than score an unproven PASS. 200 means the
    // gate dropped — the regression this check exists for.
    if (tool.authMode === "inline_x402") {
      if (status === 200) return bad(label, `paid tool returned 200 — payment gate dropped?`);
      if (!requiredArgsSatisfied(tool, args)) {
        console.log(`SKIP  ${label} — no fixture for required args, gate not provable (got ${status})`);
        return;
      }
      if (status === 402) {
        warnOnChallengeUrlDrift(label, url, body);
        return ok(`${label} (paid, got 402)`);
      }
      if (status === 422) return bad(label, "got 422, fixture stale, gate not proven");
      return bad(label, `expected 402 challenge, got ${status}`);
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

// --auto-fix mode rewrites the one class of drift that needs no judgment:
// when a backend's live schema_version isn't yet in the MCP service's
// knownSchemaVersions array, append it. Live value is canonical. All
// other drift classes (auth-mode mismatch, missing fields, 5xx, etc.)
// require a human decision and are never touched.
const AUTO_FIX = process.argv.includes("--auto-fix");
const schemaFixes = []; // { serviceId, addVersion } collected during the run


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

// Cross-product registry drift: Sentinel's VERIFIED_INSTITUTIONAL_ENTITY
// keystone fires on membership in a vendored RWA-issuer registry. That set
// must stay a superset of the canonical Pulse RWA issuer map, or a newly
// tracked issuer would under-score on Sentinel posture. We assert one
// direction only (every Pulse issuer wallet is in Sentinel's registry);
// Sentinel may legitimately carry extra institutions Pulse doesn't track.
async function checkRwaRegistryDrift() {
  const label = "registry-drift :: Sentinel rwa_registry <- Pulse rwa-summary";
  try {
    const sentinel = await fetchJson("https://sentinel.xrpl-utilities.io/registry/rwa-issuers");
    const pulse = await fetchJson("https://pulse.xrpl-utilities.io/stats/rwa-summary");
    if (sentinel.status !== 200) return bad(label, `Sentinel registry HTTP ${sentinel.status}`);
    if (pulse.status !== 200) return bad(label, `Pulse rwa-summary HTTP ${pulse.status}`);
    const registry = new Set(
      (sentinel.body?.wallets || []).map((w) => w.address).filter(Boolean)
    );
    if (registry.size === 0) return bad(label, "Sentinel registry returned no wallets");
    const issuers = pulse.body?.issuers;
    if (!Array.isArray(issuers) || issuers.length === 0) {
      return bad(label, "Pulse rwa-summary returned no issuers");
    }
    // Distinct Pulse issuer wallets missing from Sentinel's registry.
    const missing = [...new Set(
      issuers.map((i) => i.wallet).filter((w) => w && !registry.has(w))
    )];
    if (missing.length > 0) {
      const detail = missing
        .map((w) => {
          const row = issuers.find((i) => i.wallet === w);
          return `${w} (${row?.logical_label || row?.label || "?"})`;
        })
        .join(", ");
      return bad(label, `${missing.length} Pulse issuer wallet(s) missing from Sentinel registry: ${detail}`);
    }
    ok(`${label} (${registry.size} registry / ${issuers.length} pulse rows, no drift)`);
  } catch (e) {
    bad(label, e.message || String(e));
  }
}

async function main() {
  console.log(`Contract scrub at ${new Date().toISOString()}\n`);

  console.log("== Manifest schema-version drift ==");
  for (const s of SERVICES) {
    await checkAgentsJson(s);
  }

  console.log("");
  await discoverFixtures();

  console.log("== MCP tool endpoints ==");
  for (const tool of ALL_TOOLS) {
    await checkTool(tool);
  }

  console.log("\n== Cross-service edges ==");
  for (const edge of CROSS_SERVICE_EDGES) {
    await checkEdge(edge);
  }

  console.log("\n== Cross-product registry drift ==");
  await checkRwaRegistryDrift();

  console.log(`\n----------------------------------------`);
  console.log(`Total: ${pass} pass, ${fail} fail`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  - ${f}`);
  }

  if (AUTO_FIX && schemaFixes.length > 0) {
    console.log(`\n== Auto-fix: appending ${schemaFixes.length} schema version(s) ==`);
    const applied = [];
    for (const { serviceId, addVersion } of schemaFixes) {
      const filePath = resolve(REPO_ROOT, `src/services/${serviceId}.ts`);
      try {
        const before = readFileSync(filePath, "utf8");
        const spliced = spliceSchemaVersion(before, addVersion);
        if (!spliced.ok) {
          console.log(`  ! ${serviceId}: ${spliced.reason}`);
          continue;
        }
        writeFileSync(filePath, spliced.source);
        applied.push({ serviceId, addVersion, filePath });
        console.log(`  + ${serviceId}: appended ${addVersion}`);
      } catch (e) {
        console.log(`  ! ${serviceId}: ${e.message}`);
      }
    }
    if (applied.length > 0) {
      // Write a summary file the GH Action wraps into PR body
      const summary = applied.map(a => `- ${a.serviceId}: knownSchemaVersions += "${a.addVersion}"`).join("\n");
      writeFileSync(resolve(REPO_ROOT, ".auto-fix-summary.txt"), summary + "\n");
      console.log(`\nWrote .auto-fix-summary.txt — GH Action picks this up for the PR body.`);
      // Exit 2 = "drift was found and auto-fixed; please open a PR"
      process.exit(2);
    }
  }

  if (fail > 0) process.exit(1);
  process.exit(0);
}

// Only run the scrub when invoked as a script — the pure helpers above are
// imported by the test suite, which must not fire live requests or exit().
if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((e) => {
    console.error("scrubber crashed:", e);
    process.exit(2);
  });
}
