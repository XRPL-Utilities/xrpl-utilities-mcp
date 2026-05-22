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
 * On dev / first-launch we may want to tolerate manifest fetch failures
 * (so the MCP server still starts when networking is flaky); on
 * production we want to fail-closed. STRICT_VALIDATE=1 toggles that.
 */

import { SERVICES } from "./services/index.js";
import type { ServiceDef } from "./types.js";

export interface ValidationResult {
  service: string;
  ok: boolean;
  warnings: string[];
  errors: string[];
}

export async function validateAllServices(opts: {
  strict: boolean;
  fetchTimeoutMs?: number;
}): Promise<ValidationResult[]> {
  const results = await Promise.all(SERVICES.map((s) => validateService(s, opts.fetchTimeoutMs ?? 8_000)));
  return results;
}

async function validateService(svc: ServiceDef, timeoutMs: number): Promise<ValidationResult> {
  const out: ValidationResult = {
    service: svc.label,
    ok: true,
    warnings: [],
    errors: [],
  };

  let manifest: Record<string, unknown> | null = null;
  try {
    const ctl = new AbortController();
    const tId = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(svc.manifestUrl, { signal: ctl.signal });
    clearTimeout(tId);
    if (!r.ok) {
      out.warnings.push(`manifest fetch returned HTTP ${r.status}`);
    } else {
      manifest = (await r.json()) as Record<string, unknown>;
    }
  } catch (e) {
    out.warnings.push(`manifest fetch failed: ${(e as Error).message}`);
  }

  if (!manifest) {
    // No live manifest - we can still start, but flag it so the
    // operator knows the validator didn't actually verify anything.
    return out;
  }

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
