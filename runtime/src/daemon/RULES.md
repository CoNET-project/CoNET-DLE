# DLE client (daemon) programming rules

The **client** is the isomorphic daemon (`core.ts`, `browser.ts`): `fetch` to an archive, optional `POST /ondemand/hook`, local 7+2 recompute. It does **not** write disk WAL and does **not** produce blocks.

After any daemon / browser-client programming or probe-spec change, **update this file in the same task**.

## Cluster count vs tip height (2026-08-15)

If the client surfaces a cluster / fission number:

- Read **`liveGroupCount`** from trusted `GET /health` (or overview `GET /api/v2/dle`)
- No fission ⇒ **1**
- **Do not** use `dle_tip.height`, `eth_blockNumber`, or AC `height` (NFT 42 stays `0x1` after AC)

`probeArchive` may pass through archive `/health`. When health includes `liveGroupCount`, keep it; on fetch failure do not overwrite a last trusted `1` with `0`.

## Standing invariants

- Runtime: Node **or** browser (`detectDaemonRuntime`)
- `eth_chainId` = **CoNET-DLE Testnet** EIP-155 `0x44c45` — never CoNET L1 `224422`. This distinguishes the DLE plane; it is not Group ID.
- Group ID (if shown) = L1 bootstrap register tx hash, not uint `1` and not `dle.lab.group.v1`
- `submitWaitHook` / `submitWaitHookToArchives` send `canonicalGroupId(groupId)` so a legacy caller still posts the hash
- No tip VM: `eth_call` rejection is expected
- On-demand wait session ≠ Clusters (see `../shared/ondemand/RULES.md`)
- No `node:` imports in `core.ts` / `browser.ts`

## Related

- Archive fields: `../../RULES.md` §Archive
- Explorer UI: `../../../explorer/RULES.md`
