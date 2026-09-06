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
  knownSchemaVersions: ["2026-09", "2.8.0", "2.9.0", "2.10.0", "2.11.0", "2.12.0", "2.13.0", "2.14.0", "2.15.0", "2.16.0", "2.17.0", "2.18.0", "2.19.0", "2.19.1", "2.19.2", "2.19.3", "2.20.0", "2.20.1", "2.21.0", "2.22.0", "2.23.0", "2.24.0", "2.25.0", "2.26.0", "2.27.0", "2.28.0", "2.29.0", "2.30.0", "2.31.0", "2.32.0", "2.33.0", "2.33.1", "2.33.2", "2.34.0", "2.35.0", "2.36.0"],
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
    {
      name: "xrpl_sentinel_verify_origin",
      description:
        "Free. " +
        "Before paying an unfamiliar x402 seller, check whether the origin actually controls " +
        "the XRPL account it advertises. Cross-checks the domain's .well-known/xrp-ledger.toml " +
        "against each account's on-ledger Domain field (two-way - either half alone is one " +
        "party's self-assertion), the XLS-40 DID and whether it carries a real verification key " +
        "or is a placeholder, and whether every payTo in the served x402 catalog is one the " +
        "domain itself declares. That last check is the one a swapped catalog fails, because an " +
        "attacker cannot edit the toml without already owning the domain. " +
        "Pass address= instead of url= to ask what an ACCOUNT's claimed identity rests on - the " +
        "only way to test a brand asserted in MPT metadata, which nothing validates. " +
        "Verdicts: verified / partial / unverified / unreadable / mismatch. An unfetchable " +
        "document returns unreadable, never a negative finding. Verifies published identity " +
        "bindings only; not an endorsement of the operator, product or solvency.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "Web origin to verify, e.g. https://example.com. Exactly one of url or address.",
          },
          address: {
            type: "string",
            description:
              "XRPL r-address to verify instead of a URL. Exactly one of url or address.",
            pattern: "^r[1-9A-HJ-NP-Za-km-z]{24,34}$",
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/verify-origin",
      authMode: "free",
    },
  ],
};
