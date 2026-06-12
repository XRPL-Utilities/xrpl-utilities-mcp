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
  knownSchemaVersions: ["2026-09", "2.8.0", "2.9.0", "2.10.0", "2.11.0", "2.12.0", "2.13.0", "2.14.0", "2.15.0", "2.16.0", "2.17.0", "2.18.0", "2.19.0", "2.19.1", "2.19.2", "2.19.3", "2.20.0", "2.20.1", "2.21.0", "2.22.0", "2.23.0", "2.24.0", "2.25.0", "2.26.0", "2.27.0", "2.28.0"],
  tools: [
    {
      name: "xrpl_sentinel_scan",
      description:
        "Paid ($0.10 USD). " +
        "Classify an XRPL wallet by on-chain activity pattern. Returns activity_score (0-100), " +
        "activity_level, confidence, behavioral signals, top counterparties, and AI reasoning.",
      inputSchema: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "XRPL r-address.",
            pattern: "^r[1-9A-HJ-NP-Za-km-z]{24,34}$",
          },
          payment_signature: {
            type: "string",
            description: "x402 payment header.",
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
        "Paid ($0.10 USD). " +
        "Return up to 25 prior recorded scans for an address to read score trajectory over time.",
      inputSchema: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "XRPL r-address.",
            pattern: "^r[1-9A-HJ-NP-Za-km-z]{24,34}$",
          },
          payment_signature: {
            type: "string",
            description: "x402 payment header.",
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
