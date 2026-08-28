/**
 * 2-party H-Seal receipt assembly.
 *
 * When a backend co-signs its own output (returning an `hSealAttestation` on the
 * result), the MCP is the CALLER: it signs a receipt binding
 *   caller   = the MCP (this gateway identity)
 *   provider = the backend that computed + attested the result
 * and re-verifies it against the H-Seal service. The signed receipt body plus
 * the verdict ride on the tool result's `_meta.hSealReceipt`.
 *
 * An H-Seal receipt carries caller + exactly ONE provider, so this is distinct
 * from the MCP's own gateway attestation (`_meta.hSeal`), which stays as
 * supplementary metadata.
 *
 * Caller identity/key come from MCP_IDENTITY / MCP_KEY_RAW, falling back to the
 * gateway PROVIDER_IDENTITY / PROVIDER_KEY_RAW (same key, caller role here) so
 * no new secret is required. Inert when unset. NB: the H-Seal API host is
 * h-seal.xr-utilities.ai (the .com host is a browser-only, Cloudflare-challenged
 * surface and returns 403 to server clients).
 *
 * NOTHING in the attestation may be taken on trust. The receipt carries a real
 * signature from the operator's key, so a backend (or anything that can shape a
 * proxied response) that hands us an invented (requestHash, responseHash,
 * providerIdentity) triple would otherwise get the operator to vouch for
 * arbitrary content on behalf of an arbitrary third party. Before signing:
 *
 *   1. responseHash is recomputed from the body we actually delivered. It is
 *      the one hash the MCP can corroborate on its own.
 *   2. The provider's own ed25519 signature is verified, AND the public key on
 *      the wire must derive the r-address in providerIdentity - otherwise any
 *      self-signed blob naming a real service would pass.
 *   3. providerIdentity is pinned to HSEAL_ALLOWED_PROVIDERS when that env var
 *      is set (comma-separated CAIP-10 identities).
 *
 * requestHash stays PROVIDER-ASSERTED: backends hash a synthetic
 * {"tool": ...} object the MCP cannot reproduce, so a strict comparison would
 * reject every live receipt. The result says so via `requestHashBasis` rather
 * than implying the caller corroborated it.
 */

import { createHash, createPublicKey, randomUUID, verify as verifySignature } from "node:crypto";
import {
  signReceipt,
  attachAttestation,
  hashCanonicalJson,
  sha256Hex,
  HSealClient,
  ed25519Signer,
  type ProviderAttestation,
} from "@xr-utilities/h-seal-provider";

const HSEAL_API = process.env["HSEAL_ENDPOINT"] ?? "https://h-seal.xr-utilities.ai";
const RECEIPT_TOPIC = process.env["HSEAL_RECEIPT_TOPIC"] ?? "0.0.10500472";
const callerIdentity = process.env["MCP_IDENTITY"] ?? process.env["PROVIDER_IDENTITY"];
const callerKeyRaw = process.env["MCP_KEY_RAW"] ?? process.env["PROVIDER_KEY_RAW"];
const allowedProviders = (process.env["HSEAL_ALLOWED_PROVIDERS"] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** How the receipt's requestHash was established. See the module header. */
const REQUEST_HASH_BASIS = "provider_asserted";

export const hSealReceiptEnabled: boolean = Boolean(callerIdentity && callerKeyRaw);

export interface HSealReceiptResult {
  /** The signed receipt. Absent whenever the MCP refused to sign, or H-Seal explicitly rejected. */
  body?: unknown;
  verdict?: unknown;
  verifyError?: string;
  /** Always "provider_asserted" — the MCP cannot reproduce the backend's requestHash preimage. */
  requestHashBasis?: string;
}

/**
 * A well-formed attestation carries the provider's own signature. Accepting a
 * three-string blob would let a "2-party" receipt be emitted with no second
 * party at all, so providerSignature / scheme / issuedAt are required here.
 */
function looksLikeAttestation(a: unknown): a is ProviderAttestation {
  if (typeof a !== "object" || a === null) return false;
  const r = a as Record<string, unknown>;
  return (
    typeof r["requestHash"] === "string" &&
    typeof r["responseHash"] === "string" &&
    typeof r["providerIdentity"] === "string" &&
    typeof r["providerSignature"] === "string" &&
    typeof r["providerSignatureScheme"] === "string" &&
    typeof r["providerIssuedAt"] === "number"
  );
}

const XRPL_BASE58 = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";
// SPKI DER header for a raw ed25519 public key: 12 fixed bytes + the 32-byte key.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function base58Xrpl(buf: Buffer): string {
  let n = BigInt("0x" + (buf.toString("hex") || "0"));
  let out = "";
  while (n > 0n) {
    out = XRPL_BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    out = XRPL_BASE58[0] + out;
  }
  return out;
}

/** Classic r-address for a 33-byte XRPL public key (0xED prefix + raw ed25519). */
function xrplAddressFromPubKey(pubKey: Buffer): string {
  const accountId = createHash("ripemd160")
    .update(createHash("sha256").update(pubKey).digest())
    .digest();
  const payload = Buffer.concat([Buffer.from([0x00]), accountId]);
  const checksum = createHash("sha256")
    .update(createHash("sha256").update(payload).digest())
    .digest()
    .subarray(0, 4);
  return base58Xrpl(Buffer.concat([payload, checksum]));
}

/**
 * Authenticate the provider. Returns null when the attestation really was
 * signed by the account it names, otherwise the reason it wasn't. The preimage
 * mirrors the SDK's signProviderAttestation exactly: the sha256 of the
 * canonical JSON of {kind: "provider_attest", payload}, signed raw for XRPL.
 */
function providerSignatureProblem(att: ProviderAttestation): string | null {
  const parts = att.providerIdentity.split(":");
  const namespace = parts[0];
  const address = parts.slice(2).join(":");
  if (namespace !== "xrpl" || !address) {
    return `providerIdentity ${att.providerIdentity} is not an xrpl CAIP-10 identity; cannot authenticate it`;
  }
  if (att.providerSignatureScheme !== "ed25519") {
    return `providerSignatureScheme ${att.providerSignatureScheme} is not ed25519`;
  }
  const wire = /^ed([0-9a-fA-F]{64}):([0-9a-fA-F]{128})$/.exec(att.providerSignature);
  if (!wire) {
    return "providerSignature is not the ed<pubkey_hex>:<sig_hex> wire form";
  }
  const pubKeyRaw = Buffer.from(wire[1] as string, "hex");
  const signature = Buffer.from(wire[2] as string, "hex");

  // Bind the key to the identity. Without this a self-signed blob naming any
  // r-address verifies against its own key and passes.
  const derived = xrplAddressFromPubKey(Buffer.concat([Buffer.from([0xed]), pubKeyRaw]));
  if (derived !== address) {
    return `providerSignature public key derives ${derived}, not the ${address} in providerIdentity`;
  }

  const digest = hashCanonicalJson({
    kind: "provider_attest",
    payload: {
      providerIdentity: att.providerIdentity,
      requestHash: att.requestHash,
      responseHash: att.responseHash,
      providerIssuedAt: att.providerIssuedAt,
    },
  });
  const pubKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, pubKeyRaw]),
    format: "der",
    type: "spki",
  });
  if (!verifySignature(null, digest, pubKey, signature)) {
    return "providerSignature does not verify over the attested payload";
  }
  return null;
}

// One line per unpinned provider, not one per call: the operator needs to see
// it once to populate HSEAL_ALLOWED_PROVIDERS, not on every tool call.
const warnedUnpinned = new Set<string>();

/**
 * Build + verify a 2-party receipt from a backend provider attestation. Returns
 * the signed `body` (valid + independently verifiable) when signing succeeds;
 * `verdict` is best-effort — if the H-Seal service is unreachable the body
 * still stands and `verifyError` records why, but an explicit H-Seal reject
 * drops the body. A responseHash that does not match what we delivered also
 * drops the body, and says so in `verifyError` rather than vanishing, as does
 * every other refusal: a malformed attestation, a provider signature that does
 * not authenticate, and an identity outside HSEAL_ALLOWED_PROVIDERS all return
 * a body-less result with a reason. Only two cases return undefined - H-Seal
 * not being configured at all, and our own signing throwing. Never throws.
 */
export async function buildReceipt(opts: {
  serviceEndpoint: string;
  attestation: unknown;
  /** The body actually delivered to the caller (result minus the attestation envelope). */
  responseBody: unknown;
  startedAt: number;
  completedAt: number;
  latencyMs: number;
}): Promise<HSealReceiptResult | undefined> {
  // The ONLY branch that may stay silent: H-Seal genuinely is not configured,
  // so the absence of _meta.hSealReceipt is the truthful answer.
  if (!hSealReceiptEnabled) return undefined;
  if (!looksLikeAttestation(opts.attestation)) {
    // The server only calls us when the backend put SOMETHING in the
    // attestation slot, so a shape we cannot parse is producer drift, not
    // "no attestation". Do not echo the blob back to the caller.
    console.error("[hSealReceipt] attestation is missing required fields (see looksLikeAttestation); refusing to sign");
    return { verifyError: "provider attestation is malformed", requestHashBasis: REQUEST_HASH_BASIS };
  }
  const att = opts.attestation;

  // Corroborate the one hash we can compute ourselves. The backends hash the
  // canonical JSON of the response minus the attestation envelope, which is
  // exactly what the server hands us here. A mismatch means the receipt would
  // bind our signature to bytes we never served.
  if (sha256Hex(opts.responseBody) !== att.responseHash) {
    // Refusing is right, but returning nothing made the refusal invisible: the
    // flagship paid tool would just stop carrying _meta.hSealReceipt with no
    // signal past one log line. Name the provider so an operator can tell which
    // backend drifted (a producer that attests before its response model
    // appends footer fields lands here on EVERY call).
    console.error(
      `[hSealReceipt] responseHash does not match the delivered body for ${att.providerIdentity}; refusing to sign`,
    );
    return { verifyError: "responseHash does not match the delivered body", requestHashBasis: REQUEST_HASH_BASIS };
  }

  const problem = providerSignatureProblem(att);
  if (problem) {
    console.error(`[hSealReceipt] provider attestation rejected: ${problem}; refusing to sign`);
    // `problem` names an UNAUTHENTICATED identity/key, so it stays in the log.
    // The caller gets the fact of the refusal, which is the part that must not
    // be indistinguishable from the feature being switched off.
    return { verifyError: "provider attestation failed authentication", requestHashBasis: REQUEST_HASH_BASIS };
  }

  if (allowedProviders.length > 0) {
    if (!allowedProviders.includes(att.providerIdentity)) {
      console.error(
        `[hSealReceipt] providerIdentity ${att.providerIdentity} is not in HSEAL_ALLOWED_PROVIDERS; refusing to sign`,
      );
      return { verifyError: "provider is not in HSEAL_ALLOWED_PROVIDERS", requestHashBasis: REQUEST_HASH_BASIS };
    }
  } else if (!warnedUnpinned.has(att.providerIdentity)) {
    warnedUnpinned.add(att.providerIdentity);
    console.error(
      `[hSealReceipt] HSEAL_ALLOWED_PROVIDERS is unset; co-signing for self-attested provider ${att.providerIdentity}. ` +
        `Set it to the known XR-* identities to pin who this key will vouch for.`,
    );
  }

  try {
    const signed = await signReceipt({
      receipt: {
        taskId: randomUUID(),
        serviceEndpoint: opts.serviceEndpoint,
        requestHash: att.requestHash,   // provider-asserted, see REQUEST_HASH_BASIS
        responseHash: att.responseHash, // corroborated against the delivered body above
        resultStatus: "success",
        startedAt: opts.startedAt,
        completedAt: opts.completedAt,
        latencyMs: opts.latencyMs,
        callerIdentity: callerIdentity as string,   // signed verbatim
        providerIdentity: att.providerIdentity,
        receiptTopicId: RECEIPT_TOPIC,
      },
      signer: ed25519Signer(callerKeyRaw as string),
      network: "mainnet",
    });
    const body = attachAttestation(signed.body, att);
    try {
      const verdict = await new HSealClient({ endpoint: HSEAL_API }).verify(body);
      if (verdict.ok === false) {
        // An explicit reject is the one verdict that must drop the body:
        // handing the caller a receipt H-Seal has already refused presents it
        // as provenance it does not carry. An unreachable H-Seal is different
        // — the body verifies independently, so it still rides out below.
        const reason = verdict.reason ?? "no reason given";
        console.error(`[hSealReceipt] H-Seal rejected the receipt: ${reason}`);
        return { verifyError: `H-Seal rejected the receipt: ${reason}`, requestHashBasis: REQUEST_HASH_BASIS };
      }
      return { body, verdict, requestHashBasis: REQUEST_HASH_BASIS };
    } catch (err) {
      return { body, verifyError: (err as Error).message, requestHashBasis: REQUEST_HASH_BASIS };
    }
  } catch (err) {
    console.error(`[hSealReceipt] sign failed: ${(err as Error).message}`);
    return undefined;
  }
}
