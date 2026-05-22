/**
 * XR-Pulse: normalized XRPL signal feed bridging public-source news,
 * on-chain whale activity, and XLS-70/80/81 permissioned-domain
 * lifecycle events into one time-ordered stream.
 *
 * News carries a four-hour XRPL price-window correlation. Whale rows
 * carry sender + receiver addresses with XRPScan institutional
 * labels. Permissioned-domain rows mirror XR-Trust's /events with
 * cross-product enrichment. Paid via x402 ($0.10 USD per query).
 */

import type { ServiceDef } from "../types.js";

export const pulse: ServiceDef = {
  id: "pulse",
  label: "XR-Pulse",
  baseUrl: "https://pulse.xrpl-utilities.io",
  manifestUrl: "https://pulse.xrpl-utilities.io/agents.json",
  knownSchemaVersions: ["1.13.0", "1.14.0", "1.15.0", "1.16.0", "1.16.1", "1.17.0", "1.18.0", "1.19.0", "1.20.0", "1.21.0", "1.21.1", "1.21.2", "1.21.3", "1.22.0", "1.22.1", "1.23.0", "1.24.0", "1.25.0", "1.25.1", "1.25.2", "1.26.0", "1.27.0", "1.28.0", "1.28.1", "1.29.0", "1.30.0", "1.31.0", "1.32.0", "1.32.1", "1.32.2", "1.32.3", "1.33.0", "1.34.0", "1.34.1", "1.34.2", "1.35.0", "1.36.0", "1.37.0", "1.38.0", "1.39.0", "1.39.1", "1.39.2", "1.39.3", "1.40.0", "1.40.1", "1.41.0", "1.41.1", "1.42.0", "1.43.0", "1.44.0", "1.45.0", "1.46.0", "1.46.1", "1.46.2", "1.47.0", "1.48.0", "1.49.0", "1.50.0", "1.51.0", "1.52.0", "1.53.0", "1.54.0", "1.55.0", "1.56.0", "1.57.0", "1.57.1", "1.58.0", "1.58.1", "1.59.0", "1.60.0", "1.61.0", "1.62.0", "1.63.0", "1.64.0", "1.64.1", "1.65.0", "1.66.0", "1.66.1", "1.67.0"],
  tools: [
    {
      name: "xrpl_pulse_recent_events",
      description:
        "Return the most-recent normalized XRPL signal events newest-first. " +
        "Mixes six streams: public-source news (regulatory press + " +
        "central banks + crypto media filtered for XRP/RLUSD/XRPL/Ripple), " +
        "on-chain whale activity (every Payment above the storage " +
        "threshold), XLS-70/80/81 permissioned-domain lifecycle events " +
        "sourced from XR-Trust, Sentinel state-change signals " +
        "(activity-level transitions + first-fire of " +
        "INSTITUTIONAL_SCALE_FLOW / DORMANT_REAWAKENING / " +
        "SCORE_TRAJECTORY_BOT_ONBOARDING), RWA issuer per-mint/per-burn " +
        "flow (Ondo OUSG (permissioned + public), Schuman EUROP, " +
        "Braza USDB + BBRL, SG-FORGE EURCV, Guggenheim DCP, Justoken " +
        "JMWH, OpenEden TBL, RLUSD, AUDD, Archax abrdn MMF, Circle " +
        "USDCAllow, Ctrl Alt DIA-L-COL1, Ctrl Alt DLD-25-24722-IAHG, " +
        "Quantoz EURQ), and RWA issuer daily aggregate snapshots " +
        "(obligations + trustline-count deltas per UTC day, with " +
        "treasury-balance subtraction applied across USD-pegged issuers " +
        "as appropriate). Each event " +
        "carries title, brief, published_at, source_appearances[], " +
        "correlation (news only), active_utility (per-source canonical " +
        "shape), and target_addresses[]. Costs $0.10 USD per call paid " +
        "via x402 (XRP/RLUSD on XRPL or USDC on Base).",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: "Max events to return (1-500). Default 50.",
            minimum: 1,
            maximum: 500,
            default: 50,
          },
          since_iso: {
            type: "string",
            description:
              "ISO 8601 timestamp; only events with published_at >= this " +
              "are returned. Optional.",
          },
          before_iso: {
            type: "string",
            description:
              "ISO 8601 cursor for backward pagination. When set, only " +
              "events strictly older than this timestamp are returned. " +
              "Pair with the oldest event's published_at from a prior " +
              "response to walk backward through history. Optional.",
          },
          kind: {
            type: "string",
            enum: ["news", "activity"],
            description:
              "Source-bucket filter. 'news' returns RSS sources only; " +
              "'activity' returns whale + sentinel_signal + " +
              "permissioned_domain rows. Omit to return the mixed feed.",
          },
          min_whale_usd: {
            type: "number",
            description:
              "Suppress whale events below this USD threshold. Default " +
              "$1,000,000 (whale-grade only). Pass 0 to see the full " +
              "$50k+ activity stream.",
            minimum: 0,
          },
          payment_signature: {
            type: "string",
            description: "x402 v2 PAYMENT-SIGNATURE header.",
          },
        },
        additionalProperties: false,
      },
      method: "POST",
      path: "/events/recent",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
    },
    {
      name: "xrpl_pulse_events_by_address",
      description:
        "Return Pulse events that reference a specific XRPL classic " +
        "address, newest-first. Match strategy spans all event sources: " +
        "whale events where the address is sender or receiver, " +
        "sentinel_signal events for that address, news + permissioned- " +
        "domain events whose target_addresses[] includes it. Useful " +
        "as the on-chain-history complement to xrpl_sentinel_scan " +
        "(behavioral classification of one wallet); together they answer " +
        "'what does this wallet look like AND what has it actually been " +
        "doing on the public feed?'. No title-similarity clustering on " +
        "this endpoint - events about the same wallet aren't necessarily " +
        "about the same story. Costs $0.10 USD per call paid via x402 (XRP/RLUSD on XRPL or USDC on Base).",
      inputSchema: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "XRPL classic address (starts with 'r', 25-35 chars).",
          },
          limit: {
            type: "integer",
            description: "Max events to return (1-200). Default 50.",
            minimum: 1,
            maximum: 200,
            default: 50,
          },
          since_iso: {
            type: "string",
            description:
              "ISO 8601 timestamp; only events with published_at >= this " +
              "are returned. Optional.",
          },
          payment_signature: {
            type: "string",
            description: "x402 v2 PAYMENT-SIGNATURE header.",
          },
        },
        required: ["address"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/events/by-address",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
    },
    {
      name: "xrpl_pulse_stream_purchase",
      description:
        "Buy a time-boxed XR-Pulse live WebSocket subscription. Returns " +
        "a stream_token (HS256 JWT) plus a ws_url. Open the WebSocket " +
        "and pass the token as the ?token= query parameter; events are " +
        "pushed as they fire, with server-side filtering by source / " +
        "signal / min USD value bound into the token at purchase time. " +
        "Tiers: 1h ~$0.50, 6h ~$2.50, 24h ~$7.50 (XRP/RLUSD on XRPL or USDC on Base via " +
        "x402). Reconnect with the same token until expires_at_unix; " +
        "no event replay across reconnects (use xrpl_pulse_recent_events " +
        "to catch up history). The WebSocket itself is not exposed as " +
        "an MCP tool (MCP is request/response) — agents take the token " +
        "and open the WebSocket directly. v2 of this surface will swap " +
        "the time-boxed billing for native XRPL Payment Channels with " +
        "per-message claims.",
      inputSchema: {
        type: "object",
        properties: {
          duration: {
            type: "string",
            enum: ["1h", "6h", "24h"],
            description: "Subscription window length. Default 1h.",
            default: "1h",
          },
          min_usd: {
            type: "number",
            description:
              "Optional server-side filter: drop whale-style events " +
              "whose active_utility.usd_value is below this floor. " +
              "Bound into the JWT — change filters means buying a new " +
              "subscription.",
            minimum: 0,
          },
          sources: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional source allowlist (whale_xrpl, sentinel_signal, " +
              "permissioned_domain_lifecycle, rwa_issuer_flow, " +
              "rwa_issuer_daily, rwa_amm_pool_state, plus any news " +
              "source key). Omit to receive every source.",
            maxItems: 32,
          },
          signals: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional signal allowlist (whale_transfer, " +
              "INSTITUTIONAL_SCALE_FLOW, issuer_deepfreeze, " +
              "token_escrow_event, permissioned_dex_event, etc.). " +
              "Filters on active_utility.signal (whale-style) or " +
              "active_utility.signals[].signal (news-style).",
            maxItems: 32,
          },
          payment_signature: {
            type: "string",
            description: "x402 v2 PAYMENT-SIGNATURE header.",
          },
        },
        additionalProperties: false,
      },
      method: "POST",
      path: "/stream/purchase",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
    },
    {
      name: "xrpl_pulse_ripple_counterparties",
      description:
        "Anonymized view of XR-Pulse's Ripple-counterparty auto-discovery " +
        "loop plus the relay-burst detector. The discovery loop polls a " +
        "curated set of Ripple-controlled wallets (multi-signer treasuries, " +
        "the RLUSD distribution wallet, and TOML-attested escrow wallets) " +
        "for outgoing Payments to new destinations and scores each on " +
        "seven weighted heuristics (XRP balance, RLUSD pre-approval, " +
        "account age, multi-exchange connectivity, intake-treasury " +
        "fingerprint, Ripple-funded-MM inflow, recency). The relay-burst " +
        "detector flags multi-hop pure-payment chains (>=3 hops, >=$30M " +
        "total, >=$10M per hop, within 1h) where at least one wallet is " +
        "operator-labeled. Returns score-tier and funding-source " +
        "distributions plus relay-burst summaries (hop_count, total_usd, " +
        "anchor_label, news_correlation_count); specific wallet addresses " +
        "are intentionally NOT exposed on this surface. Free, public.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description:
              "Max candidate rows to summarize (1-200). Default 50.",
            minimum: 1,
            maximum: 200,
            default: 50,
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/ripple-counterparties",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_ripple_topology",
      description:
        "Public-attribution map of the Ripple ecosystem on XRPL. Three " +
        "columns matching the xrpl-utilities.com/lineage/ topology view: " +
        "Source (Ripple-published or XRPScan-attested infrastructure — " +
        "issuer, distribution, MM hub, root treasury, escrow wallets, " +
        "burn agent — wallet addresses + labels exposed), Pipeline (the " +
        "operator-curated middle layer; shown by role + count only, " +
        "specific addresses intentionally not exposed because the " +
        "operator-curated wallet list is the moat), and Exits (named " +
        "CEX hot wallets attested by XRPScan well-known — Binance, " +
        "Coinbase, Bitso, etc. — wallet addresses + entity names " +
        "exposed). Free, public.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/ripple-topology",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_cex_attribution",
      description:
        "Anonymized view of XR-Pulse's cex_attribution_walker findings. " +
        "The walker complements the relay-burst detector: it fires when " +
        "an operator-labeled CEX wallet (Bitso, Binance, Coinbase, Gemini, " +
        "Kraken, Bitstamp, OKX, Ceffu, etc.) receives a whale Payment over " +
        "$5M and walks the chain backward up to 4 hops within a 4h window, " +
        "looking for unlabeled intermediate wallets that the relay-burst " +
        "detector skips because they pass through long-standing Ripple " +
        "infrastructure that doesn't show the burst fingerprint. Each row " +
        "is one unlabeled intermediate plus the chain it sat in (hop " +
        "count, total USD, sanitized anchor label, sanitized terminal CEX " +
        "label). Specific wallet addresses, intermediate addresses, and " +
        "tx hashes are NOT exposed on this surface. Free, public.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description:
              "Max candidate rows to summarize (1-200). Default 50.",
            minimum: 1,
            maximum: 200,
            default: 50,
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/cex-attribution",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_network_stats",
      description:
        "Free XRPL network summary: total funded addresses (per the " +
        "api.xrpl.to source), live trustline count, live offer count, " +
        "24h active address count, and snapshot freshness. Use this as " +
        "a baseline-state probe before paying for /events/recent or " +
        "deciding whether activity-level signals are likely meaningful. " +
        "Free, public.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/network",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_whale_flow_24h",
      description:
        "Free aggregate of all whale_xrpl Payments above the storage " +
        "threshold in the trailing 24h. Returns total USD value, total " +
        "tx count, top sender + receiver labels (institutional " +
        "watchlist + auto-promoted), per-currency breakdown (XRP, RLUSD, " +
        "other IOUs). Comparable across services and days; no specific " +
        "wallet addresses are returned. Free, public.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/whale-flow-24h",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_exchange_flow_delta",
      description:
        "Free per-UTC-day series of net XRPL exchange flow: inbound, " +
        "outbound, net (positive = exchanges are net-receivers of " +
        "XRP), 24h settlement-volume USD, active-float bridge components. " +
        "Same series XR-Flows /stats/correlation overlays with ETF AUM " +
        "for the correlation headline. Free, public.",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "integer",
            description: "Trailing day count (1-90). Default 30.",
            minimum: 1,
            maximum: 90,
            default: 30,
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/exchange-flow-delta",
      authMode: "free",
    },
    {
      name: "xrpl_pulse_rwa_summary",
      description:
        "Free RWA issuer rollup: per-issuer current obligations, " +
        "net-circulating (treasury-adjusted where applicable), trustline " +
        "count, 24h mint and burn flow, AMM-of-RWA pool exposure. Covers " +
        "the full operator-curated issuer set plus auto-discovered " +
        "candidates surfaced via the rwa_issuer_discovery loop. Native " +
        "unit-of-account; no fabricated USD valuation. Same data backing " +
        "XR-Vault's per-issuer deep dive, surfaced here as a free " +
        "cross-issuer view. Free, public.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/stats/rwa-summary",
      authMode: "free",
    },
  ],
};
