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
  knownSchemaVersions: ["2026-13", "2026-14", "2026-15", "2026-16", "2026-17", "2026-18", "2026-19", "2026-20", "2026-21", "2026-22", "2026-23", "2026-24", "2026-25", "2026-26", "2026-27", "2026-28", "2026-29", "2026-30", "2026-31", "2026-32", "2026-33", "2026-34", "2026-35", "2026-36", "2026-37", "2026-38", "2026-39", "2026-40"],
  tools: [
    {
      name: "xrpl_trust_list_domains",
      description:
        "Paid ($0.10 USD). " +
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
        "Paid ($0.10 USD). " +
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
        "Paid ($0.10 USD). " +
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
        "Paid ($0.10 USD). " +
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
        "Free. " +
        "Lightweight rollup of every PermissionedDomain operator " +
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
        "Free. " +
        "Deep-dive on one PermissionedDomain operator: full domain " +
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
      name: "xrpl_trust_operator_attribution",
      description:
        "Free. " +
        "Auto-walked institutional attribution for one PermissionedDomain " +
        "operator: parent funder address + XRPScan well-known label (Bitso, " +
        "Coinbase, etc.), decoded accepted-credential types (e.g. EUROP_KYC, " +
        "USDC_KYC), per-credentialed-subject IOU trustline issuer cross-" +
        "reference (which stablecoin or asset is gated), and a one-sentence " +
        "plain-English summary plus a confidence tier (high|medium|low). " +
        "Walk fires automatically on every PermissionedDomainSet from the " +
        "subscribe loop; backfilled on Trust startup for pre-existing " +
        "operators. 404 if no walk recorded. Free, public.",
      inputSchema: {
        type: "object",
        properties: {
          operator_address: {
            type: "string",
            description: "XRPL classic address of the PD operator (r-prefix).",
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
        "Ecosystem-wide aggregate of XLS-70/80 + XLS-81 PermissionedDomain " +
        "activity over a configurable window (default 30 days, max 365). " +
        "One row of totals across every domain on mainnet: live domain count, " +
        "operator count, credential creates/accepts/revokes, permissioned " +
        "offer creates/cancels, permissioned payments, AMM events, domain " +
        "lifecycle events, count of operators with auto-walked institutional " +
        "attribution. Ships a short narrative line. Use this to track " +
        "institutional adoption velocity on XRPL's permissioned stack. " +
        "Per-operator detail stays on the paid drill-down. Free, public.",
      inputSchema: {
        type: "object",
        properties: {
          window_days: {
            type: "integer",
            minimum: 1,
            maximum: 365,
            default: 30,
            description: "Aggregation window in days. Default 30.",
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
        "Jurisdiction rollup across XRPL's permissioned stack. For " +
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
