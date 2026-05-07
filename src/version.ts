/**
 * Single source of truth for the runtime SERVER_VERSION string.
 *
 * Reads package.json at module-load time so the version-string
 * reported by /healthz, the MCP server identity, and the User-Agent
 * header always match the published npm version. Eliminates a class
 * of release-process bug where package.json was bumped but hardcoded
 * `const SERVER_VERSION = "0.1.7"` constants weren't, shipping a
 * version with the wrong self-reported identity.
 *
 * Path note: when compiled, this lives at dist/version.js. package.json
 * sits at the package root (../package.json relative to dist/). npm
 * ships package.json in every published tarball regardless of the
 * `files` field, so the file is always present at install time.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let _version = "0.0.0-unknown";
try {
  // dist/version.js -> ../package.json
  const pkgPath = join(__dirname, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (typeof pkg.version === "string" && pkg.version.length > 0) {
    _version = pkg.version;
  }
} catch {
  // Fall through to "0.0.0-unknown". Healthz still serves; the version
  // field will visibly indicate something is wrong without crashing.
}

export const SERVER_VERSION: string = _version;
