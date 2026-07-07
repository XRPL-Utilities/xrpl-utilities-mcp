# H-Seal provider co-signing — operations

The MCP server co-signs every tool response with an
[H-Seal](https://h-seal.xr-utilities.com) provider attestation, so a caller can
anchor a tamper-evident, independently verifiable on-chain receipt of the
interaction. The attestation rides on the tool result's `_meta.hSeal`.

Wiring lives in `src/hSeal.ts` (env-configured provider) and the single
tool-response choke point in `src/server.ts` (co-sign after `dispatchTool`).
When the env below is unset the feature is inert and responses are unchanged.

## Environment

| Var | Meaning |
|-----|---------|
| `PROVIDER_IDENTITY` | Our CAIP-10 identity, e.g. `xrpl:0:r...` |
| `PROVIDER_KEY_RAW`  | 32-byte ed25519 seed (hex) for that identity |

Both are set on the `xr-mcp` Railway service. Never hardcode the key; `.env` is
gitignored. Env changes need a redeploy (`railway up`) to take effect.

## The current identity

- `PROVIDER_IDENTITY = xrpl:0:rL8nM79gBHVxae1dkwrC3RtY4NcZKboCYX`
- A **dedicated, fundless ed25519 signing wallet** used only to co-sign
  receipts. It is deliberately not a treasury wallet: the MCP is non-custodial
  ("holds no wallets, takes no cut"), and a funds-holding key in a live public
  process would be drainable on compromise. A signing-only key means the worst
  case is a rotate, not a loss of funds.
- Fundless is fine: verification is purely cryptographic (the signature's pubkey
  must derive to the identity r-address). No XRP balance or on-chain activation
  is required. Optionally drop ~1 XRP on it later if you want it discoverable
  on-chain.

## Curve gotcha (read before generating a key)

For an `xrpl:0:r...` identity the H-Seal server derives and checks the r-address
from the `0xED` **ed25519** pubkey (`sign-core.ts`). So the r-address must be
derived **from the ed25519 key you sign with**. You cannot pair an ed25519
signer with a pre-existing secp256k1 wallet's r-address; the addresses will
never match and the service rejects every attestation. Most XRPL tooling
defaults to secp256k1, so generate the provider key explicitly as ed25519.

## Rotate / recover the key

The seed lives **only** in the `xr-mcp` Railway env (sealed, unreadable). There
is no backup by design. If it is ever lost or you want to rotate, generate a new
identity and redeploy. It is a fundless signing key, so this is cheap and safe.

1. Generate a fresh ed25519 identity and derive its r-address from the key:

   ```bash
   # in the repo, with the SDK installed
   node --input-type=module -e '
     import { generateEd25519, ed25519Signer } from "@xr-utilities/h-seal-provider";
     import { writeFileSync } from "node:fs";
     const { seed, publicKeyRaw } = generateEd25519();
     const seedHex = Buffer.from(seed).toString("hex");
     // round-trip: the stored hex seed must reconstruct the same pubkey
     const back = Buffer.from(ed25519Signer(seedHex).publicKeyRaw()).toString("hex");
     if (back !== Buffer.from(publicKeyRaw).toString("hex")) { throw new Error("roundtrip fail"); }
     writeFileSync("/tmp/provider_key.hex", seedHex, { mode: 0o600 });   // seed -> file, not stdout
     console.log("PUBHEX=" + Buffer.from(publicKeyRaw).toString("hex"));
   '
   # derive the r-address authoritatively (xrpl-py): ED + PUBHEX (uppercase)
   python3 -c "from xrpl.core.keypairs import derive_classic_address; print(derive_classic_address('ED'+'<PUBHEX>'.upper()))"
   ```

2. Set both vars on Railway (seed read from the file so it is not echoed):

   ```bash
   railway variables --service xr-mcp \
     --set "PROVIDER_IDENTITY=xrpl:0:<NEW_R_ADDRESS>" \
     --set "PROVIDER_KEY_RAW=$(cat /tmp/provider_key.hex)" >/dev/null 2>&1
   ```

3. Redeploy and clean up:

   ```bash
   railway up --service xr-mcp --detach
   shred -u /tmp/provider_key.hex
   ```

## Verify it is live

A tool call to the deployed server should carry `_meta.hSeal`. Even an unpaid
call works, because the response is co-signed whatever it returns (a 402
challenge included):

```bash
node --input-type=module -e '
  import { Client } from "@modelcontextprotocol/sdk/client/index.js";
  import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
  const c = new Client({ name: "hseal-verify", version: "1.0.0" }, { capabilities: {} });
  await c.connect(new StreamableHTTPClientTransport(new URL("https://mcp.xrpl-utilities.io/mcp")));
  const res = await c.callTool({ name: "xrpl_sentinel_scan", arguments: { target: "rL8nM79gBHVxae1dkwrC3RtY4NcZKboCYX" } });
  console.log("has _meta.hSeal:", Boolean(res?._meta?.hSeal), res?._meta?.hSeal?.providerIdentity);
  await c.close();
'
```
