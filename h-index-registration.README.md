# H-Index re-registration — how to submit `h-index-listing.json`

The live H-Index listing (`id 0.0.10601198/46`) showed **0 tools** because the
signed `mcpManifest` was empty/wrong-shaped and the payload carried a
`_registration` help block (H-Index rejects any body with that key). This file
is the corrected, signable payload.

## What was fixed
- `mcpManifest` is now a **JSON string** (a `JSON.stringify` of the live
  `tools/list` snapshot — 41 tools with `inputSchema`), not a nested object.
- The `_registration` help block is **removed**.
- Same `endpointUrl` (`https://mcp.xrpl-utilities.io/mcp`, with `/mcp`) and same
  `ownerAccountId` → this is a **free re-register** (no $10 fee).
- Added `slaReceiptRef: "0.0.10500472"` so discovery surfaces "publisher anchors
  proof-of-execution via H-Seal" (we now co-sign every tool response).
- `category` kept as `data` (accurate for the 6-product portfolio). Change to
  another enum if you prefer: `security automation finance infra ...`.

## To submit (only you can sign — Claude has no key)
The owner is a **Base/EVM** account, so signing is **EIP-712**:

1. Set `issuedAt` to the current unix time at signing (freshness window).
2. EIP-712-sign the payload with the wallet controlling
   `0xADB77e932516298660C47e390676c2F053D7f3c8`. The `Register` struct includes
   every field in this file; **append `{ name: "termsVersion", type: "string" }`
   as the LAST field** (it's already in the payload).
3. Put the resulting signature in the `signature` field.
4. Submit:
   ```
   curl -X POST https://h-index.xr-utilities.ai/register \
     -H "Content-Type: application/json" \
     -d @h-index-listing.json
   ```
   Same URL + owner ⇒ no x402 payment required.

## Verify it took
```
curl -s "https://h-index.xr-utilities.ai/endpoints?q=xrpl%20utilities" \
  | python3 -c "import sys,json;[print(r['id'], len((r.get('mcpManifest') or {}).get('tools',[])),'tools') for r in json.load(sys.stdin)['results'] if 'mcp.xrpl-utilities.io' in json.dumps(r)]"
```
Expect `0.0.10601198/46 41 tools`.
