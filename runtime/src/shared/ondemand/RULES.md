# DLE on-demand programming rules

Lab waiting pool + recomputable **7+2** SelectionLog (`dle_getWaitingPool` / `dle_getSelectionLog`, `GET /ondemand/pool`, `GET /ondemand/selection`, `POST /ondemand/hook`).

After any on-demand protocol, HTTP, or client-hook change, **update this file in the same task**.

## Not Clusters

On-demand **does not** own cluster fission count.

| Concept | Source | Meaning |
|---|---|---|
| **Clusters / \(G_e\)** | Archive route table `liveGroupCount` | Live archive **groups** (genesis = 1) |
| **Waiting pool** | Frozen miner set + `poolRoot` | On-demand draw input |
| **SelectionLog** | 7 committee + 2 standbys | Recomputable roulette; **not** an Archive Certificate |

Do not increment or display \(G_e\) from miner count, `poolRoot`, or `endorsed`.

## Group ID

On-demand hooks and pool rows use **Group ID** = that archive group’s **L1 register tx hash**. Bootstrap = `0x3076a806de71ab75b2d48063cc3f1e7d8f8e3d54cb1d45a7469c75c9276f2ad0`.

`sameGroupId` treats legacy `dle.lab.group.v1` / `1` / `0x1` as the bootstrap hash so old clients still hook. Fission group `dle.lab.group.v2` stays a distinct id until it has its own L1 register tx.

Engine start: `groupId = canonicalGroupId(options.groupId ?? LAB_GROUP_ID)`. `parseSelection` (persist load + gossip ingest) and `selectionView()` / `pool()` emit the hash, never the disk v1 string.

Do **not** put EIP-155 `0x44c45` in `groupId` fields.

## Standing invariants

- Lab beacon = **freeze-then-bind** (**P19**): persist `ondemandFreezeHex` first, then bind honest-wait `labOnDemandBeaconAfterFreeze` / injected CL view / options beacon. Instant `labBeaconAfterFreeze(poolRoot)` (`dle.lab.beacon.afterFreeze.v1`) is **contrast only**. **Not** CoNET L1 CL RANDAO. P17 / P18 did **not** replace this beacon
- **P17 landed:** new attests are EIP-712 `ArchiveOnDemandAttest` (same domain as seating / challenge / BFT; seating key reused). HMAC / unsigned ingest → `ERR_ONDEMAND_HMAC_CUTOVER`. keep-only disk HMAC attests may still restore `endorsed`. **Not** 30-day qualification
- **P20 landed:** wait hooks are **not** intra-group gossip. `ingest` rejects `miners` / `hooks` / `hook` (`ERR_ONDEMAND_HOOK_NOT_GOSSIP`). `gossip()` forwards attests + selection only. miner / daemon **must** POST the same hook to every active archive. One accept ≠ group pool. Lab `POST /ondemand/hook` on TCP 27101 is **not** production DePIN gossip
- SelectionLog is not AC and does not change Mode A `valueHash`
- Duplicate hooks rejected (anti-hoard)
- Public explorer nginx must **not** expose `POST /ondemand/hook` or freeze
- After P11: **P12–P22 landed** (engine + tests). **P23 landed** (live keep-deploy + evidence; honest **6/7 LIVE_OK**; fd-01 new-chain 409→accept; fd-06 HTTP unstable). P17 replaced **attests only**. **P18** cut over P6 \(Q_V\) to EIP-712 and did **not** replace the on-demand lab beacon or gossip wait-hook. **P19** cut over on-demand beacon to freeze-then-bind. **P20** cut over wait-hook honesty (not production DePIN gossip). **P21** binds `hashIndexRoot` into lab BFT and did **not** change on-demand. **P22** lands official standby readiness EIP-712 and did **not** change on-demand. **P23** did **not** change on-demand. **P24 landed** (isolated `node.ts` standby gate; `runtime:test` **154/154**) and did **not** change on-demand. **P25 landed** (Explorer Certificates + Home **non-green** overlays; P25 `explorer:test` 8/8; historical SPA `index-U1o9ul_I.js` at 2026-08-18T00:18:49Z) and did **not** change on-demand. **fd-06 remapped (2026-08-18, not P26):** official standby seat now keep-data on `70.35.205.77` (`~/dle-30d-lab`); leftover `216.225.193.174` excluded. Did **not** change on-demand. Do **not** stop `dle-ondemand-clients` on `.77`. **Scrape 2026-08-18T00:52Z:** honest **7/7** `GET :27101/liveness`; `officialStandbysReady` still false (`count=1`, not sticky). **Fan-out 2026-08-18T00:57Z:** current official standby envelopes POSTed to 7× `/sync/standby-ready` (200); six seats `ready=true` then dropped as `leafCount` 9141→9145. **Peer-stale 2026-08-18T01:03Z:** other official seats still gossiped fd-06 to leftover `.174`. **Peer-refresh 2026-08-18T01:10Z:** `lab:keep-refresh-fd06-peers` ok; all official configs now `http://70.35.205.77:27101`. Seven-seat `ready=true` flickered at 01:12:01Z then dropped as roots drifted. **Split 2026-08-18T07:05Z / 07:08Z:** honest **7/7** LIVE_OK; two official standbys on **different four roots** (fd-06 camp A vs fd-07 camp B, +1 leaf race). Envelope POST cannot make `count=2`. **08:01Z flicker** 6/7 then drop in 21s. **Operator authorized inventory freeze** via `npm run lab:keep-freeze-inventory` / `POST /sync/inventory-freeze` (not `POST /ondemand/freeze`). Engine + tests: `runtime:test` **157/157**; `pilot` **14/14**; `explorer:test` **8/8**. **Live freeze 2026-08-18T08:35Z:** official 7 + extra fd-08 `inventoryFrozen=true` `reason=operator`; honest **7/7** LIVE_OK; `officialStandbysReady=true` count=2; leaf **9750**; `pilotStartedAt=null`. Evidence: `pilot/evidence/conet-dle-p23-live-2026-08/operator-inventory-freeze.json`. Did **not** change on-demand. **Operator authorized clock start** via `npm run lab:start-pilot-clock` / `POST /sync/pilot-clock` (not `POST /ondemand/freeze`). **Live clock 2026-08-18T09:53:58.092Z** (`pilotStartedAt` aligned on official 7 + fd-08; `pilotQualified=false`). Clock ≠ qualification. Did **not** change on-demand. **Explorer clock overlay (2026-08-18, not P26):** Home + Certificates show a **non-green** clock chip. Tests: `explorer:test` **10/10**. Public SPA `index-C8IdTq4H.js` on `dle.conet.network` at 2026-08-18T10:15:00Z (replaced pre-clock `index-U1o9ul_I.js`). Painting the clock is **not** qualification and did **not** change on-demand. Do **not** paint `ondemandEip712` / `endorsed` / `ondemandLabBeaconAfterFreeze` / `ondemandHookNotGossip` / `hashIndexCommittedInAc` / `standbyReadyEip712` / `officialStandbysReady` / `pilotStartedAt` as production or 30-day qualification. 7/7 liveness is **not** the 30-day gate.

## Related

- Archive \(G_e\): `../../../RULES.md` §Archive
- Explorer Home Clusters: `../../../../explorer/RULES.md`
- Daemon wait session: `../../daemon/RULES.md`
