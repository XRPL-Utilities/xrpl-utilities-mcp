/**
 * XR-Trust: directory + drill-down for XRPL permissioned-asset stack
 * (XLS-70 Credentials, XLS-80 PermissionedDomains, XLS-81 Permissioned
 * DEX), with XLS-40 DID identity bridge.
 *
 * /domains, /domain/{id}, /credentials/issuers, and /events are all
 * x402-paid for agents ($0.10 USD per call). The marketing site uses
 * the web-origin bypass; MCP callers pay normally.
 */

import type { ServiceDef } from "../types.js";

export const trust: ServiceDef = {
  id: "trust",
  label: "XR-Trust",
  baseUrl: "https://trust.xrpl-utilities.io",
  manifestUrl: "https://trust.xrpl-utilities.io/agents.json",
  knownSchemaVersions: ["2026-13", "2026-14", "2026-15", "2026-16", "2026-17", "2026-18", "2026-19", "2026-20", "2026-21", "2026-22", "2026-23", "2026-24", "2026-25", "2026-26", "2026-27", "2026-28", "2026-29", "2026-30", "2026-31", "2026-32", "2026-33", "2026-34", "2026-35", "2026-36", "2026-37", "2026-38", "2026-39", "2026-40", "2026-41"],
  tools: [
    {
      name: "xrpl_trust_list_domains",
      description:
        "Paid ($0.10 USD). " +
        "List all XRPL PermissionedDomain (XLS-80) objects on mainnet with owner, " +
        "accepted credentials, and institutional issuer counts. Paginated.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            default: 100,
          },
          offset: {
            type: "integer",
            minimum: 0,
            default: 0,
          },
          payment_signature: {
            type: "string",
            description: "x402 payment header.",
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/domains",
      authMode: "inline_x402",
    },
    {
      name: "xrpl_trust_get_domain",
      description:
        "Paid ($0.10 USD). " +
        "Deep dive on one PermissionedDomain by 64-hex ID: lifecycle history, " +
        "permissioned market activity (XLS-81), and DID/TOML identity.",
      inputSchema: {
        type: "object",
        properties: {
          domain_id: {
            type: "string",
            description: "64-hex LedgerIndex of the domain.",
            pattern: "^[A-Fa-f0-9]{64}$",
          },
          payment_signature: {
            type: "string",
            description: "x402 payment header.",
          },
        },
        required: ["domain_id"],
        additionalProperties: false,
      },
      method: "GET",
      path: "/domain/{domain_id}",
      authMode: "inline_x402",
    },
    {
      name: "xrpl_trust_credential_issuers",
      description:
        "Paid ($0.10 USD). " +
        "All credential issuers across PermissionedDomains: address, label, " +
        "referencing domain count, and credential types issued.",
      inputSchema: {
        type: "object",
        properties: {
          payment_signature: {
            type: "string",
            description: "x402 payment header.",
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/credentials/issuers",
      authMode: "inline_x402",
    },
    {
      name: "xrpl_trust_recent_events",
      description:
        "Free. " +
        "XLS-70/80/81 lifecycle event stream: domain creates/deletes, credential " +
        "activity, permissioned offers and AMM events. Cursor-paginated.",
      inputSchema: {
        type: "object",
        properties: {
          since: {
            type: "string",
            description: "Event-id cursor, e.g. 'trust_lifecycle_42'.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            default: 100,
          },
          tx_type: {
            type: "string",
            description: "Comma-separated TransactionType filter.",
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/events",
      authMode: "free",
    },
    {
      name: "xrpl_trust_list_operators_index",
      description:
        "Free. " +
        "Index of all PermissionedDomain operators: address, label, jurisdiction, " +
        "status, domain count, issuer count. Paginated.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            default: 200,
          },
          offset: {
            type: "integer",
            minimum: 0,
            default: 0,
          },
          status: {
            type: "string",
            description: "all|active|proposed.",
            default: "all",
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/permissioned-domains/operators/index",
      authMode: "free",
    },
    {
      name: "xrpl_trust_operator_drilldown",
      description:
        "Paid ($0.10 USD). " +
        "Deep dive on one PermissionedDomain operator: domains, credentials, " +
        "jurisdiction, DID identity, institutional issuers, and lifecycle events.",
      inputSchema: {
        type: "object",
        properties: {
          owner_address: {
            type: "string",
            description: "XRPL r-address of the operator.",
            pattern: "^r[1-9A-HJ-NP-Za-km-z]{24,34}$",
          },
          payment_signature: {
            type: "string",
            description: "x402 payment header.",
          },
        },
        required: ["owner_address"],
        additionalProperties: false,
      },
      method: "GET",
      path: "/permissioned-domains/operators/{owner_address}",
      authMode: "inline_x402",
    },
    {
      name: "xrpl_trust_operator_attribution",
      description:
        "Free. " +
        "Institutional attribution for one PermissionedDomain operator: parent funder, " +
        "credential types, gated assets, plain-English summary, and confidence tier.",
      inputSchema: {
        type: "object",
        properties: {
          operator_address: {
            type: "string",
            description: "XRPL r-address of the operator.",
            pattern: "^r[1-9A-HJ-NP-Za-km-z]{24,34}$",
          },
        },
        required: ["operator_address"],
        additionalProperties: false,
      },
      method: "GET",
      path: "/permissioned-domains/operators/{operator_address}/attribution",
      authMode: "free",
    },
    {
      name: "xrpl_trust_usage_summary",
      description:
        "Free. " +
        "Ecosystem-wide PermissionedDomain activity aggregate: domain count, " +
        "operator count, credential and market event totals over a configurable window.",
      inputSchema: {
        type: "object",
        properties: {
          window_days: {
            type: "integer",
            description: "Trailing days.",
            minimum: 1,
            maximum: 365,
            default: 30,
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/permissioned-domains/usage-summary",
      authMode: "free",
    },
    {
      name: "xrpl_trust_jurisdictions",
      description:
        "Free. " +
        "Jurisdiction rollup across XRPL's permissioned stack: per-country operator " +
        "and issuer counts with an unattributed bucket.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/jurisdictions",
      authMode: "free",
    },
  ],
};
