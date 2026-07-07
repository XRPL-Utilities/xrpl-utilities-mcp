/**
 * H-Seal provider co-signing for the MCP surface.
 *
 * After a tool response is produced, the MCP server co-signs the
 * (request, response) pair so the caller can anchor a tamper-evident,
 * independently verifiable H-Seal receipt that carries our attestation that we
 * served it. See https://h-seal.xr-utilities.com and the H-Series white paper.
 *
 * Configured entirely from env — never hardcode a signing key:
 *   PROVIDER_IDENTITY  our CAIP-10 identity, e.g. "xrpl:0:r..."
 *                      (or "hedera:mainnet:0.0.x")
 *   PROVIDER_KEY_RAW   32-byte ed25519 seed (hex) for that identity
 *
 * When either is unset the module is inert: attest() returns undefined and the
 * response path is untouched. That keeps the live server safe if the key is not
 * provisioned yet, and makes co-signing strictly additive — a paid tool call
 * that succeeds today keeps succeeding whether or not H-Seal is configured.
 */

import {
  HSealProvider,
  ed25519Signer,
  type ProviderAttestation,
} from "@xr-utilities/h-seal-provider";

const identity = process.env["PROVIDER_IDENTITY"];
const keyRaw = process.env["PROVIDER_KEY_RAW"];

/** True when both PROVIDER_IDENTITY and PROVIDER_KEY_RAW are present. */
export const hSealEnabled: boolean = Boolean(identity && keyRaw);

const provider: HSealProvider | null = hSealEnabled
  ? new HSealProvider({
      identity: identity as string,
      signer: ed25519Signer(keyRaw as string),
      network: "mainnet",
    })
  : null;

/**
 * Co-sign a request/response pair. Returns the provider attestation, or
 * undefined when H-Seal is not configured. Never throws: a receipt-signing
 * failure must not break the paid tool call it decorates.
 */
export async function attest(
  request: unknown,
  response: unknown,
): Promise<ProviderAttestation | undefined> {
  if (!provider) return undefined;
  try {
    return await provider.attest({ request, response });
  } catch (err) {
    console.error(
      `[hSeal] attest failed, returning response without attestation: ${
        (err as Error).message
      }`,
    );
    return undefined;
  }
}

/** The configured provider (null when env is unset). Exposed for smokes/tests. */
export const hSeal = provider;
