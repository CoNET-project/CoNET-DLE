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

Do **not** put EIP-155 `0x44c45` in `groupId` fields.

## Standing invariants

- Lab beacon = keccak **after** freeze — not CoNET L1 CL RANDAO
- HMAC attests are forgeable; not 30-day qualification
- SelectionLog is not AC and does not change Mode A `valueHash`
- Duplicate hooks rejected (anti-hoard)
- Public explorer nginx must **not** expose `POST /ondemand/hook` or freeze

## Related

- Archive \(G_e\): `../../../RULES.md` §Archive
- Explorer Home Clusters: `../../../../explorer/RULES.md`
- Daemon wait session: `../../daemon/RULES.md`
