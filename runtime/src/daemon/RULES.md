# DLE client (daemon) programming rules

The **client** is the isomorphic daemon (`core.ts`, `browser.ts`): `fetch` to an archive, optional `POST /ondemand/hook`, local 7+2 recompute. It does **not** write disk WAL and does **not** produce blocks.

After any daemon / browser-client programming or probe-spec change, **update this file in the same task**.

## Cluster count vs tip height (2026-08-15)

If the client surfaces a cluster / fission number:

- Read **`liveGroupCount`** from trusted `GET /health` (or overview `GET /api/v2/dle`). Archive↔archive heartbeats use **`GET /liveness`**, not full `/health`.
- No fission ⇒ **1**; after lab M6 fission ⇒ **2** (two distinct canonical Group IDs)
- **Do not** use `dle_tip.height`, `eth_blockNumber`, or AC `height` (NFT 42 stays `0x1` after AC)

`probeArchive` may pass through archive `/health`. When health includes `liveGroupCount`, keep it; on fetch failure do **not** overwrite a last trusted `2` (or `1`) with `0` or shrink `2` to `1`.

## Standing invariants

- Runtime: Node **or** browser (`detectDaemonRuntime`)
- `eth_chainId` = **CoNET-DLE Testnet** EIP-155 `0x44c45` — never CoNET L1 `224422`. This distinguishes the DLE plane; it is not Group ID.
- Group ID (if shown) = L1 bootstrap register tx hash, not uint `1` and not `dle.lab.group.v1`
- `submitWaitHook` / `submitWaitHookToArchives` send `canonicalGroupId(groupId)` so a legacy caller still posts the hash
- **P20:** wait hooks are not intra-group gossip. `submitWaitHook` (one archive) sets `fanoutComplete: false` + `singleArchiveAcceptNotGroupPool`. `submitWaitHookToArchives` sets `fanoutComplete` only when every active archive queued. Lab HTTP is **not** production DePIN gossip
- No tip VM: `eth_call` rejection is expected
- On-demand wait session ≠ Clusters (see `../shared/ondemand/RULES.md`)
- No `node:` imports in `core.ts` / `browser.ts`
- After P11: **P12 seating EIP-712**, **P13 freeze-then-beacon**, **P14 \(C_G\) split**, **P15 challenge EIP-712**, **P16 BFT AC EIP-712**, **P17 on-demand attest EIP-712**, **P18 \(Q_V\) EIP-712**, **P19 on-demand freeze-then-bind**, **P20 wait-hook honesty**, **P21 lab BFT `hashIndexRoot` bind**, and **P22 official standby readiness EIP-712 landed** (engine + tests). New-chain-user HTTP still only `schema === 'DleLabValidatorQuorumV1'`. Do not treat lab seating / challenge / BFT / on-demand / \(Q_V\) EIP-712, `bftEip712`, `ondemandEip712`, `newchainValidatorQuorumEip712`, `labBeaconAfterFreeze`, `ondemandLabBeaconAfterFreeze`, `ondemandHookNotGossip`, `hashIndexCommittedInAc`, `standbyReadyEip712`, `officialStandbysReady`, `newchainOfficialStandbysReady`, lab freezer 2249, or `productionCgAvailable` as production OperatorDomain / L1 wrapper / live CL RANDAO / 30-day qualification / production \(C_G\) / production DePIN gossip / production AC commitment / production secp256k1. P18 did **not** replace the on-demand lab beacon or gossip wait-hook. P19 cut over the on-demand lab beacon and did **not** replace gossip wait-hook. P20 cut over wait-hook honesty only. **P21** binds `hashIndexRoot` into lab BFT and did **not** change daemon hook / new-chain-user HTTP. **P22** gates `lab-cli` new-chain accept on two official standbys and did **not** change daemon hook / new-chain-user HTTP. **P23 landed** (live keep-deploy + evidence; honest 6/7 LIVE_OK; fd-01 409→accept; fd-06 HTTP unstable) and did **not** change daemon hook / new-chain-user HTTP. **P24 landed** (isolated `node.ts` uses the same `officialStandbysReady` callback; no `sync.start()` / no inventory freeze; `runtime:test` **154/154**) and did **not** change daemon hook / new-chain-user HTTP. **Next (not landed):** P25 Explorer overlays. Do not start `pilotStartedAt`. Do **not** claim 7/7 healthy.

## Lab new-chain user (`newchain-user-cli`)

Separate from the isomorphic daemon. Deploy: `npm run lab:deploy-newchain-user` → `70.35.205.77:/home/peter/dle-newchain-user`.

| Step | Behavior |
|---|---|
| Genesis smoke | One `POST /newchain/request` each for asset / storage / trade; require 7/7 `ok`, identical `requestId` / `chainNftId` / `valueHash`, and `validatorQuorum.schema === 'DleLabValidatorQuorumV1'` |
| Random create | After smoke, `setTimeout` 15–45s (no `setInterval`); pick a random class; persist `data/status.json` |
| Qualification | Mode A replay + \(Q_V=5/7\) EIP-712 `ArchiveValidatorQuorumAttest` (**P18**); G1 then a **per-`chainNftId`** 4-of-5 AC (`archiveCertificate` present, `chainNftId ≠ 42`); `dle_route` → bootstrap Group ID hash; `dle_getByHash(tipStateRoot)=hit`; NFT 42 AC still live and `eth_blockNumber` unchanged by the new-chain AC. Smoke may return after 7/7 + matching hashes **without** waiting for AC. HTTP still only checks `schema === 'DleLabValidatorQuorumV1'`. |

**Not** L1 NFT mint, Treasury burn, Settlement escrow, or 30-day archive qualification. Do not stop `dle-ondemand-clients` when restarting this user.

## Related

- Archive fields: `../../RULES.md` §Archive
- Explorer UI: `../../../explorer/RULES.md`
