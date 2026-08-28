// Regression cover for the 2-party receipt guards. The operator's key signs
// these receipts, so every one of these cases used to end with a genuine
// signature over content the MCP never checked.

import test from "node:test";
import assert from "node:assert/strict";
import { generateEd25519, signProviderAttestation, sha256Hex } from "@xr-utilities/h-seal-provider";
import { xrplAddress } from "./xrplAddress.mjs";

const provider = generateEd25519();
const stranger = generateEd25519();
const PROVIDER_ID = `xrpl:0:${xrplAddress(provider.publicKeyRaw)}`;
const STRANGER_ID = `xrpl:0:${xrplAddress(stranger.publicKeyRaw)}`;

// Set before the module is imported: it reads its config once, at load.
process.env.PROVIDER_IDENTITY = "xrpl:0:rL8nM79KFCJDpn3sxsomeCallerAddr";
process.env.PROVIDER_KEY_RAW = Buffer.alloc(32, 7).toString("hex");
process.env.HSEAL_ALLOWED_PROVIDERS = PROVIDER_ID;
// Unreachable on purpose: H-Seal being down must leave the body standing.
process.env.HSEAL_ENDPOINT = "http://127.0.0.1:1";

const { buildReceipt } = await import("../dist/hSealReceipt.js");

// A refusal must never sign a body, and must never be indistinguishable from
// H-Seal being switched off. `undefined` means "not configured"; a refusal
// returns a body-less result carrying the reason.
function assertRefusedButNotSilent(out) {
  assert.notEqual(out, undefined, "a refusal must not look like H-Seal being off");
  assert.equal(out.body, undefined, "a refusal must not sign anything");
  assert.equal(typeof out.verifyError, "string", "a refusal must say why");
  assert.ok(out.verifyError.length > 0, "a refusal must say why");
}


const BODY = { tool: "xrpl_trust_get_domain", domain: "ABC", holders: 3 };

async function attestationFor({ signer, identity, responseBody, responseHash, requestHash }) {
  return signProviderAttestation({
    attestation: {
      providerIdentity: identity,
      requestHash: requestHash ?? sha256Hex({ tool: "xrpl_trust_get_domain" }),
      responseHash: responseHash ?? sha256Hex(responseBody),
    },
    signer,
    network: "mainnet",
  });
}

const timing = { startedAt: 1, completedAt: 2, latencyMs: 1000 };

test("an honest attestation still produces a signed receipt", async () => {
  const att = await attestationFor({ signer: provider.signer, identity: PROVIDER_ID, responseBody: BODY });
  const out = await buildReceipt({
    serviceEndpoint: "https://mcp.xrpl-utilities.io",
    attestation: att,
    responseBody: BODY,
    ...timing,
  });
  assert.ok(out, "expected a receipt");
  assert.ok(out.body, "expected the signed body to ride out when H-Seal is unreachable");
  assert.equal(out.body.providerIdentity, PROVIDER_ID);
  assert.equal(out.body.responseHash, sha256Hex(BODY));
  assert.equal(out.requestHashBasis, "provider_asserted");
  assert.ok(out.verifyError, "H-Seal was unreachable, so the verdict is best-effort");
});

test("a responseHash that does not match the delivered body is refused, visibly", async () => {
  // Refused (no body, so nothing is signed) but NOT silent: returning undefined
  // here made a producer whose response model appends fields after it attests
  // look identical to H-Seal simply being switched off.
  const att = await attestationFor({
    signer: provider.signer,
    identity: PROVIDER_ID,
    responseHash: sha256Hex({ fabricated: true }),
  });
  const out = await buildReceipt({
    serviceEndpoint: "https://mcp.xrpl-utilities.io",
    attestation: att,
    responseBody: BODY,
    ...timing,
  });
  assert.ok(out, "the refusal must reach the caller, not vanish");
  assert.equal(out.body, undefined, "nothing may be signed over bytes we did not serve");
  assert.match(out.verifyError, /responseHash does not match/);
  assert.equal(out.requestHashBasis, "provider_asserted");
});

test("an attestation with no providerSignature is refused", async () => {
  const out = await buildReceipt({
    serviceEndpoint: "https://mcp.xrpl-utilities.io",
    attestation: {
      requestHash: sha256Hex({ tool: "x" }),
      responseHash: sha256Hex(BODY),
      providerIdentity: PROVIDER_ID,
    },
    responseBody: BODY,
    ...timing,
  });
  assertRefusedButNotSilent(out);
});

test("a corrupted providerSignature is refused", async () => {
  const att = await attestationFor({ signer: provider.signer, identity: PROVIDER_ID, responseBody: BODY });
  const [pub, sig] = att.providerSignature.split(":");
  const flipped = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
  const out = await buildReceipt({
    serviceEndpoint: "https://mcp.xrpl-utilities.io",
    attestation: { ...att, providerSignature: `${pub}:${flipped}` },
    responseBody: BODY,
    ...timing,
  });
  assertRefusedButNotSilent(out);
});

test("a signature whose key does not derive providerIdentity is refused", async () => {
  // Signed with the stranger's key but naming the real provider. Verifying the
  // signature alone would pass; the key-to-address binding is what catches it.
  const att = await attestationFor({ signer: stranger.signer, identity: PROVIDER_ID, responseBody: BODY });
  const out = await buildReceipt({
    serviceEndpoint: "https://mcp.xrpl-utilities.io",
    attestation: att,
    responseBody: BODY,
    ...timing,
  });
  assertRefusedButNotSilent(out);
});

test("a provider outside HSEAL_ALLOWED_PROVIDERS is refused", async () => {
  const att = await attestationFor({ signer: stranger.signer, identity: STRANGER_ID, responseBody: BODY });
  const out = await buildReceipt({
    serviceEndpoint: "https://mcp.xrpl-utilities.io",
    attestation: att,
    responseBody: BODY,
    ...timing,
  });
  assertRefusedButNotSilent(out);
});

test("the address oracle matches the published XRPL ed25519 vector", () => {
  const pub = Buffer.from("01FA53FA5A7E77798F882ECE20B1ABC00BB358A9E55A202D0D0676BD0CE37A63", "hex");
  assert.equal(xrplAddress(pub), "rLUEXYuLiQptky37CqLcm9USQpPiz5rkpD");
});
