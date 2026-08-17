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
- After P11: **P12–P22 landed** (engine + tests). P17 replaced **attests only**. **P18** cut over P6 \(Q_V\) to EIP-712 and did **not** replace the on-demand lab beacon or gossip wait-hook. **P19** cut over on-demand beacon to freeze-then-bind. **P20** cut over wait-hook honesty (not production DePIN gossip). **P21** binds `hashIndexRoot` into lab BFT and did **not** change on-demand. **P22** lands official standby readiness EIP-712 and did **not** change on-demand. **Next (not landed):** P23 live keep-deploy + evidence, then P24 `node.ts` standby gate, then P25 Explorer overlays. Do not start `pilotStartedAt`. Do **not** paint `ondemandEip712` / `endorsed` / `ondemandLabBeaconAfterFreeze` / `ondemandHookNotGossip` / `hashIndexCommittedInAc` / `standbyReadyEip712` / `officialStandbysReady` as production.

## Related

- Archive \(G_e\): `../../../RULES.md` §Archive
- Explorer Home Clusters: `../../../../explorer/RULES.md`
- Daemon wait session: `../../daemon/RULES.md`
