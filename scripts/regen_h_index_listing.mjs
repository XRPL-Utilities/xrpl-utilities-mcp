#!/usr/bin/env node
/**
 * Regenerate the `mcpManifest` field of h-index-listing.json from the LIVE
 * tools/list of the deployed server.
 *
 * Why this exists: the listing embeds a JSON.stringify snapshot of tools/list,
 * so it silently goes stale every time a tool description changes. That already
 * happened once -- on 2026-07-20 the XR-Flows descriptions were corrected in
 * source while the listing still advertised the old six-ticker text. Hand-editing
 * the embedded string is error-prone (it is one 18KB escaped line), so generate
 * it instead.
 *
 * IMPORTANT ordering: this reads the DEPLOYED server, not the local source.
 * Deploy first, verify the live descriptions are the ones you want, then run
 * this. Running it against a stale deployment just re-bakes the stale text,
 * which is the exact failure it is meant to prevent -- so it refuses to write
 * if the fetched manifest is byte-identical to what is already on file, and
 * prints a diff summary when it does change.
 *
 * It deliberately does NOT set `issuedAt` or `signature`. Per
 * h-index-registration.README.md the owner sets issuedAt to the unix time AT
 * SIGNING (it is a freshness window) and EIP-712-signs with the Base account.
 * Signature is cleared here because any prior signature is invalid the moment
 * the manifest changes.
 *
 * Usage: node scripts/regen_h_index_listing.mjs [--endpoint <url>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const LISTING = join(HERE, "..", "h-index-listing.json");

function parseSse(body) {
  // The endpoint answers as text/event-stream; the JSON-RPC result rides on a
  // single `data:` line. Fall back to plain JSON if it ever stops streaming.
  const line = body.split(/\r?\n/).find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice(6) : body);
}

const args = process.argv.slice(2);
const epFlag = args.indexOf("--endpoint");
const listing = JSON.parse(readFileSync(LISTING, "utf8"));
const endpoint = epFlag >= 0 ? args[epFlag + 1] : listing.endpointUrl;

console.log(`fetching tools/list from ${endpoint}`);
const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  }),
});
if (!res.ok) {
  console.error(`FAILED: HTTP ${res.status}`);
  process.exit(1);
}

const rpc = parseSse(await res.text());
const tools = rpc?.result?.tools;
if (!Array.isArray(tools) || tools.length === 0) {
  console.error("FAILED: no tools in response; refusing to write an empty manifest");
  process.exit(1);
}

const prev = listing.mcpManifest;
let prevTools = [];
try {
  prevTools = JSON.parse(prev)?.tools ?? [];
} catch {
  /* previous manifest unparseable; treat as empty */
}

// Shape must stay a JSON *string* -- H-Index rejects a nested object here.
const next = JSON.stringify({ tools });

if (next === prev) {
  console.log(`no change: ${tools.length} tools, manifest already current.`);
  console.log("If you expected a change, the deployment is probably stale -- deploy first.");
  process.exit(0);
}

const prevByName = new Map(prevTools.map((t) => [t.name, t.description]));
const added = tools.filter((t) => !prevByName.has(t.name)).map((t) => t.name);
const removed = prevTools.filter((t) => !tools.some((n) => n.name === t.name)).map((t) => t.name);
const changed = tools
  .filter((t) => prevByName.has(t.name) && prevByName.get(t.name) !== t.description)
  .map((t) => t.name);

console.log(`tools: ${prevTools.length} -> ${tools.length}`);
if (added.length) console.log(`  added:       ${added.join(", ")}`);
if (removed.length) console.log(`  removed:     ${removed.join(", ")}`);
if (changed.length) console.log(`  description: ${changed.join(", ")}`);

listing.mcpManifest = next;
listing.signature = ""; // any prior signature is void once the manifest changes

writeFileSync(LISTING, JSON.stringify(listing, null, 2) + "\n");
console.log(`\nwrote ${LISTING}`);
console.log("signature cleared. NEXT (owner only): set issuedAt to the unix time at");
console.log("signing, EIP-712-sign, then POST per h-index-registration.README.md.");
