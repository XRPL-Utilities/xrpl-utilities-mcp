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
 */

import { randomUUID } from "node:crypto";
import {
  signReceipt,
  attachAttestation,
  HSealClient,
  ed25519Signer,
  type ProviderAttestation,
} from "@xr-utilities/h-seal-provider";

const HSEAL_API = process.env["HSEAL_ENDPOINT"] ?? "https://h-seal.xr-utilities.ai";
const RECEIPT_TOPIC = process.env["HSEAL_RECEIPT_TOPIC"] ?? "0.0.10500472";
const callerIdentity = process.env["MCP_IDENTITY"] ?? process.env["PROVIDER_IDENTITY"];
const callerKeyRaw = process.env["MCP_KEY_RAW"] ?? process.env["PROVIDER_KEY_RAW"];

export const hSealReceiptEnabled: boolean = Boolean(callerIdentity && callerKeyRaw);

export interface HSealReceiptResult {
  body: unknown;
  verdict?: unknown;
  verifyError?: string;
}

function looksLikeAttestation(a: unknown): a is ProviderAttestation {
  return (
    typeof a === "object" && a !== null &&
    typeof (a as Record<string, unknown>)["requestHash"] === "string" &&
    typeof (a as Record<string, unknown>)["responseHash"] === "string" &&
    typeof (a as Record<string, unknown>)["providerIdentity"] === "string"
  );
}

/**
 * Build + verify a 2-party receipt from a backend provider attestation. Always
 * returns the signed `body` (valid + independently verifiable) when signing
 * succeeds; `verdict` is best-effort — if the H-Seal service is unreachable the
 * body still stands and `verifyError` records why. Returns undefined only when
 * H-Seal isn't configured or the attestation is malformed. Never throws.
 */
export async function buildReceipt(opts: {
  serviceEndpoint: string;
  attestation: unknown;
  startedAt: number;
  completedAt: number;
  latencyMs: number;
}): Promise<HSealReceiptResult | undefined> {
  if (!hSealReceiptEnabled) return undefined;
  if (!looksLikeAttestation(opts.attestation)) return undefined;
  const att = opts.attestation;
  try {
    const signed = await signReceipt({
      receipt: {
        taskId: randomUUID(),
        serviceEndpoint: opts.serviceEndpoint,
        requestHash: att.requestHash,   // MUST equal the attestation's
        responseHash: att.responseHash, // MUST equal the attestation's
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
      return { body, verdict };
    } catch (err) {
      return { body, verifyError: (err as Error).message };
    }
  } catch (err) {
    console.error(`[hSealReceipt] sign failed: ${(err as Error).message}`);
    return undefined;
  }
}
