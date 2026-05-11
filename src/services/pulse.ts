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
  knownSchemaVersions: ["1.13.0", "1.14.0", "1.15.0", "1.16.0", "1.16.1", "1.17.0", "1.18.0", "1.19.0", "1.20.0", "1.21.0", "1.21.1", "1.21.2", "1.21.3", "1.22.0", "1.22.1", "1.23.0", "1.24.0", "1.25.0", "1.25.1", "1.25.2"],
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
        "flow (Ondo OUSG, Schuman EUROP, Braza USDB + BBRL, SG-FORGE " +
        "EURCV, Guggenheim DCP, Justoken JMWH, OpenEden TBL, RLUSD, " +
        "AUDD, Archax abrdn MMF), and RWA issuer daily aggregate " +
        "snapshots (obligations + trustline-count deltas per UTC day, " +
        "with treasury-balance subtraction for OpenEden TBL). Each event " +
        "carries title, brief, published_at, source_appearances[], " +
        "correlation (news only), active_utility (per-source canonical " +
        "shape), and target_addresses[]. Costs $0.10 USD per call paid " +
        "via XRPL x402.",
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
              "$500,000 (whale-grade only). Pass 0 to see the full " +
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
        "about the same story. Costs $0.10 USD per call paid via XRPL x402.",
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
  ],
};
