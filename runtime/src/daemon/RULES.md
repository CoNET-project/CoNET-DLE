# DLE client (daemon) programming rules

The **client** is the isomorphic daemon (`core.ts`, `browser.ts`): `fetch` to an archive, optional `POST /ondemand/hook`, local 7+2 recompute. It does **not** write disk WAL and does **not** produce blocks.

After any daemon / browser-client programming or probe-spec change, **update this file in the same task**.

## Cluster count vs tip height (2026-08-15)

If the client surfaces a cluster / fission number:

- Read **`liveGroupCount`** from trusted `GET /health` (or overview `GET /api/v2/dle`)
- No fission ⇒ **1**; after lab M6 fission ⇒ **2** (two distinct canonical Group IDs)
- **Do not** use `dle_tip.height`, `eth_blockNumber`, or AC `height` (NFT 42 stays `0x1` after AC)

`probeArchive` may pass through archive `/health`. When health includes `liveGroupCount`, keep it; on fetch failure do **not** overwrite a last trusted `2` (or `1`) with `0` or shrink `2` to `1`.

## Standing invariants

- Runtime: Node **or** browser (`detectDaemonRuntime`)
- `eth_chainId` = **CoNET-DLE Testnet** EIP-155 `0x44c45` — never CoNET L1 `224422`. This distinguishes the DLE plane; it is not Group ID.
- Group ID (if shown) = L1 bootstrap register tx hash, not uint `1` and not `dle.lab.group.v1`
- `submitWaitHook` / `submitWaitHookToArchives` send `canonicalGroupId(groupId)` so a legacy caller still posts the hash
- No tip VM: `eth_call` rejection is expected
- On-demand wait session ≠ Clusters (see `../shared/ondemand/RULES.md`)
- No `node:` imports in `core.ts` / `browser.ts`

## Lab new-chain user (`newchain-user-cli`)

Separate from the isomorphic daemon. Deploy: `npm run lab:deploy-newchain-user` → `70.35.205.77:/home/peter/dle-newchain-user`.

| Step | Behavior |
|---|---|
| Genesis smoke | One `POST /newchain/request` each for asset / storage / trade; require 7/7 `ok` and identical `requestId` / `chainNftId` / `valueHash` |
| Random create | After smoke, `setTimeout` 15–45s (no `setInterval`); pick a random class; persist `data/status.json` |
| Qualification | Archive Mode A replay succeeded; certificate `labOnly` + `notL1Nft` + `notArchiveCertificate`; `dle_route` → bootstrap Group ID hash; `dle_getByHash(valueHash)=hit`; NFT 42 AC still live |

**Not** L1 NFT mint, Treasury burn, Settlement escrow, or 30-day archive qualification. Do not stop `dle-ondemand-clients` when restarting this user.

## Related

- Archive fields: `../../RULES.md` §Archive
- Explorer UI: `../../../explorer/RULES.md`
