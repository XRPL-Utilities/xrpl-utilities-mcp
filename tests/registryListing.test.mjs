// MCP Registry listing guards (2026-11-02).
// 1. server.json must declare the hosted endpoint under `remotes`: before
//    this the registry entry named only the npm package, so clients that
//    browse the registry for remote servers never saw mcp.xrpl-utilities.io.
// 2. The release job must log in to the registry before every publish
//    attempt: v0.2.232 never reached the registry because the one login at
//    the top expired while the retries waited on npm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

test("server.json declares the hosted streamable-http endpoint", () => {
  assert.deepEqual(server.remotes, [
    { type: "streamable-http", url: "https://mcp.xrpl-utilities.io/mcp" },
  ]);
});

test("release logs in to the registry inside the retry loop", () => {
  const step = release.slice(release.indexOf("- name: Publish to MCP Registry"));
  const loop = step.slice(step.indexOf("for i in 1 2 3 4 5 6; do"));
  const body = loop.slice(0, loop.indexOf("done"));
  assert.ok(body.includes("mcp-publisher login github-oidc"), "login must be inside the loop");
  assert.ok(step.includes('npm view "@xrpl-utilities/mcp@$VERSION" version'), "wait for npm first");
});
