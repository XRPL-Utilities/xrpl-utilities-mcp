// Independent oracle for the XRPL classic-address derivation that
// src/hSealReceipt.ts uses to bind a provider signature to the r-address it
// claims. Deliberately a second implementation: if the module derived the
// address with the same code it verifies against, the check proves nothing.

import { createHash } from "node:crypto";

const ALPHABET = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

function base58(buf) {
  let n = BigInt("0x" + (buf.toString("hex") || "0"));
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    out = ALPHABET[0] + out;
  }
  return out;
}

const sha256 = (b) => createHash("sha256").update(b).digest();

/** Classic r-address for a raw 32-byte ed25519 public key. */
export function xrplAddress(publicKeyRaw) {
  const pub = Buffer.concat([Buffer.from([0xed]), Buffer.from(publicKeyRaw)]);
  const accountId = createHash("ripemd160").update(sha256(pub)).digest();
  const payload = Buffer.concat([Buffer.from([0x00]), accountId]);
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return base58(Buffer.concat([payload, checksum]));
}
