/**
 * HTTP/SSE transport. Used when the MCP server runs as a hosted
 * service (Railway, etc.) that remote MCP clients connect to over
 * the network.
 *
 * Endpoints:
 *
 *   GET  /                  - service banner + manifest pointer
 *   GET  /healthz           - liveness probe + service ping summary
 *   GET  /.well-known/x402  - x402 service catalog for agent directories
 *   POST /mcp               - MCP JSON-RPC (streamable-http transport)
 *   GET  /mcp               - MCP JSON-RPC SSE (legacy clients)
 *
 * Auth: every paid tool call still requires the caller to provide
 * their own payment_signature in the tool args. The hosted endpoint
 * is a transparent proxy, NOT a subsidy.
 *
 * Two separate budgets guard the operator-issued MCP_BYPASS_KEY path:
 * a generous per-IP request limit, and a much tighter per-IP budget on
 * FAILED `_bypass_key` attempts. The failed-attempt budget is enforced at
 * the point of the guess (see dispatch's isBypassBlocked) and only 429s
 * requests that carry a key - a batched body is thousands of guesses in one
 * request, and a blanket 429 on the bucket key is an outage, not a limit. The request limit alone is not an
 * access control on a secret - 60 guesses a minute is still online
 * guessing - and both are only as good as the client key, so see
 * clientKey() for why the left-most X-Forwarded-For entry must never
 * be used. The transport also refuses to boot behind a bypass key shorter
 * than 32 bytes (assertBypassKeyStrength), so those budgets are a second
 * layer rather than the only one.
 */

import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "../server.js";
import { SERVICES, ALL_TOOLS } from "../services/index.js";
import { SERVER_VERSION } from "../version.js";
import { pricingFor } from "../pricing.js";

/**
 * Paid tools that do not carry their own charge. The Telemetry async-invoice
 * flow is quote -> pay -> status -> results: one $0.10 purchase, three tools.
 * Only the quote step is a priced resource.
 */
const NON_CHARGING_FLOW_STEPS = new Set([
  "xrpl_telemetry_get_status",
  "xrpl_telemetry_get_results",
]);

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_WINDOW = 60; // generous; agents typically fire bursts

// Failed `_bypass_key` attempts get their own, far tighter budget. An operator
// who was given the key never trips this; anyone enumerating it does so within
// a handful of tries.
// An hour, not ten minutes. The window is the denominator of the online
// guessing budget against MCP_BYPASS_KEY: at ten minutes a persistent guesser
// gets ~1,584 tries a day, at an hour ~264. The collateral the shorter window
// was bought to relieve had already been removed by scoping the lockout to
// key-carrying requests - all that is left is that an operator sharing a bucket
// key with a guesser cannot use their own bypass key until the window expires,
// which is narrow and self-resolving. A short key is now refused at boot
// rather than warned about, but the budget stays small: it is what bounds
// online guessing against a key that is long and still unlucky.
const BYPASS_FAIL_WINDOW_MS = 3_600_000;
const BYPASS_FAIL_LIMIT = 10;

// A single JSON-RPC array is dispatched message by message, so at the 1mb body
// cap one POST otherwise carries roughly 5,000 tool calls.
const MAX_BATCH_MESSAGES = 20;

// Hard ceiling on tracked keys. Buckets are swept on a timer, but a burst of
// distinct addresses inside one window must not be able to grow the heap
// without bound: an unbounded Map on the public endpoint is an OOM away from
// taking mcp.xrpl-utilities.io down.
const MAX_TRACKED_KEYS = 50_000;

/**
 * How many proxy hops in front of this container are ours. Railway's edge
 * APPENDS the real peer to X-Forwarded-For, it does not replace what the
 * client sent, so the trustworthy entry is counted from the RIGHT. Default 1;
 * override only after counting the entries on a request you made yourself
 * against the live deploy. Too high re-opens the spoof; too low used to
 * collapse every caller into one bucket keyed on an internal proxy IP, which
 * clientKey() now degrades out of rather than shares - a safety net, not a
 * substitute for the real count.
 */
const TRUST_PROXY_HOPS = Math.max(0, Number(process.env["TRUST_PROXY_HOPS"] ?? "1") || 0);

interface RateBucket {
  count: number;
  resetAt: number;
  /** Set once the over-budget alert has been logged for this bucket. */
  logged?: boolean;
}
const rateBuckets = new Map<string, RateBucket>();
const bypassFailBuckets = new Map<string, RateBucket>();

// Addresses that can never be a real caller on a public endpoint. An entry
// matching this means TRUST_PROXY_HOPS is pointing at an internal proxy, not at
// the client.
//
// RFC1918 and loopback are not the whole set: container platforms put RFC 6598
// CGNAT space (100.64.0.0/10) in X-Forwarded-For, and Google's load balancers -
// which Railway sits behind - source from 35.191.0.0/16 and 130.211.0.0/22,
// both of which are publicly routable. Leaving those out made the left-walk
// return on its first iteration and collapse every caller into one bucket
// keyed on the proxy, which is the availability regression the walk exists to
// close. None of these ranges can be the source address of a real client of
// this endpoint, so skipping past them opens no spoof window: the entry to
// their left is the one the platform appended, not one the caller typed.
const PRIVATE =
  /^(::1|0\.0\.0\.0$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|35\.191\.|130\.211\.[0-3]\.|f[cd][0-9a-f]{2}:|fe80:)/i;
const norm = (s: string) => s.replace(/^::ffff:/i, "").replace(/^\[|\]$/g, "");

// One line per process, not one per request: a per-request console.error on a
// misconfigured hop count is its own amplifier.
let warnedAllPrivate = false;

/**
 * The address to charge for this request. The socket peer is the trustworthy
 * value and the header is only a hint: reading X-Forwarded-For[0] takes
 * whatever the client typed, so a fresh value per request buys a fresh bucket
 * and the limiter never fires (and setting a victim's address burns theirs).
 */
export function clientKey(req: Pick<Request, "headers" | "socket">): string {
  const socketIp = req.socket?.remoteAddress ?? "unknown";
  if (TRUST_PROXY_HOPS === 0) return socketIp;
  const raw = req.headers["x-forwarded-for"];
  const entries = (Array.isArray(raw) ? raw.join(",") : raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Fewer entries than trusted hops means the request did not come through the
  // proxy chain we configured for; fall back to the peer rather than to a
  // caller-supplied entry.
  if (entries.length < TRUST_PROXY_HOPS) return socketIp;
  // Start at the hop we were told to trust, then walk LEFT past anything
  // private. An under-counted TRUST_PROXY_HOPS otherwise lands on an internal
  // proxy address and collapses every caller into one bucket - which turns the
  // failed-bypass lockout into a whole-endpoint outage. Walking left is not a
  // spoof window: Railway appends the real peer, so the first PUBLIC entry from
  // the right is the earliest one an attacker cannot have written.
  for (let i = entries.length - TRUST_PROXY_HOPS; i >= 0; i--) {
    const candidate = norm(entries[i] as string);
    if (candidate && !PRIVATE.test(candidate)) return candidate;
  }
  if (!warnedAllPrivate) {
    warnedAllPrivate = true;
    // eslint-disable-next-line no-console
    console.error(
      `[mcp] every X-Forwarded-For entry is private (trust_proxy_hops=${TRUST_PROXY_HOPS}); ` +
        `keying the limiter on the socket peer. Measure the real hop count on the live deploy.`,
    );
  }
  return socketIp;
}

function sweep(map: Map<string, RateBucket>, now: number): void {
  for (const [k, b] of map) {
    if (b.resetAt < now) map.delete(k);
  }
}

/**
 * Fetch (or open) this key's bucket. Never clear() the whole map on hitting the
 * cap: that zeroes every live counter and hands an attacker a free limiter
 * reset. Expired entries go first, then oldest-first (Map preserves insertion
 * order).
 */
function bucketFor(map: Map<string, RateBucket>, key: string, windowMs: number, now: number): RateBucket {
  const existing = map.get(key);
  if (existing && existing.resetAt >= now) return existing;
  if (map.size >= MAX_TRACKED_KEYS) {
    sweep(map, now);
    for (const k of map.keys()) {
      if (map.size < MAX_TRACKED_KEYS) break;
      map.delete(k);
    }
  }
  const fresh: RateBucket = { count: 0, resetAt: now + windowMs };
  map.set(key, fresh);
  return fresh;
}

// unref'd so it never holds the process open - this module graph is shared with
// the stdio/CLI entry point.
const sweepTimer = setInterval(() => {
  const now = Date.now();
  sweep(rateBuckets, now);
  sweep(bypassFailBuckets, now);
}, RATE_WINDOW_MS);
sweepTimer.unref();

/**
 * Does this JSON-RPC body actually carry a `_bypass_key`? The failed-bypass
 * lockout is scoped to these: 429ing everything from the bucket key would let
 * eleven wrong keys take tools/list, initialize, the free tools and every paid
 * x402 call offline for the whole window - and with an unmeasured
 * TRUST_PROXY_HOPS that bucket key can be one shared proxy address, i.e. the
 * whole endpoint. Guesses always carry the key, so the guard still stops 100%
 * of guessing. Parsed off the envelope rather than probed loosely so a
 * `_bypass_key` sitting somewhere else in the payload cannot self-lock.
 */
export function carriesBypassKey(body: unknown): boolean {
  const one = (m: any) =>
    typeof m?.params?.arguments?._bypass_key === "string" ||
    typeof m?.params?._bypass_key === "string";
  return Array.isArray(body) ? body.some(one) : one(body);
}

/**
 * Same predicate rateLimit() uses, exported so dispatch can consult it at the
 * point of the guess. One definition: a second copy would drift.
 */
export function isBypassBlocked(ip: string): boolean {
  const b = bypassFailBuckets.get(ip);
  return !!b && b.resetAt >= Date.now() && b.count > BYPASS_FAIL_LIMIT;
}

export function rateLimit(req: Request, res: Response): boolean {
  const ip = clientKey(req);
  const now = Date.now();

  // A caller who has burned through the failed-bypass budget is guessing at the
  // operator secret; hold them off for the rest of the window regardless of
  // their request count - but only on the requests that carry a key, so the
  // lockout cannot become a denial of service against everyone else sharing
  // the bucket key.
  const fails = bypassFailBuckets.get(ip);
  if (fails && fails.resetAt >= now && fails.count > BYPASS_FAIL_LIMIT && carriesBypassKey(req.body)) {
    res.status(429).json({ error: "rate_limited", retry_after_s: Math.ceil((fails.resetAt - now) / 1000) });
    return false;
  }

  const bucket = bucketFor(rateBuckets, ip, RATE_WINDOW_MS, now);
  // A batched body is N calls, not one request: charging it as one let a single
  // POST buy the whole window's worth of upstream fan-out.
  bucket.count += Array.isArray(req.body) ? Math.max(1, req.body.length) : 1;
  if (bucket.count > RATE_LIMIT_PER_WINDOW) {
    res.status(429).json({ error: "rate_limited", retry_after_s: Math.ceil((bucket.resetAt - now) / 1000) });
    return false;
  }
  return true;
}

/** Count one wrong `_bypass_key` against this caller. */
export function recordBypassFailure(ip: string): void {
  const now = Date.now();
  const bucket = bucketFor(bypassFailBuckets, ip, BYPASS_FAIL_WINDOW_MS, now);
  bucket.count += 1;
  // Slide the window on every recorded failure so a caller who keeps guessing
  // never ages into a fresh budget, while a bucket that goes quiet still
  // expires on its own. Only real failures slide it: refused requests are not
  // counted, so an operator retrying a valid key cannot extend their own hold.
  bucket.resetAt = now + BYPASS_FAIL_WINDOW_MS;
  // `>= limit+1 && !logged` rather than `=== limit+1`: a batch that records
  // several failures in a row steps straight over the equality and the alert
  // never fires.
  if (bucket.count >= BYPASS_FAIL_LIMIT + 1 && !bucket.logged) {
    bucket.logged = true;
    // eslint-disable-next-line no-console
    console.error(
      `[mcp] ${ip} exceeded the failed _bypass_key budget ` +
        `(${BYPASS_FAIL_LIMIT} per ${Math.round(BYPASS_FAIL_WINDOW_MS / 60_000)}min); throttling`,
    );
  }
}

/**
 * Minimum MCP_BYPASS_KEY strength, in bytes. 32 random bytes is the same floor
 * the Python services put on X402_REPLAY_HMAC_KEY, which raises at import
 * rather than warning.
 */
export const MIN_BYPASS_KEY_BYTES = 32;

/**
 * Refuse to boot the public HTTP transport behind a guessable bypass key.
 *
 * This used to be a console warning. A warning on a deploy nobody is reading
 * the logs of is not a control, and it left the two request budgets above
 * load-bearing: they are the only thing between a short key and an online
 * guesser. A key too weak to stand on its own is an operator mistake that has
 * to be fixed before the endpoint is reachable, not after.
 *
 * Scoped to the HTTP transport on purpose. stdio is single-tenant, runs on the
 * user's own machine, and exposes no network guessing surface, so the same
 * floor there would only break local dev for no gain.
 *
 * Never logs or embeds the key, only its length.
 */
export function assertBypassKeyStrength(rawKey: string | undefined): void {
  if (!rawKey) return; // unset is fine: the bypass path is simply off.
  const bytes = Buffer.byteLength(rawKey, "utf8");
  if (bytes >= MIN_BYPASS_KEY_BYTES) return;
  throw new Error(
    `MCP_BYPASS_KEY is ${bytes} bytes; the HTTP transport requires at least ` +
      `${MIN_BYPASS_KEY_BYTES}. It is an operator secret on a public endpoint, ` +
      "and a short one is guessable online. Generate a new one with " +
      "`openssl rand -hex 32`, set it on this service, and rotate it per " +
      "service rather than sharing one across them. To run without the bypass " +
      "path, unset MCP_BYPASS_KEY entirely; callers pay with their own " +
      "payment_signature either way.",
  );
}

export async function runHttp(port: number): Promise<void> {
  // Before anything binds a port. A boot that refuses is recoverable; a boot
  // that serves a weak operator key is not.
  assertBypassKeyStrength(process.env["MCP_BYPASS_KEY"]);

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.json({
      service: "xrpl-utilities-mcp",
      description:
        "MCP server for the XRPL-Utilities portfolio (Sentinel, Pulse, Telemetry, Trust, Vault, Flows). Connect any MCP client to /mcp.",
      version: SERVER_VERSION,
      mcp_endpoint: "/mcp",
      manifest: "/agents.json",
      well_known_manifest: "/.well-known/agents.json",
      x402_catalog: "/.well-known/x402",
      llms_discovery: "/llms.txt",
      docs: "https://github.com/XRPL-Utilities/xrpl-utilities-mcp",
      portfolio: "https://xrpl-utilities.com",
    });
  });

  app.get("/healthz", async (_req, res) => {
    res.json({ status: "ok", service: "xrpl-utilities-mcp", version: SERVER_VERSION });
  });

  // ---- Discovery surfaces for non-MCP-speaking crawlers ----
  // The /mcp endpoint speaks JSON-RPC (POST + SSE) and is invisible
  // to a regular HTTP crawler. These routes give an LLM crawler or
  // search engine something to chew on so the MCP server isn't a
  // discoverability black hole.

  const manifest = () => ({
    schema_version: SERVER_VERSION,
    name: "XRPL-Utilities MCP",
    provider: "XRPL-Utilities™",
    description:
      "Model Context Protocol server exposing the XRPL-Utilities portfolio " +
      "(Sentinel, Pulse, Telemetry, Trust, Vault, Flows) as " + ALL_TOOLS.length + " callable tools " +
      "for AI agents. Stateless passthrough proxy: callers supply their own " +
      "x402 v2 payment header per tool call. Settled inline via the t54 " +
      "facilitator on XRPL mainnet; $0.10 USD per paid call lands on the " +
      "operator treasury wallet. The MCP server holds no wallets and takes no cut.",
    service_status: "live",
    endpoints: {
      base_url: "https://mcp.xrpl-utilities.io",
      mcp: "/mcp",
      discovery: "/llms.txt",
      manifest: "/agents.json",
      well_known_manifest: "/.well-known/agents.json",
      health: "/healthz",
    },
    transports: ["stdio", "streamable-http"],
    tool_count: ALL_TOOLS.length,
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      auth_mode: t.authMode,
    })),
    underlying_services: SERVICES.map((s) => ({
      id: s.id,
      label: s.label,
      base_url: s.baseUrl,
      manifest_url: s.manifestUrl,
    })),
    homepage: "https://xrpl-utilities.com",
    repository: "https://github.com/XRPL-Utilities/xrpl-utilities-mcp",
    npm: "https://www.npmjs.com/package/@xrpl-utilities/mcp",
    license: "MIT",
  });

  app.get("/agents.json", (_req, res) => res.json(manifest()));
  app.get("/.well-known/agents.json", (_req, res) => res.json(manifest()));

  // ---- x402 service catalog --------------------------------------------
  // Distinct from agents.json: this is the narrow, well-known-path catalog
  // the x402 ecosystem crawls. t54's xrpl-ai.org ingests `name`,
  // `description` and every `resources[]` entry from it verbatim; without
  // it a merchant renders as a bare "Registered Resource" row.
  //
  // The Python services in the portfolio serve this from a static JSON file
  // so the catalog cannot drift with request state. Here the catalog IS the
  // tool registry, and `tsc` ships only compiled JS to dist/, so it is built
  // from ALL_TOOLS with the same pricingFor() helper that backs
  // `tools/list` `_meta.pricing`. That is a stronger guarantee than a static
  // copy: a tool cannot be added, repriced or removed without this catalog
  // following it.
  //
  // Every tool is invoked the same way, as an MCP `tools/call` JSON-RPC
  // POST to /mcp, so each resource url carries the tool name as a fragment
  // to keep the entries individually addressable for a crawler.
  //
  // Prices are the USD peg, not drops: the underlying service quotes the
  // XRP leg at spot on every 402, so a fixed drops figure would go stale
  // within the hour.
  const x402Catalog = () => ({
    x402Version: 2,
    name: "XRPL-Utilities MCP",
    description:
      "Model Context Protocol server exposing the XRPL-Utilities portfolio " +
      "(Sentinel wallet classifier, Pulse signal feed, Telemetry supply and " +
      "utility floor, Trust XLS-70/80/81 directory, Vault RWA tracker, Flows " +
      "ETF AUM vs XRPL flow correlation) as " + ALL_TOOLS.length + " callable tools for AI " +
      "agents over stdio or streamable HTTP. Stateless passthrough: the " +
      "caller supplies their own x402 payment header per tool call and it is " +
      "forwarded to the underlying service. The MCP server holds no wallets, " +
      "aggregates no billing and takes no cut.",
    website: "https://mcp.xrpl-utilities.io",
    endpoint: "https://mcp.xrpl-utilities.io/mcp",
    protocol: "mcp/streamable-http",
    resources: ALL_TOOLS.filter(
      (t) =>
        pricingFor(t.name, t.authMode).paid &&
        // The Telemetry async-invoice flow charges once, at the quote step.
        // status + results complete the same purchase at no extra charge, so
        // listing them as separate priced resources would misstate the price.
        !NON_CHARGING_FLOW_STEPS.has(t.name),
    ).map((t) => {
      const pricing = pricingFor(t.name, t.authMode);
      return {
        url: `https://mcp.xrpl-utilities.io/mcp#${t.name}`,
        method: "POST",
        name: t.name,
        description: t.description,
        priceAmount: pricing.priceUsd.toFixed(2),
        priceAsset: "USD",
        network: "xrpl:0",
      };
    }),
    // Settlement happens on the underlying service, so these are the rails
    // those 402 builders accept, not rails this server terminates itself.
    networks: [
      {
        network: "xrpl:0",
        scheme: "exact",
        // RLUSD first, mirroring the order the services advertise in their
        // 402 accepts[]. XRP is the only rail priced off the XRP/USD oracle,
        // so it is offered but never the default a naive client lands on.
        assets: [
          {
            symbol: "RLUSD",
            asset: "524C555344000000000000000000000000000000",
            issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
          },
          { symbol: "XRP" },
        ],
      },
      {
        network: "eip155:8453",
        scheme: "exact",
        assets: [
          {
            symbol: "USDC",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            decimals: 6,
          },
        ],
      },
    ],
    docs: "https://mcp.xrpl-utilities.io/llms.txt",
    manifest: "https://mcp.xrpl-utilities.io/agents.json",
  });

  app.get("/.well-known/x402", (_req, res) =>
    res.type("application/json").send(JSON.stringify(x402Catalog(), null, 2)),
  );

  app.get("/llms.txt", (_req, res) => {
    const toolList = ALL_TOOLS.map((t) =>
      `- \`${t.name}\` [${t.authMode}]`,
    ).join("\n");
    const body = [
      "# XRPL-Utilities MCP™",
      "",
      "Model Context Protocol server exposing the XRPL-Utilities portfolio",
      `(Sentinel, Pulse, Telemetry, Trust, Vault, Flows) as ${ALL_TOOLS.length} callable tools for AI agents.`,
      "Stateless passthrough proxy.",
      "Provider: XRPL-Utilities™ LLC.",
      "",
      "## Connect",
      "- Hosted (any MCP client, including Claude Desktop with HTTP support):",
      "  POST JSON-RPC + SSE to `https://mcp.xrpl-utilities.io/mcp`",
      "- Local (Claude Desktop config):",
      "  ```",
      "  npm i @xrpl-utilities/mcp",
      "  npx @xrpl-utilities/mcp --transport stdio",
      "  ```",
      "",
      "## Tools",
      toolList,
      "",
      "## Auth model",
      "Each `inline_x402` tool requires the caller to pass `payment_signature` in",
      "tool args - a base64-JSON-encoded x402 v2 payment header signing an XRPL",
      "Payment that matches one of the requirements returned by an unauthenticated",
      "probe. The MCP server forwards it as the `PAYMENT-SIGNATURE` header on the",
      "underlying call. $0.10 USD per call. Payable in RLUSD or XRP on XRPL, or",
      "USDC on Base - RLUSD and USDC are quoted at a flat $0.10 and are the",
      "rails to prefer; the XRP amount is converted at spot per challenge and is",
      "omitted while XRP/USD is unverifiable. Settled inline via the",
      "t54 facilitator. The `async_invoice` tools (Telemetry quote/status/results)",
      "use an out-of-band XRPL Payment to a deeplink instead of an inline header.",
      "",
      "## Discovery",
      "- Manifest:    https://mcp.xrpl-utilities.io/agents.json",
      "- x402 catalog: https://mcp.xrpl-utilities.io/.well-known/x402",
      "- Source:      https://github.com/XRPL-Utilities/xrpl-utilities-mcp",
      "- npm package: https://www.npmjs.com/package/@xrpl-utilities/mcp",
      "- Portfolio:   https://xrpl-utilities.com",
      "",
      "## What this is NOT",
      "Not a wallet. Not a custodian. Not an editorial product. Not investment",
      "advice. The MCP server holds no wallets and takes no cut - same x402",
      "settlement model as direct API calls, just wrapped as MCP tools so AI",
      "agents can discover and use them via tool-completion.",
      "",
    ].join("\n");
    res.type("text/markdown; charset=utf-8").send(body);
  });

  app.get("/robots.txt", (_req, res) => {
    const body = [
      "# xrpl-utilities-mcp is built to be discovered by AI agents and crawlers.",
      "# Machine-readable manifests: /agents.json, /.well-known/agents.json, /llms.txt",
      "# MCP JSON-RPC endpoint: /mcp",
      "User-agent: *",
      "Allow: /",
      "",
    ].join("\n");
    res.type("text/plain; charset=utf-8").send(body);
  });

  // Stateless mode: each /mcp request gets a fresh Server + Transport
  // pair. The MCP SDK's streamable-http transport, even with
  // sessionIdGenerator: undefined, doesn't reliably handle a shared
  // transport instance across multiple unrelated requests - the second
  // call returns 500 because the transport's internal state is still
  // tied to the first request. The recommended stateless pattern is
  // build-connect-handle-close per request. Cheap: the Server object
  // is just function pointers, no expensive state.
  app.all("/mcp", async (req, res) => {
    // Complement to the per-guess gate below, not a substitute for it: batching
    // was dropped in MCP spec 2025-06-18 but the SDK still maps batched
    // messages for back-compat, so cap the array rather than banning it and
    // breaking legacy 2025-03-26 clients.
    if (Array.isArray(req.body) && req.body.length > MAX_BATCH_MESSAGES) {
      res.status(413).json({ error: "batch_too_large", max_messages: MAX_BATCH_MESSAGES });
      return;
    }
    if (!rateLimit(req, res)) return;
    const ip = clientKey(req);
    let transport: StreamableHTTPServerTransport | null = null;
    try {
      const mcpServer = buildServer({
        bypassKey: process.env["MCP_BYPASS_KEY"],
        userAgent: `xrpl-utilities-mcp/${SERVER_VERSION} (http)`,
        onBypassFailure: () => recordBypassFailure(ip),
        // Per-message, so a batched body cannot spend thousands of guesses
        // between two request-level checks.
        isBypassBlocked: () => isBypassBlocked(ip),
      });
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      // Make sure the transport is torn down when the response closes,
      // so a long-running SSE stream doesn't leak file descriptors.
      res.on("close", () => {
        transport?.close().catch(() => {});
        mcpServer.close().catch(() => {});
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[mcp] handleRequest threw:", (e as Error).stack ?? e);
      if (!res.headersSent) {
        res.status(500).json({ error: "mcp_handle_failed", detail: (e as Error).message });
      }
    }
  });

  // Surface unhandled rejections in the dispatcher / SDK so we don't get
  // mystery 500s from Express's default error handler with no body.
  process.on("unhandledRejection", (reason) => {
    // eslint-disable-next-line no-console
    console.error("[mcp] unhandledRejection:", reason);
  });

  // Key strength is checked at the top of runHttp, before anything binds, and
  // is a refusal rather than the warning that used to sit here.

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`xrpl-utilities-mcp listening on :${port} (http, trust_proxy_hops=${TRUST_PROXY_HOPS})`);
  });
}
