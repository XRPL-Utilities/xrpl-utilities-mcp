# XRPL-Utilities portfolio architecture

Five live services on the `xrpl-utilities.io` domain plus a marketing
site on `xrpl-utilities.com`. Every paid call is settled on XRPL
mainnet via x402 v2 through the [t54](https://t54.ai) facilitator;
all revenue lands on a single treasury wallet (`rKxTz...DBd5`).

## High-level flow

```mermaid
flowchart TB
    %% ──────────── CONSUMERS ─────────────
    subgraph CONSUMERS["Consumers"]
        AGENT["AI agents<br/>(Claude Desktop, SDKs, custom)"]
        HUMAN["Humans<br/>(browser, Xaman wallet)"]
    end

    %% ──────────── ENTRY SURFACES ─────────────
    subgraph ENTRY["Entry surfaces"]
        DOTCOM["xrpl-utilities.com<br/>marketing site<br/>(Cloudflare Pages)"]
        MCP["mcp.xrpl-utilities.io<br/>MCP server (Railway)<br/>+ npm @xrpl-utilities/mcp"]
        DIRECT["Direct API<br/>(curl, x402-xrpl SDK,<br/>any HTTP client)"]
    end

    %% ──────────── BACKEND SERVICES ─────────────
    subgraph BACKEND["XR-* backend services (Railway, FastAPI)"]
        SENTINEL["sentinel.xrpl-utilities.io<br/><b>XR-Sentinel</b><br/>wallet activity classifier<br/>POST /scan, /scan/history"]
        PULSE["pulse.xrpl-utilities.io<br/><b>XR-Pulse</b><br/>normalized signal feed<br/>POST /events/recent"]
        TELEMETRY["telemetry.xrpl-utilities.io<br/><b>XR-Telemetry</b><br/>macro snapshot<br/>POST /scan, /quote -> /status -> /results"]
        TRUST["trust.xrpl-utilities.io<br/><b>XR-Trust</b><br/>XLS-70/80/81 + DID directory<br/>GET /domains, /domain/{id}, /events"]
    end

    %% ──────────── PAYMENT + LEDGER ─────────────
    subgraph LEDGER["Payment + ledger"]
        T54["t54 facilitator<br/>x402 v2 verify + settle"]
        XRPL["XRPL mainnet<br/>QuickNode Clio<br/>+ xrplcluster fallback"]
    end

    TREASURY["💰 Treasury wallet<br/>rKxTz...DBd5<br/>(all x402 settlements)"]

    %% ──────────── EXTERNAL DATA ─────────────
    subgraph EXTERNAL["External data (read-only, free)"]
        XRPSCAN["XRPScan<br/>account labels<br/>(24h cached)"]
        OPENAI["OpenAI<br/>Sentinel reasoning"]
        RSS["12 RSS feeds<br/>SEC / Fed / BoE / BIS /<br/>ECB / crypto press"]
        W3F["Web3Forms<br/>Trust new-domain<br/>notifier email"]
    end

    %% ──────────── CONNECTIONS ─────────────

    %% consumer -> entry
    AGENT -->|"MCP tools<br/>(stdio or HTTP/SSE)"| MCP
    AGENT -->|"native x402"| DIRECT
    HUMAN -->|HTTPS| DOTCOM

    %% entry -> backend
    DOTCOM -->|"Origin header<br/>= free preview"| SENTINEL
    DOTCOM --> PULSE
    DOTCOM --> TELEMETRY
    DOTCOM --> TRUST

    MCP -->|"HTTP passthrough<br/>caller's PAYMENT-SIGNATURE"| SENTINEL
    MCP --> PULSE
    MCP --> TELEMETRY
    MCP --> TRUST

    DIRECT -.->|"any of the above"| BACKEND

    %% inter-service
    PULSE -.->|"/events polling<br/>(domain lifecycle)"| TRUST
    PULSE -.->|"/healthz<br/>(active_float context<br/>via SISTER_PRODUCT_KEY)"| TELEMETRY
    PULSE -.->|"sentinel_lookup<br/>(whale cross-ref)"| SENTINEL

    %% backend -> ledger
    SENTINEL -->|"validated ledger reads"| XRPL
    PULSE --> XRPL
    TELEMETRY --> XRPL
    TRUST --> XRPL

    SENTINEL -->|"verify + settle paid calls"| T54
    PULSE --> T54
    TELEMETRY --> T54
    TRUST --> T54

    T54 -->|"XRP / RLUSD<br/>~$0.10 USD per call"| TREASURY

    %% backend -> external
    SENTINEL -.-> XRPSCAN
    PULSE -.-> XRPSCAN
    TRUST -.-> XRPSCAN
    SENTINEL -.-> OPENAI
    PULSE -.-> RSS
    TRUST -.-> W3F
```

## Quick reference

### What each surface is for

| Surface | Audience | Auth model |
|---|---|---|
| `xrpl-utilities.com` | Humans browsing the portfolio | Free preview via `Origin:` header (web bypass) |
| `mcp.xrpl-utilities.io` | AI agents using MCP clients (Claude Desktop, SDKs) | Stateless passthrough; caller supplies own x402 |
| `npm @xrpl-utilities/mcp` | AI agents running MCP locally via stdio | Same as above; runs on user's machine |
| Direct API (`*.xrpl-utilities.io`) | Custom integrations, x402-xrpl SDK users | Native x402 v2 |

### What each backend does

| Service | One-line | Pricing | Schema |
|---|---|---|---|
| **XR-Sentinel** | XRPL wallet activity-pattern classifier (0-100 score, 22-signal catalog, AI reasoning) | $0.10 per scan | 2.6.0 |
| **XR-Pulse** | Normalized signal feed mixing public-source news, on-chain whales, and XLS-70/80/81 lifecycle | $0.10 per query | 1.10.1 |
| **XR-Telemetry** | XRPL macro snapshot (supply, liquidity, AMM, derived Active Float, Burst Math floor) | $0.10 per snapshot | 1.1.0 |
| **XR-Trust** | XLS-70/80/81 + XLS-40 DID directory and drill-down | $0.10 per call | 2026-11 |

### Inter-service edges (the dotted lines)

| From | To | Purpose | Auth |
|---|---|---|---|
| Pulse | Trust `/events` | XLS-70/80/81 lifecycle ingestion (every 120s) | Public read |
| Pulse | Telemetry `/healthz` | Active Float context attached to whale events | `SISTER_PRODUCT_KEY` shared bypass |
| Pulse | Sentinel (`sentinel_lookup`) | Cross-reference for whale addresses (sender + receiver classification) | `TELEMETRY_SISTER_KEY` |

### Schema-discipline boundary

Every backend exposes:

- `/agents.json` — agent-discovery manifest (name, capabilities, endpoints, schema_version)
- `/schema` — field-level output shape
- `/healthz` — liveness + dependency probes
- `/stats` — operational counters
- `/.well-known/agents.json` — same as `/agents.json` at the canonical path

Each repo has a pre-commit hook (`.githooks/pre-commit`) that blocks
edits to `agents.json` without a corresponding `schema_version` bump.
The MCP server's startup validator pings each service's live
`/agents.json` and refuses to start if a registered tool's path is
missing from the manifest.

### Payment flow

```
Agent ──signed XRPL Payment as PAYMENT-SIGNATURE──▶ MCP server
                                                       │
                                                       │ forwards verbatim
                                                       ▼
                                                  Backend service
                                                       │
                                                       │ verify
                                                       ▼
                                                  t54 facilitator
                                                       │
                                                       │ submit to ledger
                                                       ▼
                                                  XRPL mainnet
                                                       │
                                                       │ ~3-5s ledger close
                                                       ▼
                                                  💰 Treasury (rKxTz...DBd5)
                                                       │
                                                       ▼
                                                  Backend runs the work
                                                       │
                                                       ▼
                                                  Response back through
                                                  MCP/direct to agent
```

The MCP server holds no wallets, takes no cut, runs no proprietary
logic. It's a transparent proxy; revenue flow is identical to direct
API users.
