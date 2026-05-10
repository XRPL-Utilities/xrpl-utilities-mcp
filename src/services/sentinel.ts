/**
 * XR-Sentinel: XRPL wallet activity-pattern classifier.
 *
 * Returns a 0-100 activity_score, an activity_level (Low / Medium /
 * High / Dormant / Unknown), a confidence tier, an array of
 * behavioral signals from a published catalog, and an AI-generated
 * narrative reasoning. Free for the marketing-site origin; paid via
 * x402 ($0.10 USD) for agents.
 */

import type { ServiceDef } from "../types.js";

export const sentinel: ServiceDef = {
  id: "sentinel",
  label: "XR-Sentinel",
  baseUrl: "https://sentinel.xrpl-utilities.io",
  manifestUrl: "https://sentinel.xrpl-utilities.io/agents.json",
  knownSchemaVersions: ["2026-09", "2.8.0", "2.9.0", "2.10.0", "2.11.0", "2.12.0", "2.13.0", "2.14.0"],
  tools: [
    {
      name: "xrpl_sentinel_scan",
      description:
        "Classify an XRPL wallet by its on-chain activity pattern. Returns " +
        "activity_score (0-100, higher = more automated/service-like), " +
        "activity_level (Low/Medium/High/Dormant/Unknown), confidence, " +
        "signals[] from a 24-entry behavioral catalog, top_counterparties[] " +
        "with XRPScan labels, an AI-generated reasoning narrative, and a " +
        "_delta block when prior recorded scans exist. Costs $0.10 USD per " +
        "call paid via XRPL x402 (XRP or RLUSD). Pass payment_signature " +
        "from your x402-xrpl client.",
      inputSchema: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "XRPL classic address (r-prefixed, base58).",
            pattern: "^r[1-9A-HJ-NP-Za-km-z]{24,34}$",
          },
          payment_signature: {
            type: "string",
            description:
              "x402 v2 PAYMENT-SIGNATURE header (base64-encoded JSON of a " +
              "signed XRPL Payment matching one of the requirements returned " +
              "by an initial unauthenticated probe). Omit for free " +
              "marketing-site preview, supply for the paid agent path.",
          },
        },
        required: ["address"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/scan",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
    },
    {
      name: "xrpl_sentinel_scan_history",
      description:
        "Return up to 25 prior recorded scans for an address so an agent " +
        "can read trajectory without scanning the wallet N times. Each " +
        "history row carries score, level, signals, features, and " +
        "scanned_at. Costs $0.10 USD per call paid via XRPL x402. " +
        "Recording began with schema 2.1.0; older paid scans were not " +
        "persisted.",
      inputSchema: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "XRPL classic address.",
            pattern: "^r[1-9A-HJ-NP-Za-km-z]{24,34}$",
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
      path: "/scan/history",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
    },
  ],
};
