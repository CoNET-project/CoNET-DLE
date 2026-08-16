# DLE runtime programming rules

P1/P2/P3 runtime: **archive** (Node.js, TCP 27101, no blocks, no tip VM) + **on-demand** + **daemon client**.

After a programming or spec change on one of these faces, update **that face’s RULES** in the same task. Do not leave the detail only in chat. See `conet-dle-write-back-subproject.mdc`.

| Face | Canonical RULES |
|---|---|
| Archive HTTP / route table | this file §Archive |
| On-demand pool / 7+2 | `src/shared/ondemand/RULES.md` |
| Daemon / browser client | `src/daemon/RULES.md` |

---

## Archive

### Cluster count \(G_e\) (2026-08-15)

Lab route table (`src/shared/labRoute.ts`):

- `liveGroupIds(table)` — unique non-empty `ownGroupId` + each `groups[].groupId`, sorted
- `liveGroupCount(table)` — `Math.max(1, ids.length)`

HTTP (`src/archive/http.ts` `clusterView`):

| Path | Fields |
|---|---|
| `GET /health` | `liveGroupCount`, `liveGroupIds` — spread **after** `extraHealth` so they are not overwritten |
| `GET /api/v2/dle` | same at top level **and** inside `archive` |

Genesis / no fission: **`liveGroupCount === 1`**, `liveGroupIds === ["0x3076a806de71ab75b2d48063cc3f1e7d8f8e3d54cb1d45a7469c75c9276f2ad0"]` (bootstrap **Group ID** = L1 register tx hash). Legacy clients may still send `dle.lab.group.v1` / `1`; `canonicalGroupId` / `sameGroupId` alias those to the hash. Do **not** advertise the L1 storage uint `1` as Group ID.

`registerLabChainNft` copies NFT 42’s wallets into the **same** `ownGroupId`. New lab chains **do not** add a group.

Do **not** expose Archive Certificate `height` as a growing tip. After AC, NFT 42 height is `0x1`. Explorer Home no longer shows Tip height; it shows Clusters from these fields.

### Other archive invariants

- `command: archive`, `runtime: nodejs`, `producesBlocks: false`, `hasTipVm: false`
- `eth_chainId` / `net_version` = **CoNET-DLE Testnet** EIP-155 id `0x44c45` / 281669 — unique versus CoNET L1 `224422` and Base `8453`. This is the plane chain id, **not** a group id. Never proxy L1 `publicrpc`.
- `dle_info.chainName` = `CoNET-DLE Testnet`
- Reject `eth_call` / `eth_getBalance` / writes
- Deploy: `lab:deploy-archive-keep` only. Never restart geth / beacon / validator

---

## On-demand

See `src/shared/ondemand/RULES.md`. Waiting pool / SelectionLog is **not** \(G_e\).

---

## Client

See `src/daemon/RULES.md`. Daemon must not treat `dle_tip.height` as cluster count.
