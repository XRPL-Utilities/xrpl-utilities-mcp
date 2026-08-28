/**
 * Startup schema-discipline check.
 *
 * For each registered service, fetch its live /agents.json and verify
 *
 *   1. The reported schema_version is one we've seen before
 *      (knownSchemaVersions). An unrecognized version means the
 *      upstream service may have added/renamed/removed fields the
 *      MCP build is not aware of - the operator should bump and re-
 *      release this MCP package after auditing the changes.
 *
 *   2. Each tool's path appears somewhere in the manifest's endpoints
 *      block. If a service renames /scan to /scan/v2 we want to fail
 *      LOUD here, not silently 404 every agent call.
 *
 * On dev / first-launch we tolerate manifest fetch failures (so the MCP
 * server still starts when networking is flaky). STRICT_VALIDATE=1 turns a
 * fetch failure into an error instead of a warning; it is opt-in, NOT the
 * default for HTTP, because railway.json restarts ON_FAILURE and failing
 * closed would crash-loop the whole endpoint - taking the other five healthy
 * services' tools with it - whenever one backend is cold at boot.
 *
 * Either way `checked` records whether a manifest was actually read. "Could
 * not check" and "checked, all clear" must never produce the same result.
 */

import { SERVICES } from "./services/index.js";
import type { ServiceDef } from "./types.js";

export interface ValidationResult {
  service: string;
  ok: boolean;
  /** False when no manifest could be read, so nothing was verified. */
  checked: boolean;
  warnings: string[];
  errors: string[];
}

export async function validateAllServices(opts: {
  strict: boolean;
  fetchTimeoutMs?: number;
}): Promise<ValidationResult[]> {
  const results = await Promise.all(
    SERVICES.map((s) => validateService(s, opts.fetchTimeoutMs ?? 8_000, opts.strict)),
  );
  return results;
}

/**
 * Codes that mean "the connection did not happen", not "the service answered
 * badly". Node's fetch reports every one of these as the same opaque
 * `TypeError: fetch failed` and hangs the real code off err.cause, so a
 * message-substring test never sees ECONNREFUSED/ENOTFOUND - the exact
 * cold-start shape the retry exists for.
 */
const TRANSIENT_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN",
  "EPIPE", "EHOSTUNREACH", "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
]);

export function isTransientFetchError(e: unknown, depth = 0): boolean {
  if (!e || typeof e !== "object" || depth > 5) return false;
  const err = e as { name?: string; code?: string; cause?: unknown; errors?: unknown[]; message?: string };
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  if (typeof err.code === "string" && TRANSIENT_CODES.has(err.code)) return true;
  // undici wraps multi-address (A + AAAA) connect failures in an AggregateError
  if (Array.isArray(err.errors) && err.errors.some((x) => isTransientFetchError(x, depth + 1))) return true;
  if (err.cause && isTransientFetchError(err.cause, depth + 1)) return true;
  // Last-resort message match: keeps non-undici throwers and existing callers working.
  const msg = typeof err.message === "string" ? err.message : "";
  return /aborted|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(msg);
}

async function fetchManifestOnce(url: string, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const tId = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctl.signal });
  } finally {
    clearTimeout(tId);
  }
}

async function validateService(
  svc: ServiceDef,
  timeoutMs: number,
  strict: boolean,
): Promise<ValidationResult> {
  const out: ValidationResult = {
    service: svc.label,
    ok: true,
    checked: false,
    warnings: [],
    errors: [],
  };

  let manifest: Record<string, unknown> | null = null;
  try {
    let r: Response;
    try {
      r = await fetchManifestOnce(svc.manifestUrl, timeoutMs);
    } catch (e) {
      // One retry on a transient blip, same contract the contract scrubber
      // uses. Without it STRICT_VALIDATE=1 is unusable: a cold backend at boot
      // would fail the whole start.
      if (!isTransientFetchError(e)) throw e;
      // Cold containers need real time to come up; an immediate retry re-hits
      // the same refused socket.
      await new Promise((r) => setTimeout(r, 750));
      r = await fetchManifestOnce(svc.manifestUrl, timeoutMs);
    }
    if (!r.ok) {
      out.warnings.push(`manifest fetch returned HTTP ${r.status}`);
    } else {
      manifest = (await r.json()) as Record<string, unknown>;
    }
  } catch (e) {
    out.warnings.push(`manifest fetch failed: ${(e as Error).message}`);
  }

  if (!manifest) {
    // No live manifest - nothing was verified. checked stays false so the
    // caller can tell this apart from a clean run; under strict it is an
    // error, not a warning.
    if (strict) {
      out.errors.push(
        `no live manifest from ${svc.manifestUrl}; STRICT_VALIDATE=1 treats an unverified service as drift`,
      );
      out.ok = false;
    }
    return out;
  }
  out.checked = true;

  const liveVersion = String(manifest["schema_version"] ?? "");
  if (liveVersion && !svc.knownSchemaVersions.includes(liveVersion)) {
    const msg =
      `${svc.label} reports schema_version=${liveVersion}; this MCP build ` +
      `expects one of [${svc.knownSchemaVersions.join(", ")}]. Audit upstream ` +
      `changes and bump knownSchemaVersions.`;
    if (svc.knownSchemaVersions.length === 0) {
      out.warnings.push(msg);
    } else {
      out.errors.push(msg);
      out.ok = false;
    }
  }

  // Endpoint-presence check. The manifest's endpoints block is a flat
  // map of names to URLs/paths. We consider a tool valid if ANY entry
  // in the manifest contains the tool's path as a substring (covers
  // entries like '/events?since=<event_id>&limit=...').
  const endpoints = manifest["endpoints"];
  if (endpoints && typeof endpoints === "object") {
    // Normalize both sides: strip path params, collapse repeated slashes,
    // drop trailing slashes. Lets a tool path with {param} match a manifest
    // entry that keeps the param placeholder.
    const norm = (s: string) =>
      s.replace(/\{[^}]+\}/g, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
    const flat = Object.values(endpoints as Record<string, unknown>)
      .map((v) => norm(String(v)))
      .join(" ");
    for (const tool of svc.tools) {
      const skeleton = norm(tool.path);
      if (skeleton && !flat.includes(skeleton)) {
        out.errors.push(
          `tool ${tool.name} declares path ${tool.path} but the manifest ` +
            `does not advertise that endpoint. Either rename the tool or add ` +
            `the new path to ${svc.label}'s endpoints.`,
        );
        out.ok = false;
      }
    }
  }

  return out;
}
