// Railway stops reading railway.json / railway.toml on 2026-12-01. The build
// and deploy settings (Dockerfile, node dist/index.js, /healthz, restart
// ON_FAILURE x5) now live in the xr-mcp service settings on Railway. A config
// file added back here would quietly override them again until that date.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

for (const name of ["railway.json", "railway.toml"]) {
  test(`no ${name} at the repo root`, () => {
    assert.equal(fs.existsSync(new URL(`../${name}`, import.meta.url)), false);
  });
}
