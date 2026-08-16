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

- `liveGroupIds(table)` — unique non-empty `ownGroupId` + each `groups[].groupId` + `planeDirectory` keys, sorted
- `liveGroupCount(table)` — `Math.max(1, ids.length)`
- `planeDirectory` — wallets of **other live groups** for plane-wide gather. **Not** BFT peers. First-group `config.peers` stay intra-group only.
- `foreignChains` — mark a foreign `chainNftId` (e.g. NFT 42 on G2) with that group’s wallets. Do **not** put G2 hosts into NFT 42 BFT.

### M6 second archive group (2026-08-16)

Laboratory fission \(G_e: 1 \to 2\). **Not** production DePIN and **not** 30-day qualification. L1 `registerLiveGroup` for G2 is still pending.

| Item | Value |
|---|---|
| G2 Group ID | `0x7b3b8eb959dcc0f75a309fcc16e7f840efe76dc27f2ef0d4eca8b8617f9b1a07` = `keccak256(utf8("dle.lab.group.m6.g2.v1"))` — **lab hash**, not an L1 register tx. Do not open as Blockscout `/tx/…` |
| G2 hosts | 7 greenfield machines, 5 active + 2 standby, TCP **27101**, dir `/home/peter/dle-m6-g2` |
| G2 flags | `enableBft: false`, `enableOndemand: false`, `seedFissionMarker: true` |
| Marker | `DleLabFissionMarkerV1`, `chainNftId = 6000000006`, hash `labFissionMarkerHash(ownGroupId)` |

Hash gather (`locatePlane` / `get`):

- `locate()` stays synchronous this-group only
- `thisGroupOnly: true` never upgrades a miss to plane-wide
- `Ge === 1` → this-group `notFound` (`planeWideNull: false`)
- `Ge >= 2` → after every live group returns a trusted this-group `notFound`, `hashLookupPlaneNotFound` (`planeWideNull: true`, `scope: 'allLiveGroups'`)
- One group timeout / no plane wallets → `unavailable`, **not** JSON-RPC `null`
- Foreign hop: `historyProviders(chainNftId)` or `planeDirectory[locator.groupId]`. **No** local freezer fallback
- `eth_getBlockByHash` / `eth_getTransactionByHash` return JSON-RPC `null` **only** when `planeWideNull === true`

Deploy: `npm run lab:deploy-m6` then `npm run lab:accept-m6`. G1 keep-update only (no wipe). Never restart geth / beacon / validator. Do not stop on-demand 30 or newchain-user.

HTTP (`src/archive/http.ts` `clusterView`):

| Path | Fields |
|---|---|
| `GET /health` | `liveGroupCount`, `liveGroupIds` — spread **after** `extraHealth` so they are not overwritten |
| `GET /api/v2/dle` | same at top level **and** inside `archive` |

Genesis / no fission: **`liveGroupCount === 1`**, `liveGroupIds === ["0x3076a806de71ab75b2d48063cc3f1e7d8f8e3d54cb1d45a7469c75c9276f2ad0"]` (bootstrap **Group ID** = L1 register tx hash). After lab M6: **`liveGroupCount === 2`**, adding `0x7b3b8eb959dcc0f75a309fcc16e7f840efe76dc27f2ef0d4eca8b8617f9b1a07` (lab hash, not an L1 tx). Legacy clients may still send `dle.lab.group.v1` / `1`; `canonicalGroupId` / `sameGroupId` alias those to the first-group hash. Do **not** advertise the L1 storage uint `1` as Group ID.

**Emit / persist (mandatory):** every archive HTTP, JSON-RPC, hop receipt, hash-index, route, and on-demand view that includes `groupId` / `liveGroupIds` must emit `canonicalGroupId(...)`. Disk WAL / `hash-index.json` / on-demand selection that still stores `dle.lab.group.v1` must be treated as the bootstrap hash on load (`sameGroupId`); a later write of the same locator with the hash must **not** `ERR_HASH_LOCATOR_CONFLICT` — rewrite the stored string to the hash. `GET /api/v2/dle` top level includes `chainName: CoNET-DLE Testnet`.

`registerLabChainNft` copies NFT 42’s wallets into the **same** `ownGroupId`. New lab chains **do not** add a group.

### Lab new-chain HTTP plane (Mode A genesis)

Independent of NFT 42 Tendermint / AC. **Not** an L1 birth certificate or 30-day qualification.

| Path | Role |
|---|---|
| `POST /newchain/request` | Accept `DleLabNewChainRequestV1`; Mode A replay; persist `newchain-state.json` |
| `GET /newchain/chains` / `GET /newchain/queue` | List accepted lab chains |
| `/health` | `newchainLabOnly`, `newchainNotL1Nft`, `newchainCount`, `newchainByClass` |

`chainNftId` = `1000 + keccak % 998_999_000`, never `42`. Hash object `kind=ac` is a lab index only; certificate `notArchiveCertificate=true`.

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

Lab random-create user: `src/daemon/newchain-user-cli.ts` on `70.35.205.77:/home/peter/dle-newchain-user` (`npm run lab:deploy-newchain-user`). Genesis smoke is asset + storage + trade; then a `setTimeout` chain (15–45s) posts a random class. Do not mix this process with `dle-ondemand-clients`.
