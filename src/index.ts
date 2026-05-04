#!/usr/bin/env node
/**
 * Entry point. Dispatches to stdio or HTTP transport based on a
 * --transport flag (or the MCP_TRANSPORT env var).
 *
 * Usage:
 *   xrpl-utilities-mcp --transport stdio   # for Claude Desktop config
 *   xrpl-utilities-mcp --transport http    # for hosted Railway deploy
 *
 * Default is stdio so the npm-published entry-point Just Works when
 * Claude Desktop launches it.
 */

import { runStdio } from "./transport/stdio.js";
import { runHttp } from "./transport/http.js";
import { validateAllServices } from "./validate.js";

function parseArgs(argv: string[]): { transport: "stdio" | "http"; port: number; skipValidate: boolean } {
  let transport: "stdio" | "http" =
    (process.env["MCP_TRANSPORT"] === "http" ? "http" : "stdio");
  let port = Number(process.env["PORT"] ?? "8080");
  let skipValidate = process.env["MCP_SKIP_VALIDATE"] === "1";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--transport" || a === "-t") {
      const v = argv[++i];
      if (v === "stdio" || v === "http") transport = v;
    } else if (a === "--port" || a === "-p") {
      port = Number(argv[++i] ?? port);
    } else if (a === "--skip-validate") {
      skipValidate = true;
    }
  }
  return { transport, port, skipValidate };
}

async function main(): Promise<void> {
  const { transport, port, skipValidate } = parseArgs(process.argv.slice(2));

  // Schema-discipline check. On stdio we run silently and only complain
  // on stderr (Claude Desktop captures stdout for the JSON-RPC stream).
  // On HTTP we log normally.
  if (!skipValidate) {
    const results = await validateAllServices({ strict: false });
    const log = transport === "stdio" ? console.error : console.log;
    for (const r of results) {
      if (r.errors.length) {
        log(`[validate] ${r.service}: ERRORS`);
        r.errors.forEach((e) => log(`  ${e}`));
      }
      if (r.warnings.length) {
        log(`[validate] ${r.service}: warnings`);
        r.warnings.forEach((w) => log(`  ${w}`));
      }
    }
    const anyError = results.some((r) => r.errors.length);
    if (anyError && process.env["MCP_FAIL_ON_DRIFT"] === "1") {
      process.exit(2);
    }
  }

  if (transport === "stdio") {
    await runStdio();
  } else {
    await runHttp(port);
  }
}

main().catch((e) => {
  console.error("xrpl-utilities-mcp fatal:", e);
  process.exit(1);
});
