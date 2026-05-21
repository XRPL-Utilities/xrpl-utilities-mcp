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
  knownSchemaVersions: ["2026-13", "2026-14", "2026-15", "2026-16", "2026-17", "2026-18", "2026-19", "2026-20", "2026-21", "2026-22", "2026-23", "2026-24", "2026-25", "2026-26", "2026-27", "2026-28", "2026-29", "2026-30", "2026-31", "2026-32", "2026-33", "2026-34", "2026-35", "2026-36"],
  tools: [
    {
      name: "xrpl_trust_list_domains",
      description:
        "Enumerate all XRPL PermissionedDomain (XLS-80) ledger objects on " +
        "validated mainnet. Each record carries domain_id, owner_address, " +
        "owner_label (XRPScan), accepted_credentials[] (with hex-decoded " +
        "credential_type when ASCII-printable), institutional_issuer_count, " +
        "and full ledger metadata. Walk_status indicates snapshot " +
        "completeness. $0.10 USD per call paid via x402.",
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
            description: "x402 v2 PAYMENT-SIGNATURE header.",
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
        "Drill down on a single PermissionedDomain by 64-hex LedgerIndex. " +
        "Returns the list-view fields plus lifecycle (created_at, " +
        "last_modified_at, modification_count, walked from PreviousTxnID " +
        "meta chain), permissioned_market (XLS-81 owner-side offers + " +
        "AMMs), and identity (XLS-40 DID + parsed .well-known/" +
        "xrp-ledger.toml when published). $0.10 USD per call.",
      inputSchema: {
        type: "object",
        properties: {
          domain_id: {
            type: "string",
            description:
              "64-character hex LedgerIndex of the PermissionedDomain object.",
            pattern: "^[A-Fa-f0-9]{64}$",
          },
          payment_signature: {
            type: "string",
            description: "x402 v2 PAYMENT-SIGNATURE header.",
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
        "Aggregated view of every distinct credential issuer referenced " +
        "across all PermissionedDomain objects. Each entry: issuer_address, " +
        "issuer_label, domains_referencing (count), credential_types_issued " +
        "(sorted unique). Useful for ranking which institutional issuers " +
        "are most adopted on-chain. $0.10 USD per call.",
      inputSchema: {
        type: "object",
        properties: {
          payment_signature: {
            type: "string",
            description: "x402 v2 PAYMENT-SIGNATURE header.",
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
        "XLS-70/80/81 lifecycle event stream sourced from XR-Trust's " +
        "long-lived XRPL WebSocket subscribe loop. Each event carries " +
        "tx_type (PermissionedDomainSet/Delete, CredentialCreate/Accept/" +
        "Delete, OfferCreate/OfferCancel, AMMCreate/etc.), tx_hash, " +
        "account, domain_id, ledger_index, and tx_type-specific payload " +
        "(credential_type for XLS-70, taker_gets/pays for XLS-81). " +
        "Cursor via since=trust_lifecycle_<n>. $0.10 USD per call.",
      inputSchema: {
        type: "object",
        properties: {
          since: {
            type: "string",
            description:
              "Event-id cursor (e.g. 'trust_lifecycle_42'); only events " +
              "after this id are returned. Optional.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            default: 100,
          },
          tx_type: {
            type: "string",
            description:
              "Comma-separated filter on TransactionType (e.g. " +
              "'PermissionedDomainSet,CredentialCreate'). Optional.",
          },
          payment_signature: {
            type: "string",
            description: "x402 v2 PAYMENT-SIGNATURE header.",
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/events",
      authMode: "inline_x402",
    },
    {
      name: "xrpl_trust_list_operators_index",
      description:
        "Free lightweight rollup of every PermissionedDomain operator " +
        "indexed by XR-Trust: operator address, owner label, jurisdiction, " +
        "operator_status (active/proposed/etc.), domain count, credential " +
        "issuer count, and last-event timestamp. Paginated. Use this as " +
        "the index before drilling into a single operator via " +
        "xrpl_trust_operator_drilldown. Free, public.",
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
            description: "Filter on operator_status (all|active|proposed). Default 'all'.",
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
        "Free deep-dive on one PermissionedDomain operator: full domain " +
        "list with accepted-credentials breakdown, jurisdiction, owner " +
        "DID brief (XLS-40 + linked TOML metadata), institutional issuer " +
        "set, recent lifecycle event timeline. Flagship XLS-80 visibility " +
        "surface; complements the paid /scan path with operator-level " +
        "context. Free, public.",
      inputSchema: {
        type: "object",
        properties: {
          owner_address: {
            type: "string",
            description: "XRPL classic address of the operator (r-prefix).",
          },
        },
        required: ["owner_address"],
        additionalProperties: false,
      },
      method: "GET",
      path: "/permissioned-domains/operators/{owner_address}",
      authMode: "free",
    },
    {
      name: "xrpl_trust_jurisdictions",
      description:
        "Free jurisdiction rollup across XRPL's permissioned stack. For " +
        "every ISO-3166-1 alpha-2 country code attributed to at least one " +
        "operator or credential issuer, returns the count per kind plus an " +
        "explicit unattributed bucket with workflow hints. Jurisdiction " +
        "inferred from KNOWN_JURISDICTIONS override, self-attested TOML " +
        "country field, or ccTLD of org_url / source_toml_url / XRPScan " +
        "resolved domain. gTLDs are never auto-attributed. Free, public.",
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
