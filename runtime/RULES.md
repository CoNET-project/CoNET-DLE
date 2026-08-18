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

Laboratory fission \(G_e: 1 \to 2\). **Not** production DePIN and **not** 30-day qualification. G2 L1 `registerLiveGroup` landed 2026-08-16 (tx `0xf781f2c2…876d5153`). After the 2026-08-16 keep-deploy, hosts emit that tx as `hop1.ownGroupId` / `liveGroupIds`. `canonicalGroupId` still aliases laboratory keccak / `2` / `0x2`.

| Item | Value |
|---|---|
| G2 Group ID | `0xf781f2c23fe3b3dac09dc3e1929016b0af200ee93978e916df64d750876d5153` — L1 `registerLiveGroup` tx. Laboratory keccak `0x7b3b8eb959dcc0f75a309fcc16e7f840efe76dc27f2ef0d4eca8b8617f9b1a07` / uint `2` / `0x2` alias it. Do **not** advertise uint `2` as Group ID. |
| G2 hosts | 7 greenfield machines, 5 active + 2 standby, TCP **27101**, dir `/home/peter/dle-m6-g2` |
| G2 flags | `enableBft: false`, `enableOndemand: false`, `seedFissionMarker: true` |
| Marker | `DleLabFissionMarkerV1`, `chainNftId = 6000000006`, hash `labFissionMarkerHash(ownGroupId)` (seeds from laboratory keccak so `0x7ca21e5a…e2345c` stays valid). Re-seed after `ownGroupId` cutover is first-write-wins: existing locator → skip freezer rewrite. |

Hash gather (`locatePlane` / `get`):

- `locate()` stays synchronous this-group only
- `thisGroupOnly: true` never upgrades a miss to plane-wide
- `Ge === 1` → this-group `notFound` (`planeWideNull: false`)
- `Ge >= 2` → after every live group returns a trusted this-group `notFound`, `hashLookupPlaneNotFound` (`planeWideNull: true`, `scope: 'allLiveGroups'`)
- One group timeout / no plane wallets → `unavailable`, **not** JSON-RPC `null`
- Foreign hop: `historyProviders(chainNftId)` or `planeDirectory[locator.groupId]`. **No** local freezer fallback
- `eth_getBlockByHash` / `eth_getTransactionByHash` return JSON-RPC `null` **only** when `planeWideNull === true`

Deploy: `npm run lab:deploy-m6` then `npm run lab:accept-m6`. G1 keep-update only (no wipe). G2 rolling restart **keeps** `/home/peter/dle-m6-g2/data` (only replaces `app/`). Never restart geth / beacon / validator. Do not stop on-demand 30 or newchain-user.

### M7 typed tip / membership roots (2026-08-16)

`tipStateRoot` and `membershipRoot` are first-class `HashObjectKind`s. A hit returns `DleLabTipStateRootV1` / `DleLabMembershipRootV1`, **not** the Archive Certificate. Do **not** catalogue them via `boundField` alias onto `kind=ac`.

| Rule | Meaning |
|---|---|
| First-write-wins | Same hash + same kind + same `chainNftId` at a later height is skipped (`skipped: 'first-write-wins'`). Membership roots are usually stable across heights. |
| `ZERO32` | Invalid / zero hashes are not catalogued. |
| Side-index | `indexCertificate` / `indexRecord` side-index these roots after the AC / lab record. Side-index failure **MUST NOT** fail the parent AC. |
| Kind / nft conflict | Existing locator with a different kind or nft → `{ ok: true, skipped: 'conflict' }`, not a parent failure. |
| G2 | G2 has `enableBft: false`, so M7 objects appear on **G1 NFT 42** ACs (and G1 newchain `tipStateRoot`). Do not invent a G2 AC just to index roots. |
| Not qualification | M7 is **not** L1 `registerLiveGroup` and **not** 30-day qualification. |

Kinds: `ac \| prevoteQc \| tipStateRoot \| membershipRoot \| block \| tx \| daRootProof`.

HTTP (`src/archive/http.ts` `clusterView`):

| Path | Fields |
|---|---|
| `GET /health` | `liveGroupCount`, `liveGroupIds` — spread **after** `extraHealth` so they are not overwritten |
| `GET /api/v2/dle` | same at top level **and** inside `archive` |

Genesis / no fission: **`liveGroupCount === 1`**, `liveGroupIds === ["0x3076a806de71ab75b2d48063cc3f1e7d8f8e3d54cb1d45a7469c75c9276f2ad0"]` (bootstrap **Group ID** = L1 register tx hash). After lab M6 + G2 L1 register + host cutover: **`liveGroupCount === 2`**, adding `0xf781f2c23fe3b3dac09dc3e1929016b0af200ee93978e916df64d750876d5153`. Hosts emit those two register txs. `canonicalGroupId` / `sameGroupId` still alias laboratory keccak `0x7b3b8eb9…7f9b1a07`, `2`, and `0x2` to the G2 register tx. Legacy clients may still send `dle.lab.group.v1` / `1`; those alias to the first-group hash. Do **not** advertise L1 storage uints `1` or `2` as Group ID. `labFissionMarkerHash` still seeds from the laboratory keccak so the already-sown marker `0x7ca21e5a…e2345c` stays valid.

**Emit / persist (mandatory):** every archive HTTP, JSON-RPC, hop receipt, hash-index, route, and on-demand view that includes `groupId` / `liveGroupIds` must emit `canonicalGroupId(...)`. Disk WAL / `hash-index.json` / on-demand selection that still stores `dle.lab.group.v1` must be treated as the bootstrap hash on load (`sameGroupId`); a later write of the same locator with the hash must **not** `ERR_HASH_LOCATOR_CONFLICT` — rewrite the stored string to the hash. `GET /api/v2/dle` top level includes `chainName: CoNET-DLE Testnet`.

`registerLabChainNft` copies NFT 42’s wallets into the **same** `ownGroupId`. New lab chains **do not** add a group.

### Hash store hot path (2026-08-16)

`openHashStore` loads `hash-index.json` + `hash-freezer.json` **once** into process memory. `getLocator` / `listLocators` / `getBody` are in-memory. `locatorCount()` is a maintained integer; `listLocators()` returns a sorted snapshot invalidated on `putLocator` **outside** a batch, and on `endBatch()`. Disk writes happen only on `putLocator` / `putBody`. Catch-up **must** wrap ingest in `beginBatch()` / `endBatch()` so a 128-object batch writes index + freezer **once** and does **not** rebuild `hashIndex` per object. `inventoryNow()` keeps its last snapshot while `isBatching()`. **Do not** re-read the JSON files on every `/health` or hop.

`hashIndexRootOf` / `proveHashIndex` / `hashIndexRootView` share one in-process Merkle cache keyed by locator fingerprint. **Do not** rebuild all leaf hashes + layers per sample, per Explorer `dle_proveHash`, or per incoming challenge. A cache miss still costs `O(L log L)`; a hit is `O(path)`.

`GET /health` `hashIndex` must use a cached `hashIndexRootView` (invalidate when `locatorCount()` changes). Peer heartbeats use **`GET /liveness`** (tiny `{ok,command,domainId}`), never full `/health`. Extra `/health` fields are cached ~2s.

`newchain-state.json` / hash-index / freezer writes are **atomic** (`*.tmp` + rename). Vote snapshots **debounce 2s**; accept and Archive Certificate flush immediately. `/newchain/bft` gossip is **batched**: at most **3 pending** + **2 certified** topics per 1s tick (idle: 3 certified every 5s). Forming or adopting an AC **immediately broadcasts that one topic** so laggards can `adoptCertificate`. Do **not** send every pending topic in one POST (timeout drops the whole vote set). Do not re-index an already-installed PrevoteQC / AC. Duplicate votes (same slot + `votesEqual`, including EIP-712 `signature` / `signer`) and votes on an already-certified topic **must not** persist `newchain-state.json`.

On newchain engine load: **register** each `chainNftId`. Attach genesis BFT when `archiveCertificatePending === true` **or** an AC is already stored (certified topics stay in the map so gossip can leak them). **Do not** re-run `indexRouteAndTip` for every persisted record (700+ sync freezer writes). New `POST /newchain/request` still indexes `tipStateRoot`. Empty `/newchain/bft` gossip is skipped. HTTP `maxConnections = 128`.

### Lab new-chain HTTP plane (P6 genesis)

Independent of NFT 42 Tendermint / `bft-state.json`. **Not** an L1 birth certificate or 30-day qualification.

| Path | Role |
|---|---|
| `POST /newchain/request` | Accept `DleLabNewChainRequestV1`; Mode A replay; **require** \(Q_V=5/7\) EIP-712 `ArchiveValidatorQuorumAttest`; persist `newchain-state.json` |
| `POST /newchain/bft` | Per-chain genesis gossip (`DleLabNewChainBftMessageV1`). **Never** `/bft/message` |
| `GET /newchain/chains` / `GET /newchain/queue` | List accepted lab chains |
| `/health` | `newchainLabOnly`, `newchainNotL1Nft`, `newchainCount`, `newchainByClass`, `newchainValidatorQuorum: 5`, `newchainValidatorQuorumEip712`, `newchainHmacForgeable`, `newchainArchivePending`, `newchainArchiveCertified` |

`chainNftId` = `1000 + keccak % 998_999_000`, never `42`. Accept catalogues `tipStateRoot` immediately. **Do not** catalogue `valueHash` as `kind=ac` until the real PrecommitQC (freezer append-only). G1 (`enableBft: true`) forms a **per-`chainNftId`** 4-of-5 AC via `labChainObjectLocator`. G2 (`enableBft: false`) does Mode A + \(Q_V\) only. New-chain AC **must not** update NFT 42 tip / `eth_blockNumber`. Legacy records without P6 fields stay register + tip only; old `DleLabGenesisCertificateV1` stubs keep `notArchiveCertificate: true`.

Live keep evidence (2026-08-16): `pilot/evidence/conet-dle-p6-genesis-2026-08/p6-live-accept.json` — trade `chainNftId=326990096`, 7/7 `DleLabArchiveCertificateV1` in ~10s, NFT 42 `eth_blockNumber` stayed `0x1`, `liveGroupCount=2`. Completing P6 is **not** 30-day qualification.

Do **not** expose Archive Certificate `height` as a growing tip. After AC, NFT 42 height is `0x1`. Explorer Home no longer shows Tip height; it shows Clusters from these fields.

### ArchiveSyncQualificationV1 (product freeze; lab facade live)

Whitepaper §5.2.0f. **IdentityEligible ≠ SyncQualified.** Catch-up `SYNCING` is not seating. A self-reported completed sync is only `CLAIMED_SYNC`. Other current-active archives of the **target group** MUST run `ArchiveStateChallengeV1`. The **four inventory roots** bind every hosted `chainNftId`. Laboratory openings (**P9**) then apply tip + history + DA + one `hashIndex` leaf on **every** hosted `chainNftId` (`LAB_SYNC_OPEN_ALL_HOSTED_CHAINS`; `LAB_SYNC_MAX_HOSTED_CHAINS = 0`). Locators are grouped once by chain — do **not** `locators.filter` per nft. **P20 landed:** wait hooks are **not** intra-group gossip (`ondemandHookNotGossip` / `ondemandMustFanoutToEveryActiveArchive`; `ERR_ONDEMAND_HOOK_NOT_GOSSIP`). Lab `POST /ondemand/hook` on TCP 27101 is **not** production DePIN gossip. **P19 landed:** on-demand freeze-then-bind (`ondemandFreezeBeforeBeacon` / `ondemandLabBeaconAfterFreeze`; **not** production CL RANDAO). **P18 landed:** P6 \(Q_V\) attests are EIP-712 `ArchiveValidatorQuorumAttest` (`newchainValidatorQuorumEip712`; `newchainHmacForgeable: false`). **P17 landed:** on-demand attests are EIP-712 `ArchiveOnDemandAttest` (`hmacForgeable: false`). The on-demand lab beacon was **unchanged at P17 / P18**. **P16 landed:** BFT AC votes are EIP-712 `ArchiveBftVote` (`hmacForgeable: false`). **P15 landed:** openings / challenge envelopes are EIP-712 `ArchiveStateChallenge` (`samplesRoot`; `hmacForgeable: false`). **P13 landed:** freeze `hostedChainSetRoot` / `lastACRef` / candidate set **before** binding a beacon; lab seed is keccak **after** freeze (or an injected CL view), **not** production \(C_G\) / live CL RANDAO. **P14 landed:** lab freezer hosted-set stays the lab opening; production \(C_G\) is L1 `archiveGroupId` only — **not** the 2249-chain freezer set, **not** a `publicrpc`/`rpc1` scan. **P12 landed:** seating votes on `POST /sync/vote` / `POST /sync/reject` are EIP-712 `ArchiveSyncQualificationCertificate` (domain `CoNET-DLE-Archive`, `chainId` 224422). HMAC seating votes are rejected (`ERR_SYNC_HMAC_CUTOVER`). This is **not** OperatorDomain / L1 MembershipCheckpoint settle. Seating quorum is \(Q_A=4/5\) (already \(>2/3\); **3/5 forbidden**). Candidate does not vote. Standbys do not vote. Offline / syncing members do **not** lower \(Q_A\).

A pass is **seating-grade possession of the committed inventory**, not a linear scan of every historical byte. Three layers: (1) byte-exact `lastAC` / `membershipRoot` / `hashIndexRoot`; (2) unpredictable local-freezer openings — hop-1 / `historyProviders` / remote parrot during the challenge is `REJECTED` (`dle_getObject` only); (3) stratified samples on **every** hosted `chainNftId` (lab P9). Post-seat availability remains `UnavailableChallenge`.

Laboratory honesty (2026-08-16):

| Signal | Meaning | Seating? |
|---|---|---|
| `GET /health` 2xx | Process reachable | No |
| `GET /liveness` | Tiny heartbeat | No |
| HMAC `lastQuorumOk` | Lab peer pulse | No |
| Self-reported `eth_syncing: false` | Claim only | No |
| `GET /sync/status` `seatingQualified` | Lab certificate after `ArchiveStateChallengeV1` (votes = P12 EIP-712; challenge / opening = P15 EIP-712) | Yes (lab only) |
| `seatingEip712` | Lab seating votes use EIP-712 `recoverAddress` | **Not** production OperatorDomain / L1 settle |
| `ArchiveStateChallengeV1` | **Implemented** on this lab facade (**P15** EIP-712 challenge / opening; **P13** freeze-then-bind lab beacon; **not** live CL RANDAO) | Lab seating openings only |
| `challengeEip712` | Lab challenge / opening use EIP-712 `recoverAddress` + `samplesRoot` | **Not** production OperatorDomain / L1 settle |
| `bftEip712` | Lab BFT AC votes use EIP-712 `ArchiveBftVote` | **Not** a frozen L1 wrapper or corpus SSZ |
| `ondemandEip712` | Lab on-demand attests use EIP-712 `ArchiveOnDemandAttest` | **Not** 30-day qualification / production beacon |
| `newchainValidatorQuorumEip712` | Lab new-chain \(Q_V\) uses EIP-712 `ArchiveValidatorQuorumAttest` | **Not** production secp256k1 / 30-day qualification |
| `freezeBeforeBeacon` / `labBeaconAfterFreeze` | Challenge roots persist before seed; lab keccak after freeze or injected view | **Not** production \(R^{\mathrm{sync}}_e\) |
| `ondemandFreezeBeforeBeacon` / `ondemandLabBeaconAfterFreeze` | On-demand pool freeze persists before bind; lab keccak after freeze or injected view | **Not** production CL RANDAO |
| `ondemandHookNotGossip` / `ondemandMustFanoutToEveryActiveArchive` | Lab HTTP wait hook is not intra-group gossip; miner must POST every active archive | **Not** production DePIN gossip |

Do **not** advertise a catching-up host as seating-qualified. Green Explorer pill **only** when `seatingQualified === true`. Completing this spec **MUST NOT** start `pilotStartedAt` / `PilotQualificationGate`. This is **not** the 30-day gate.

FSM (normative; wired in `runtime/src/archive/syncQualification/`):

```text
IdentityEligible → SYNCING → CLAIMED_SYNC → STATE_CHALLENGE → QUALIFIED | REJECTED
```

Zero-join lab evidence (2026-08-16): wipe only G1 `fd-05` / `fd-07` `~/dle-30d-lab/data` (never geth/beacon). Keepers `fd-01..04` must be `QUALIFIED` **and** share the same four roots before wipe. `pilot/evidence/conet-dle-sync-join-2026-08/wipe.json` + `accept.json` (`ok:true`, joiners `QUALIFIED` at leaf 4956). Not 30-day qualification.

HTTP: `GET /sync/status` `/sync/inventory` `/sync/opening` `/sync/roster`; `POST /sync/challenge` `/sync/vote` `/sync/reject` `/sync/standby-ready`. NFT 42 BFT, newchain genesis BFT, **and** on-demand `ondemand.start()` wait until **this host is `QUALIFIED`**, `alignedQualifiedCount() ≥ SYNC_ACTIVE_COUNT` (5 active seats, same four roots), **no active is unseated**, **and** `LAB_HOLD_BFT_AFTER_BOOT_MS` (30 min after process start) has elapsed. Seating votes still use \(Q_A=4/5\). Starting lab BFT / on-demand at 4/5 — or immediately after certificate restore on restart — keeps moving `lastACRef` / `hashIndexRoot`, stale-kills `CLAIMED_SYNC` challenges, and starves `/liveness`. A standby `QUALIFIED` must not fill \(Q_A\) or start BFT. Certificates from a split inventory must not start BFT. `canVote` counts only aligned **active** QUALIFIED toward \(Q_A\). Do **not** gossip `/newchain/bft` while `SYNCING` (it stringifies the 6 MB state and starves `/liveness`). Process restart of `REJECTED` is a new seating attempt (`SYNCING`). AC sample grade matches `valueHash|membershipRoot|tipStateRoot`, not the signer list.

Lab ops (must not starve HTTP):

- `inventoryNow()` is cached by `locatorCount` (append-only store). `lastACRefOf` is one pass over locators (`O(L)`), never `O(chains × locators)`. `hashIndex` proofs reuse the process Merkle cache (see Hash store hot path). `start()` must **not** `await` the first tick; HTTP listen stays live.
- Claim / catch-up compare the four inventory roots from `/sync/status` against the richest same-`groupId` peer (leaf count, then majority `hashIndexRoot`, then `seatingQualified`). A `QUALIFIED` keeper **still merges** extras from a richer same-group peer, at most once per `SYNC_QUALIFIED_CATCHUP_MIN_MS` (30s) — not every 2s tick (that starves `/liveness`). `SYNCING` joiners still catch up every tick. The seat certificate is not revoked. Full `/sync/inventory` is fetched **only** to catch up. Foreign-group inventories are ignored. Missing `groupId` is **not** treated as same-group.
- A voter whose roots do not match the candidate challenge **skips** during bootstrap. A `QUALIFIED` keeper may `REJECT` `ERR_SYNC_ROOT_MISMATCH` **only** when the candidate `holdClaimed === true` (explicit `claimSync()`). Auto-claim peers self-demote when the richest moves. Inbound `ROOT_MISMATCH` / `INDEX_PROOF` / `OBJECT_MISMATCH` / `SEED_MISMATCH` without `holdClaimed` returns them to `SYNCING` (not terminal). Inbound `ERR_SYNC_CHALLENGER_MISSING*` is a **no-op** (voter miss ≠ candidate miss; do not `REJECTED` and do not demote). A voter that grades `CHALLENGER_MISSING` **must not** `POST /sync/reject`. `holdClaimed` + `OBJECT_MISMATCH` is terminal `REJECTED`. Hop during the opening is always terminal. `QUALIFIED` ignores inbound reject. `health()` exposes `hasUnseatedActive` / `alignedQualifiedCount` without building a challenge.
- `GET /sync/status` rebuilds `pendingChallenge` whenever the live four roots drift **or** the persisted challenge does not cover the live hosted set (`challengeCoversLiveOpening` — old 8-cap shapes without `openedAllHostedChains` are rebuilt). `GET /sync/opening` is read-only (`labCgOpeningView`): no persist, no nonce bump. `GET /health` must **not** build samples; it only reports `hostedChainCount` + `labCgOpening: 'all-hosted'`. Answering a challenge whose roots no longer match live inventory returns `ERR_SYNC_CHALLENGE_STALE` instead of a live `hashIndex` proof against a frozen root (that was `ERR_SYNC_INDEX_PROOF`).
- Hash-index proofs grade against **`challenge.hashIndexRoot`**, not the voter’s later live root.
- A seating certificate is **not** a live root lock. Later freezer appends must not move `QUALIFIED` back to `SYNCING`.
- Challenge answers echo the **frozen** challenge roots. AC samples match on `valueHash|membershipRoot|tipStateRoot|bodyCommitment` (membership optional). Lab first-write may differ on signer set / `domainId` / `acceptedAt`; a different `valueHash` still fails. `DleLabGenesisCertificateV1` stubs are `notArchiveCertificate` but are stored as `kind=ac` and must grade this way.
- Lab catalogues **tip first**. A `kind=ac` locator without a freezer AC must answer/grade against `tipStateRoot` at that height. If the challenger already holds an AC commitment, the candidate **must** open the AC object (P8b); tip-only answers fail even when `tipStateRoot` matches. Catch-up must not `putLocator` for a kind the donor slot does not hold, and must retry a peer that does.
- `SYNC_CATCHUP_BATCH = 128` with `beginBatch` + yield every 16 objects. Start probes wait on **`GET /liveness`**, never `/health`.
- Lab \(C_G\) has thousands of hosted `chainNftId`s. **P9 landed (2026-08-17):** seven G1 `/sync/opening` all `opened===hosted` unique **2103**, `policy=all-hosted`, `sampleCount=2104` (tip-heavy + one `hashIndex`). Evidence `p9-opening.json` `ok:true` at `2026-08-17T06:35:54.834Z`. `/health` `hostedChainCount` is raw `chainNftIds.length` (**2104** after this keep). `POST /sync/challenge` uses `SYNC_CHALLENGE_TIMEOUT_MS = 180s`. Roster / status reads use `SYNC_STATUS_TIMEOUT_MS = 30s`. Each voter challenges **one** candidate per tick. Re-smoke: `npm run lab:smoke-cg-open`. Do **not** scrape `/sync/status` on all seven just to prove opening.
- Redeploy G1 keep-data only: `npm run lab:deploy-g1-keep` (merges G1+G2 `planeDirectory`). Do **not** use `lab:deploy-m6` just to refresh G1 (it restarts G2). `lab:deploy-archive-keep` still drops `planeDirectory`. Remapped NYC keepers only: `npm run lab:keep-remap-l2` (keep-data `fd-01`/`fd-03`, then peer-refresh `fd-02`/`fd-04`/`fd-05`; **never** starts standby).
- Bootstrap deadlock: candidate cannot vote. All **5 G1 actives** must be up before wipe. Keepers fd-01..04 must already be `QUALIFIED`.
- Zero-join accept: `npm run lab:wipe-sync-join` then `npm run lab:accept-sync-join`. Wipe set is wipe-safe joiners only (`fd-05` / `fd-06` / `fd-07`); **never keepers**. Default P8d pick is random **2** hosts and **must** include the only wipe-safe active `fd-05` (else cataloguing does not freeze). Override with `LAB_SYNC_JOIN_WIPE_DOMAIN_IDS`. Never geth/beacon. Evidence: `pilot/evidence/conet-dle-sync-join-2026-08/`.

Applies to cold start / restart of an assigned member, standby replacement from `UnassignedPool`, and new-group formation (empty \(C_G\) still challenges the witness `historySnapshotRoot` / empty-inventory commitment).

### P8 honest challenge window

**Status (2026-08-17):** P7 seating facade accepted (leaf 4956). **P8a–P8d landed.** P8d random wipe **fd-05 + fd-06** (not fd-07 this round; never keepers): wipe leaf **5194** → accept leaf **5194**, `leafGrew: false`, `stale: false`, `waitedMs≈128098`, `accept.json` `ok:true` at `2026-08-17T06:18:41.255Z`. Completing P8 **MUST NOT** start `pilotStartedAt`. This is not full \(C_G\), not EIP-712, not `PilotQualificationGate`.

P7 honesty gap that P8 closed: wipe keepers were at leaf **4951**; accept landed at **4956**. P8d re-ran with freeze on: leaf stayed **5194**.

| Step | Status | Deliver |
|---|---|---|
| **P8a** | landed | `inventoryFreeze.ts` + `indexLabHashObject` refuse **new** locators (`ERR_INVENTORY_FROZEN`). Catch-up `putLocator` is not frozen. `inventoryShouldFreeze()` = `hasUnseatedActive()` **or** local/roster `STATE_CHALLENGE`. **Do not** freeze on `pendingChallenge !== null` (`status()` would fake-freeze QUALIFIED). `lab-cli` stops BFT / newchain / on-demand while frozen; `start()` resets `stopped`. Health: `bftProcessStarted` vs `bftDiskNetworked` (`networked: true` is the disk/facade bit, not `engine.start()`). Fresh `POST /newchain/request` → 409; duplicates stay 200. |
| **P8b** | landed | `sampleBodiesMatch`: if the challenger already has an AC commitment, the candidate **must** open the AC object. Tip fallback only when expected has no AC body (genesis tip-first). |
| **P8c** | landed | `health()` does **not** call `status()` / `ensurePendingChallenge`. Slim `syncQualification` (phase / seating / four roots / `nonce` / no `pendingChallenge`). `GET /sync/status` still rebuilds the challenge for voters. Deploy probes stay on `GET /liveness`. |
| **P8d** | landed | Random wipe-safe pair **fd-05 + fd-06**. Join-window `leafCount` stayed **5194**. No `ERR_SYNC_CHALLENGE_STALE`. Accept polls `/health` (not `/sync/status`) so QUALIFIED keepers are not challenge-rebuilt every scrape. |

### P9 lab-wide \(C_G\) opening (HMAC)

**Status (2026-08-17):** **P9 landed.** `lab:deploy-g1-keep` LIVE_OK on seven G1 hosts (no wipe). `lab:smoke-cg-open` `ok:true`: unique hosted **2103 === opened 2103**, `sampleCount=2104` (hosted tips + one `hashIndex`), all seven `openedAllHostedChains=true`, `policy=all-hosted`. Post-keep `/health`: all seven `QUALIFIED`, `inventoryFrozen=false`, leaf **5225**. Completing P9 **MUST NOT** start `pilotStartedAt`. This is **not** production \(C_G\), not EIP-712, not CL RANDAO, not `PilotQualificationGate`. Do **not** write this lab open into the whitepaper as production \(C_G\).

| Item | Lab P9 | Production §5.2.0f |
|---|---|---|
| Hosted set | every live unique `chainNftId` (**2103**) | every `chainNftId` |
| Beacon | lab keccak | CL RANDAO |
| Vote | HMAC | EIP-712 |
| HTTP | `GET /sync/opening` (no persist) | L1 / certificate |

After P9: consider malicious missing-object / permanent `REJECTED`. Then EIP-712 / CL RANDAO / 30-day gate. Do **not** wipe for a full-open join unless newly authorized.

### P10 malicious missing-object / permanent `REJECTED`

**Status (2026-08-17):** **P10 landed (engine + unit tests + live safety smoke).** Whitepaper “missing object / mismatch” means the **candidate** freezer miss, not the voter’s. `gradeChallenge` still emits `ERR_SYNC_OBJECT_MISMATCH:<kind>:<nft>` (candidate `null`) vs `ERR_SYNC_CHALLENGER_MISSING:<nft>` (voter freezer miss). P10 honesty fix: voter skip + inbound no-op + `reject()` no-op for `CHALLENGER_MISSING`. Locator-only catalogues can still align the four roots; bodies decide the grade. Live keep (`lab:deploy-g1-keep`, no wipe) + `lab:smoke-rejected-safety`: seven G1 `QUALIFIED`, no active `REJECTED` (`p10-rejected-safety.json` `ok:true`, `at=2026-08-17T06:55:13.921Z`).

| Case | Engine |
|---|---|
| Voter grades `CHALLENGER_MISSING` | skip; **no** `POST /sync/reject` |
| Inbound `CHALLENGER_MISSING` | no-op (stay `CLAIMED_SYNC` / `SYNCING`) |
| Auto-claim + `OBJECT_MISMATCH` | demote `SYNCING` |
| `holdClaimed` + `OBJECT_MISMATCH` | terminal `REJECTED` |
| Hop during opening | always terminal |
| Process restart of `REJECTED` | new seating (`SYNCING`) |
| Permanent `REJECTED` active at \(Q_A=4\) | `hasUnseatedActive=true` → inventory stays frozen (unit-tested; **do not** wipe a live keeper to reproduce) |

Adversarial cases are **unit tests only** (`runtime/test/sync-qualification.test.ts`). Live: `npm run lab:smoke-rejected-safety` scrapes live G1 `/health` for all official seats, including remapped `fd-01` / `fd-03`. Fail if any live **active** is `REJECTED` or live keepers `fd-01..04` are not `QUALIFIED`. Remapped HostHatch NYC keepers `45.132.74.220` / `45.132.74.221` now run keep-data L2 (`lab:keep-remap-l2`, 2026-08-17). Evidence `pilot/evidence/conet-dle-sync-join-2026-08/p10-rejected-safety.json`. **Never** inject a missing object or `claimSync` against a live active. **Never** wipe keepers to “fix” `REJECTED`. Completing P10 **MUST NOT** start `pilotStartedAt`. Still HMAC, **not** production \(C_G\) / EIP-712 / CL RANDAO.

After P10: EIP-712 / CL RANDAO / 30-day gate. A **full-open from-zero join** needs a newly authorized empty datadir. Do **not** reuse the P8d wipe path (it still forces `fd-05`).

### Official G1 live SSH hosts (2026-08-17)

Seat identity is `domainId` + `participantWallet`, **not** the IP. Official roster stays **7**. **`fd-01-ionos-45` stays live**; only old IONOS `74.208.224.45` is excluded. Live `sshHost` is `45.132.74.220`. **`fd-03-ionos-98` stays live**; only old IONOS `198.251.77.98` is excluded. Live `sshHost` is `45.132.74.221`. Keep-data L2 is running on both remapped hosts after authorized `lab:keep-remap-l2` (2026-08-17). Do **not** use official-seven keep (`lab:keep-p11-peers` / `lab:deploy-archive-keep` / `lab:deploy-g1-keep`) just to refresh these two seats — that would also start standby `fd-06` / `fd-07`. Peer refresh after remap is only `fd-02` / `fd-04` / `fd-05`.

**MVP exclude:** `74.208.224.45` and `198.251.77.98`. Do **not** SSH, keep-deploy, `extraPeers`, on-demand hook, newchain-user, or nginx-upstream those IPs. `loadLabHosts` / `runSsh` / `runScp` must refuse them. `agentConfigFor(fd-01)` and `agentConfigFor(fd-03)` must succeed; peers must use `45.132.74.220` and `45.132.74.221`. Historical `pilot/evidence/**` may still name the old IPs — do **not** rewrite evidence. This exclude is **not** an L1 health-check delist.

| domainId | live sshHost | role |
|---|---|---|
| `fd-01-ionos-45` | `45.132.74.220` | active keeper (L2 keep-data running) |
| `fd-02-ionos-189` | `216.225.197.189` | active keeper |
| `fd-03-ionos-98` | `45.132.74.221` | active keeper (L2 keep-data running) |
| `fd-04-hosthatch-tokyo1` | `167.254.243.38` | active keeper |
| `fd-05-hosthatch-tokyo2` | `170.205.39.67` | active wipe-safe |
| `fd-06-ionos-174` | `216.225.193.174` | standby |
| `fd-07-ionos-207` | `212.227.242.207` | standby |

Live keepers are **fd-01 / fd-02 / fd-03 / fd-04**. Do **not** auto-promote a standby. Do **not** wipe `fd-01` or `fd-03`. Completing this remap **MUST NOT** start `pilotStartedAt`.

**Explorer nginx** (`dle.conet.network`, 2026-08-17 authorized): `45.132.74.220:27101`, `45.132.74.221:27101`, `167.254.243.38:27101`, `170.205.39.67:27101`. Do **not** proxy shared-beacon `216.225.197.189` or standby leftover `216.225.193.174` / `212.227.242.207`.

### P11 extra-joiner full-open from-zero (HMAC)

**Authorized 2026-08-17:** HostHatch HK1 `167.104.98.104` as extra **standby** `fd-08-hosthatch-hk1`. Official G1 inventory stays **exactly 7** (5 active + 2 standby). This joiner is **not** an 8th voting domain. `membershipRoot` still covers the five seeded actives. **Never** wipe `fd-01..07`. **Never** wipe `fd-05` “to freeze the catalogue.”

Sequence (BFT/ondemand stay held 30 minutes after the keep restart):

1. `npm run lab:probe-p11-joiner` — greenfield SSH; no geth/beacon/validator
2. `npm run lab:keep-p11-peers` — official seven `keepData:true`; merge `extraPeers` + G1+G2 `planeDirectory`
3. Confirm four keepers `QUALIFIED`
4. `npm run lab:deploy-p11-joiner` — empty `~/dle-30d-lab/data` **only** on `167.104.98.104` (`START_ARCHIVE` wipe). **Do not** use this to refresh binaries after P11 is seated.
5. Binary refresh after P11: `npm run lab:keep-p11-joiner` — same extras / planeDirectory, `keepData:true` / `START_ARCHIVE_KEEP_ALL`. **Never** wipe `fd-08` to ship P12–P20.
6. `npm run lab:accept-p11-join` — joiner `QUALIFIED` + keepers + `fd-05` stay seated; joiner `/sync/opening` `policy=all-hosted` and `opened===hosted` (>8)

Combined: `npm run lab:p11-full-open-join`. Evidence: `pilot/evidence/conet-dle-sync-join-2026-08/p11-probe.json` / `p11-keep.json` / `p11-deploy.json` / `p11-accept.json` / `p11-opening.json`. Do **not** reuse P8d `wipe.json` / `accept.json`.

**P11 landed 2026-08-17T07:52:17.884Z:** extra joiner `QUALIFIED`; official seven + `fd-05` stayed `QUALIFIED` (never wiped); `membershipRoot` still `0xdeb200a9…e22241` (five seeded actives); joiner `/sync/opening` unique hosted **2249 === opened 2249**, `sampleCount=2250`, `policy=all-hosted`; accept `waitedMs=333122` (~5.6 min); joiner leaf **5673**, official leaf **5674**. Completing P11 **MUST NOT** start `pilotStartedAt`. P11 itself was still HMAC openings. Seating **votes** cut over in **P12**.

### P12 seating EIP-712 (lab votes)

**Status (2026-08-17):** **P12 landed (engine + unit tests).** `POST /sync/vote` / `POST /sync/reject` accept only EIP-712 `ArchiveSyncQualificationCertificate`. HMAC seating votes return `ERR_SYNC_HMAC_CUTOVER`. Domain `CoNET-DLE-Archive`, version `1`, `chainId` 224422, `verifyingContract` = deployed `ArchiveCertificateVerifierV1` proxy `0xdA06E6d06eB2816795102B18171a079E3bEA948f` (bind only; **no** L1 call, **no** verifier upgrade, **no** MembershipCheckpoint settle). Typed data does **not** include `domainId`; identity is `recoverAddress` + envelope `domainId`.

`recoverAddress` must equal `labSeatingAddress(vote.domainId)` **and** `vote.signer`. Voter ∈ current actives. `membershipRoot` must equal current `membershipRootOf(actives)` (formula **unchanged**). ACCEPT also binds `groupId` + four inventory roots to the **challenge** inventory (`ERR_SYNC_ROOT_MISMATCH`). REJECT uses the same struct with `accept: false` and does **not** require hosted / lastAC / hashIndex alignment. New quorum counts only EIP-712 ACCEPT votes at \(Q_A=4/5\).

Lab seating key is deterministic secp256k1: `keccak256(utf8("dle.archive.lab.seating.operator.v1|" + domainId))`. Honest flags: `eip712: true`, `hmacForgeable: false`, `labDeterministicSeatingKey: true`, `notProductionOperatorKey: true`, `notL1Settled: true`. Knowing the algorithm can still derive the key — P12 delivers **real EIP-712 + recoverAddress bound to the active set**, not OperatorDomain / L1 member keys.

Keep-only: disk HMAC certificates still restore `QUALIFIED` (`restoreIfCertificateHolds` does **not** re-verify old votes). Unsigned disk challenges are treated as no pending (P15 rebuilds). BFT AC votes later cut over in **P16**; on-demand attests later cut over in **P17**. `status()` / `health().syncQualification` may expose `seatingEip712: true` / `challengeEip712: true` — Explorer green pills stay `seatingQualified === true` only; **do not** paint those flags as production.

**Archive tarball (P12+):** `npm run runtime:build` must `npm install --omit=dev --prefix runtime/dist/archive` so `ethers` ships inside `dle-archive-runtime.tgz`. Remote unpack must **not** overwrite `app/package.json` with a stub that drops `node_modules`. Missing `ethers` crashes `bft/mac.js` after listen and takes the official seven down. Binary refresh: `lab:keep-p11-peers` then `lab:keep-p11-joiner` (`keepData:true`). **Never** `lab:deploy-p11-joiner` to ship this cutover.

Tests: `runtime/test/sync-qualification.test.ts` (HMAC cutover, recoverAddress bind, 4/5 vs 3/5). Completing P12 **MUST NOT** start `pilotStartedAt`. Do **not** change whitepaper production terms.

### P13 freeze-then-beacon (lab seating challenge)

**Status (2026-08-17):** **P13 landed (engine + unit tests).** Whitepaper §5.2.0f production seed is \(R^{\mathrm{sync}}_e = H(\texttt{dle.archive.sync.challenge.v1} \Vert \texttt{L1BeaconFinalizedRandomness}_e \Vert \ldots)\). This gate does **not** change that formula. It only stops the lab from deriving seed from the same instant keccak as the freeze hex.

Sequence:

1. `freezeChallengeRoots` → `ArchiveSyncFreezeV1` (`beaconBound: false`, `waitingForClBeacon: true`). Persists `hostedChainSetRoot` / `lastACRef` / `candidateSetRoot` / `freezeHex`. **No** `seed` / `samples` / `labBeacon`.
2. Engine `persist()`s `pendingFreeze` **before** bind (`pendingChallenge = null` at that write).
3. `probeFinalizedClRandomness` is **read-only** and **does not HTTP-fetch**. `publicrpc` / `rpc1` / `rpc.conet.network` → `forbidden_el_rpc_as_cl`. Default: `no_finalized_cl_view` (honest lab wait). Optional 32-byte hex (`DLE_ARCHIVE_CL_FINALIZED_RANDOMNESS` or injected) is `injected-cl-view` and still `notClRandao` / `notProductionBeacon`.
4. `bindChallengeBeacon` then binds seed. No finalized view → `labSyncBeaconAfterFreeze(freezeHex, revealSalt)` with `revealSalt = postFreezeRevealSalt(...)` (engine: `postFreezeRevealMaterial` or `Date.now()`). Instant `labSyncBeacon(freezeHex)` is **contrast only** and must **not** equal the bound `labBeacon`.

Honest flags on the bound challenge / `status()` / `health().syncQualification`: `freezeBeforeBeacon`, `labBeaconAfterFreeze`, `notProductionBeacon`, `publicrpcNotClRandao`, `notClRandao`. Challenge / opening cut over in **P15** (`hmacForgeable: false`). BFT AC votes later cut over in **P16**; on-demand attests later cut over in **P17**; the on-demand lab beacon is **unchanged**. `health()` still does **not** rebuild `pendingChallenge` (P8c). Explorer green pills stay `seatingQualified === true` only — **do not** paint `labBeaconAfterFreeze` as production CL RANDAO.

Tests: `runtime/test/sync-qualification.test.ts` (freeze has no seed; post-freeze ≠ `keccak(freezeHex)`; publicrpc/rpc1 rejected; engine persist-then-bind). Completing P13 **MUST NOT** start `pilotStartedAt`. Do **not** change whitepaper production terms.

### P14 production \(C_G\) split (lab freezer vs L1 `archiveGroupId`)

**Status (2026-08-17):** **P14 landed (engine + unit tests).** Whitepaper §5.2.0f production \(C_G\) is the L1 `archiveGroupId` ordered `chainNftId` set ∪ `{lastAC, membershipRoot, hashIndexRoot}`. This gate does **not** change that formula and does **not** write the lab freezer 2249-chain set into the whitepaper.

- Laboratory seating openings stay on the **freezer hosted-set** (`labCgOpeningView`; P9/P11 `opened===hosted` unchanged). Live seven-domain seating is **not** reduced to an L1 small-set.
- `probeProductionCg` is **read-only** and **does not HTTP-scan** `publicrpc` / `rpc1` / `rpc.conet.network` (`forbidden_el_rpc_as_production_cg`). Default: `no_l1_archive_group_id_view` (honest wait).
- Optional injected small-set (`DLE_ARCHIVE_PRODUCTION_CG_JSON` or `productionCgProbe`) is still `notLiveL1Scan` / `notProductionCg`. `groupStorageKey` is the L1 uint storage key (`notUserVisibleGroupId`). If the injected `chainNftIds` equal a non-empty lab hosted-set → `lab_hosted_set_is_not_production_cg`.
- `GET /sync/opening` remains `DleLabCgOpeningV1` on the freezer set (`notProductionCg`). It may attach `productionCg` smoke (`DleProductionCgOpeningSmokeV1`) that opens **only** the injected L1 set. Smoke never substitutes the lab freezer opening.
- `health()` attaches `productionCgHealthView` only — **no samples** (P8c). Flags: `labHostedSetNotProductionCg`, `publicrpcNotProductionCg`, `productionCgAvailable`.
- Explorer green pills stay `seatingQualified === true` only. Do **not** paint lab 2249 / `labCgOpening` / `productionCgAvailable` / an injected small-set as live L1 production \(C_G\).
- BFT AC votes later cut over in **P16**; on-demand attests later cut over in **P17**; the on-demand lab beacon is **unchanged**.

Tests: `runtime/test/sync-qualification.test.ts` (publicrpc/rpc1 rejected; lab hosted-set rejected as \(C_G\); injected small-set smoke; engine keeps freezer opening). Completing P14 **MUST NOT** start `pilotStartedAt`. Do **not** change whitepaper production terms.

### P15 challenge / opening EIP-712

**Status (2026-08-17):** **P15 landed (engine + unit tests).** Same domain as P12: `CoNET-DLE-Archive` / `1` / `chainId` 224422 / `verifyingContract` `0xdA06E6d06eB2816795102B18171a079E3bEA948f` (bind only; **no** L1 call). Typed data is `ArchiveStateChallenge`. **Do not** put 2250 samples in the EIP-712 array — bind `samplesRoot` instead.

```text
samplesRoot = keccak256Utf8(samples.map(s => `${chainNftId}|${height}|${kind}|${hash}`).join(';'))
challengeHash = keccak256Utf8("dle.archive.sync.challenge.hash.v1|" + seed + "|" + candidate + "|" + nonce + "|" + hashIndexRoot)
```

`challengeHashOf` formula is **unchanged**. `bindChallengeBeacon` / `buildChallenge` sign with the **challenger** lab seating key. `recoverAddress` must equal `labSeatingAddress(challenger)` **and** `challenge.signer`. HMAC / unsigned / `hmacForgeable===true` / missing signature → `ERR_SYNC_CHALLENGE_HMAC_CUTOVER`. Bad recover / `samplesRoot` / stored `challengeHash` → `ERR_SYNC_CHALLENGE_SIG`. `challengeSamplesMatchSeed` (recompute via `buildStratifiedSamples` + existing `sampleKey`) fail → `ERR_SYNC_CHALLENGE_SAMPLES`. Do **not** require `challenger === candidate`. Do **not** sign answers. Unsigned disk `pendingChallenge` is treated as no pending.

`GET /sync/opening` / `status()` / `health().syncQualification`: `eip712: true`, `hmacForgeable: false`, `challengeEip712: true`. `health()` still does **not** rebuild `pendingChallenge` (P8c). Explorer green pills stay `seatingQualified === true` only. BFT AC votes later cut over in **P16**; on-demand attests later cut over in **P17**.

Tests: `runtime/test/sync-qualification.test.ts` (HMAC cutover; tampered samples SIG; resigned miss-seed SAMPLES; engine claimSync signed). Completing P15 **MUST NOT** start `pilotStartedAt`. Do **not** change whitepaper production terms.

### P16 BFT AC vote EIP-712

**Status (2026-08-17):** **P16 landed (engine + unit tests).** Same domain as P12 / P15: `CoNET-DLE-Archive` / `1` / `chainId` 224422 / `verifyingContract` `0xdA06E6d06eB2816795102B18171a079E3bEA948f` (bind only; **no** L1 call). Typed data is `ArchiveBftVote`. Typed data does **not** include `domainId`; identity is `recoverAddress` + envelope `domainId`.

```text
ArchiveBftVote: valueHash, height, round, step, membershipRoot, prevoteQCRef
```

Reuses the P12 lab seating key `keccak256(utf8("dle.archive.lab.seating.operator.v1|" + domainId))`. Do **not** invent a second BFT key. `recoverAddress` must equal `labSeatingAddress(domainId)` **and** `vote.signer`. HMAC / unsigned / `hmacForgeable===true` / `eip712!==true` / missing `signature` → `ERR_BFT_HMAC_CUTOVER`. Bad recover / signer bind → `ERR_BFT_VOTE_SIG`. Active set, `membershipRoot`, step, and double-sign (`ERR_WAL_DOUBLE_SIGN`) are **unchanged**. Do **not** change `membershipRootOf` / `topicQcRef` / Mode A `valueHash`.

Keep-only: disk HMAC **certificates** still restore tip finality (`parseCertificate` does **not** re-verify old votes). HMAC votes loaded from disk are skipped by `acceptVote` (`prevoteCount` may be 0). New votes must be EIP-712.

`status()` / `health()`: `eip712: true`, `hmacForgeable: false`, `bftEip712: true`. Explorer green pills stay `seatingQualified === true` only. Do **not** paint `bftEip712` as a frozen L1 wrapper or corpus SSZ. At P16 landing this gate **did not** replace on-demand HMAC, P6 \(Q_V\) HMAC (`validatorQuorum.ts` still `hmacForgeable: true`), wipe, promote `fd-08`, or start `pilotStartedAt`. On-demand attests later cut over in **P17**.

Tests: `runtime/test/bft-tendermint.test.ts` (HMAC cutover; recoverAddress bind + tampered SIG; keep-only disk HMAC certificate). Full `npm run runtime:test` **125/125** at P16 landing; later **128/128** after P17. Completing P16 **MUST NOT** start `pilotStartedAt`. Do **not** change whitepaper production terms. Later **P21** added `hashIndexRoot` after `membershipRoot` and **did** change `topicQcRef` encoding — see §P21.

### P17 on-demand attest EIP-712

**Status (2026-08-17):** **P17 landed (engine + unit tests).** Same domain as P12 / P15 / P16: `CoNET-DLE-Archive` / `1` / `chainId` 224422 / `verifyingContract` `0xdA06E6d06eB2816795102B18171a079E3bEA948f` (bind only; **no** L1 call). Typed data is `ArchiveOnDemandAttest`. Typed data does **not** include `domainId`; identity is `recoverAddress` + envelope `domainId`.

```text
ArchiveOnDemandAttest: poolRoot, epoch, shardId, roulette
```

Reuses the P12 lab seating key `keccak256(utf8("dle.archive.lab.seating.operator.v1|" + domainId))`. Do **not** invent a second on-demand key. `recoverAddress` must equal `labSeatingAddress(domainId)` **and** `attest.signer`. HMAC / unsigned / `hmacForgeable===true` / `eip712!==true` / missing `signature` → `ERR_ONDEMAND_HMAC_CUTOVER`. Bad recover / signer bind → `ERR_ONDEMAND_ATTEST_SIG`. Parse without mac and without signature → `ERR_INVALID_ATTEST`.

Keep-only: disk HMAC attests still restore via `verifyLabPoolAttestForRestore` and may still count toward `endorsed`. New ingest / `adoptAttest` must be EIP-712.

`health()` / SelectionLog: `eip712: true`, `hmacForgeable: false`, `ondemandEip712: true`. Explorer green pills stay `seatingQualified === true` only. Do **not** paint `ondemandEip712` / `endorsed` as 30-day qualification or a production beacon. **Did not** replace the on-demand lab beacon (`dle.lab.beacon.afterFreeze.v1` / keccak after freeze), P6 \(Q_V\) HMAC (`validatorQuorum.ts` still `hmacForgeable: true`), gossip wait-hook, wipe, promote `fd-08`, or start `pilotStartedAt`. SelectionLog is **not** an Archive Certificate and does **not** change Mode A `valueHash`.

Tests: `runtime/test/ondemand-eip712.test.ts` (HMAC cutover; recoverAddress bind + tampered SIG; keep-only disk HMAC attests). Full `npm run runtime:test` **128/128** at P17 landing; later **131/131** after P18. Completing P17 **MUST NOT** start `pilotStartedAt`. Do **not** change whitepaper production terms.

### P18 validator quorum \(Q_V\) EIP-712

**Status (2026-08-17):** **P18 landed (engine + unit tests).** Same domain as P12 / P15 / P16 / P17: `CoNET-DLE-Archive` / `1` / `chainId` 224422 / `verifyingContract` `0xdA06E6d06eB2816795102B18171a079E3bEA948f` (bind only; **no** L1 call). Typed data is `ArchiveValidatorQuorumAttest`. Typed data does **not** include `validatorId` / `domainId`; identity is `recoverAddress` + envelope `validatorId`.

```text
ArchiveValidatorQuorumAttest: requestId, valueHash, tipStateRoot, bodyCommitment
```

Reuses the P12 lab seating key `keccak256(utf8("dle.archive.lab.seating.operator.v1|" + validatorId))` where `validatorId` is the request-derived committee hex (`labValidatorId(requestId, index)`). Do **not** invent `dle.archive.lab.validator.operator.v1`. Do **not** change the P6 committee formula. `recoverAddress` must equal `labSeatingAddress(validatorId)` **and** `attest.signer`. HMAC / unsigned / `hmacForgeable===true` / `eip712!==true` / missing `signature` → `ERR_VALIDATOR_QUORUM_HMAC_CUTOVER`. Bad recover / signer bind → `ERR_VALIDATOR_QUORUM_SIG`. Committee not derived from `requestId` still fails. Fewer than 5 valid EIP-712 attests fails (`needs 5`).

Keep-only: disk HMAC \(Q_V\) still restore via `verifyLabValidatorQuorumForRestore` / `parseLabValidatorQuorum`. New `POST /newchain/request` / `verifyLabValidatorQuorum` must be EIP-712.

`health()`: `newchainValidatorQuorumEip712: true`, `newchainHmacForgeable: false` (namespaced so they do not collide with sync / BFT / on-demand `hmacForgeable`). Explorer green pills stay `seatingQualified === true` only. Do **not** paint `newchainValidatorQuorumEip712` as production secp256k1 / 30-day qualification. **Did not** replace the on-demand lab beacon (`dle.lab.beacon.afterFreeze.v1` / keccak after freeze), gossip wait-hook, seating / challenge / BFT / on-demand attest, `membershipRootOf` / Mode A `valueHash`, `chainNftId`, NFT 42 tip, or new-chain-user HTTP (still only `schema === 'DleLabValidatorQuorumV1'`).

Tests: `runtime/test/validator-quorum.test.ts` + `runtime/test/validator-quorum-eip712.test.ts` (HMAC cutover; recoverAddress bind + tampered SIG; keep-only disk HMAC \(Q_V\)). Full `npm run runtime:test` **131/131** at P18 landing; later **134/134** after P19. Completing P18 **MUST NOT** start `pilotStartedAt`. Do **not** change whitepaper production terms.

### P19 on-demand freeze-then-bind

**Status (2026-08-17):** **P19 landed (engine + unit tests).** Aligns on-demand with P13: freeze first, then bind a lab beacon. Whitepaper §7.8.1 production seed stays live CL RANDAO. This gate does **not** change that formula and does **not** replace P17 `ArchiveOnDemandAttest` or P18 \(Q_V\).

Sequence:

1. `applyFreeze` → persist `poolRoot` + `ondemandFreezeHex` (`dle.lab.ondemand.freeze.v1`). **No** beacon / roulette / committee at that write.
2. `bindBeacon` then binds:
   - `options.beacon` → `options-beacon`
   - `probe.available` (`probeFinalizedClRandomness`; **no HTTP** to `publicrpc` / `rpc1`) → `injected-cl-view`
   - default honest-wait: `revealSalt = ondemandHonestWaitReveal(freezeHex)` → `labOnDemandBeaconAfterFreeze(freezeHex, revealSalt)` → `lab-after-freeze`
   - explicit `options.postFreezeRevealMaterial` only → `ondemandPostFreezeRevealSalt` (Date.now() salt; seven independent freezes would diverge)
3. Instant `labBeaconAfterFreeze(poolRoot)` is **contrast only** and must **not** equal a new freeze's bound beacon.
4. `drawCommittee` still accepts an optional beacon (instant keccak default for pure-function contrast / old “same \(R_e\)” tests). New engine freezes **must** pass the bound beacon.

Keep-only: disk SelectionLog with instant-keccak beacon still restores `endorsed` (`legacy-instant`). `computeDraw` must use `selection.beacon`.

`health()` (namespaced; do not collide with sync `labBeaconAfterFreeze`): `ondemandFreezeBeforeBeacon`, `ondemandLabBeaconAfterFreeze`, `ondemandNotProductionBeacon`, `ondemandPublicrpcNotClRandao`, `ondemandBeaconSource`. Explorer green pills stay `seatingQualified === true` only. Do **not** paint `ondemandLabBeaconAfterFreeze` as production CL RANDAO.

**Did not** replace P17 attest / P18 \(Q_V\) / seating / challenge / BFT, `membershipRootOf` / Mode A `valueHash`, gossip wait-hook, 7+2 formula, `MIN_WAIT_POOL`, anti-hoard, or start `pilotStartedAt`.

Tests: `runtime/test/ondemand-beacon-after-freeze.test.ts` (new freeze ≠ instant keccak; injected view; publicrpc rejected; keep-only `legacy-instant`). Full `npm run runtime:test` **134/134** at P19 landing; later **140/140** after P20. Completing P19 **MUST NOT** start `pilotStartedAt`. Do **not** change whitepaper production terms.

### P20 gossip wait-hook honesty

**Status (2026-08-17):** **P20 landed (engine + daemon + unit tests).** Whitepaper §5.4 / §8.1: a wait hook **must not** assume same-group archives already gossiped the miner. miner / daemon **must** POST the same hook to every active archive in that group. One accept ≠ group waiting-pool consistency. Lab `POST /ondemand/hook` on TCP **27101** is **not** production DePIN gossip. Explorer nginx **must not** expose `POST /ondemand/hook`.

This is **not** “turn the HTTP hook into production DePIN gossip”. Production gossip (IdentityEligible / OperatorDomain / \(U_e\)) stays parked.

Engine `gossip()` still forwards **attests + selection only** — **never** miners. P20 is an honesty gate:

1. `ingest()`: if `body.miners` / `body.hooks` / `body.hook` exist → reject the whole packet `ERR_ONDEMAND_HOOK_NOT_GOSSIP` (no miner merge, no attest processing).
2. `hook()` 200 / 409: `notGossiped`, `mustFanoutToEveryActiveArchive`, `notProductionDepinGossip`; queued note = `LAB_HOOK_QUEUED_NOTE`.
3. `pool()`: `hookNotGossip` / `mustFanoutToEveryActiveArchive` / `notProductionDepinGossip`.
4. `health()`: `ondemandHookNotGossip`, `ondemandMustFanoutToEveryActiveArchive`, `ondemandNotProductionDepinGossip`.

Daemon `OnDemandWaitSession` required flags: `hookNotGossip`, `mustFanoutToEveryActiveArchive`, `notProductionDepinGossip`, `singleArchiveAcceptNotGroupPool`, `fanoutComplete`.

- `submitWaitHook`: `fanoutComplete: false`; note = `LAB_HOOK_SINGLE_ARCHIVE_NOTE`
- `submitWaitHookToArchives`: `fanoutComplete = allQueued`; incomplete → `LAB_HOOK_FANOUT_INCOMPLETE_NOTE`

Explorer green pills stay `seatingQualified === true` only. Do **not** paint `ondemandHookNotGossip` as production DePIN gossip.

**Did not** replace P12–P19 tickets / beacons / \(Q_V\), `membershipRootOf` / Mode A `valueHash`, `chainNftId`, NFT 42 tip, 7+2 formula, `MIN_WAIT_POOL`, anti-hoard, attest / selection HTTP gossip (`/ondemand/message`), explorer nginx, or start production DePIN gossip / `pilotStartedAt`.

Tests: `runtime/test/ondemand-hook-not-gossip.test.ts` (health + hook flags; ingest miners/hooks rejected; A hook does not gossip to B; extra-miner freeze mismatch; single-archive `fanoutComplete === false`; incomplete fan-out rejected). Full `npm run runtime:test` **140/140**. Completing P20 **MUST NOT** start `pilotStartedAt`. Do **not** change whitepaper production terms.

### P21 hashIndexRoot into lab BFT

**Status (2026-08-17):** **P21 landed (engine + unit tests).** Bind the live / bound `hashIndexRoot` into lab BFT vote / QC / AC typed data and `topicQcRef`. P16 typed data omitted `hashIndexRoot` and forbade changing `topicQcRef`. This gate **does** add `hashIndexRoot` after `membershipRoot` (before `prevoteQCRef`) and **does** change `topicQcRef` encoding.

```text
ArchiveBftVote: valueHash, height, round, step, membershipRoot, hashIndexRoot, prevoteQCRef
```

`boundHashIndexRootOf(votes, liveRoot)`: first vote’s `hashIndexRoot`, else live tree root (`hashIndexRootOf(store.hash.listLocators())`). Empty-store live root is `emptyHashIndexRoot()`, **not** `ZERO32`. Disk load / `ensureTopic` omit `expectedHashIndexRoot`. New `addOwnVote` / ingest `acceptVote` pass `expectedHashIndexRoot: boundHashIndexRoot()`. Incoming QC / `adoptCertificate` require `hashIndexRoot === boundHashIndexRoot()`.

Tree honesty: `hashIndexRootView` / `proveHashIndex` / JSON-RPC `dle_getHashIndexRoot` / `dle_proveHash` keep `committedInAc: false`. **Do not** flip the tree field when AC binds a root. Overlay `hashIndexCommittedInAc(certificate)` is true **only** when AC has a **non-zero** `hashIndexRoot`. `emptyHashIndexRoot()` is domain-separated and ≠ `ZERO32`, so a freshly certified empty store can have overlay **true**. Disk HMAC AC missing the field parses as `ZERO32` → overlay **false**. Health / Explorer may show the overlay. **Do not** paint overlay as production AC commitment or the 30-day gate.

Keep-only: skip QC / AC rebuild if a certificate already exists; keep disk QC if rebuilt `qcRef` mismatches. HMAC / bad sig still win over `ERR_BFT_HASH_INDEX_ROOT`. Pre-P21 EIP-712 votes signed without `hashIndexRoot` fail verify after this gate (intended).

**Did not** change `membershipRootOf` / Mode A `valueHash` / daemon / on-demand / production AC commitment formula. Explorer green seating pills stay `seatingQualified === true` only.

Tests: `runtime/test/bft-tendermint.test.ts` + `runtime/test/hash-index-tree.test.ts`. Full `npm run runtime:test` **148/148** at P21 landing; later **153/153** after P22. Completing P21 **MUST NOT** start `pilotStartedAt`. Do **not** change whitepaper production terms.

### P22 official standby readiness (lab EIP-712)

**Status (2026-08-17):** **P22 landed (engine + unit tests).** Official standbys (`fd-06` / `fd-07`) sign EIP-712 `ArchiveStandbyReadiness` after `QUALIFIED`. Extra `fd-08` / `fd-08-hosthatch-hk1` may ingest but **does not** count toward `OFFICIAL_STANDBY_COUNT = 2`. This is **not** production OperatorDomain / secp256k1 / the 30-day gate.

```text
ArchiveStandbyReadiness: groupId, hostedChainSetRoot, lastACRef, membershipRoot, hashIndexRoot, ready
```

Typed data does **not** include `domainId`. Identity is `recoverAddress` + envelope `domainId`. Existing `groupId` is **`string`**, not `bytes32`. Follow the per-type hash/sign/recover triplet — **no** generic `hashArchiveTypedData`. `recoverAddress` must equal `labSeatingAddress(domainId)` and envelope `signer`. HMAC / unsigned envelopes `ERR_SYNC_STANDBY_HMAC_CUTOVER`. Bad sig `ERR_SYNC_STANDBY_SIG`. Role ≠ standby `ERR_SYNC_STANDBY_ROLE`. Four inventory roots + `groupId` must match local inventory (`ERR_SYNC_STANDBY_ROOT`).

HTTP: `POST /sync/standby-ready` (`lab-cli` and isolated `node.ts`). Official standby auto-signs and gossips after `QUALIFIED` on `lab-cli`. Persist `standbyReady` map; `REJECTED` reset **keeps** the map. Extra `fd-08` is ingest-only (`extraStandbyReadyDoesNotCount`).

New-chain accept (`lab-cli` and isolated `node.ts` via `syncHolder`): if `officialStandbysReady() === false` → 409 `ERR_NEWCHAIN_STANDBY_NOT_READY`. **P24 landed:** `node.ts` passes the same callback into `createNewChainEngine`. Isolated `node.ts` does **not** `sync.start()` (no seating tick against dummy peer URLs) and does **not** apply inventory freeze. `sync.health().inventoryFrozen` from `hasUnseatedActive` must **not** block accept.

Health overlays: `standbyReadyEip712`, `officialStandbyReadyCount`, `officialStandbysReady`, `extraStandbyReadyDoesNotCount`. Newchain health: `newchainOfficialStandbysReady`, `newchainStandbyReadyEip712`. **Do not** paint these as production or as seating. Explorer green pills stay `seatingQualified === true` only. Do **not** change `archiveSeating.ts`.

**Did not** change seating votes / challenge / BFT / on-demand / \(Q_V\), `membershipRootOf` / Mode A `valueHash`, Home green-pill logic, or start `pilotStartedAt`.

Tests: `runtime/test/sync-standby-ready.test.ts` + `newchain.test.ts` gate + `sync-qualification.test.ts` `fakeFetch`. Full `npm run runtime:test` was **153/153** at P22; **154/154** after P24. Completing P22 **MUST NOT** start `pilotStartedAt`. Do **not** change whitepaper production terms.

**P23 live evidence (2026-08-17):** `npm run lab:deploy-g1-keep` put the P12–P22 binary on official G1. **6/7 LIVE_OK.** Official standby `fd-06-ionos-174` STARTED after hung-lab-cli SIGKILL but missed `LIVE_OK`; a second keep-data-only retry still missed liveness (`STARTED=652654`). Process can sit at ~101% CPU with `/liveness` timeout — **not** a stable official standby host. fd-01 `POST /newchain/request` walked **409** `ERR_NEWCHAIN_STANDBY_NOT_READY` (`count=0` at `2026-08-17T23:13:41.428Z`) → **200** accept (`requestId` `0xe8229f1635d681d5b48430b5cd4a09e2c7787d4e4338a60c512ce9ab9d81b472`, `count=2` at `2026-08-17T23:18:22.095Z`). Overlay fields live under `health.syncQualification` on the six LIVE_OK hosts. `officialStandbysReady` is **not** a durable seven-host true (roots drift drops the count). Evidence: `pilot/evidence/conet-dle-p23-live-2026-08/`. Extra `fd-08` unofficial. G2 BFT/ondemand off. **Not** 7/7 healthy / **not** 30-day / **not** production.

**P24 isolated `node.ts` gate (2026-08-17):** `startArchiveNode` now constructs `createSyncQualificationEngine` (role-only peers `fd-06` / `fd-07` official + `fd-08` extra, `url: ''`) and passes `officialStandbysReady: () => syncHolder.current?.officialStandbysReady() === true` into `createNewChainEngine`. HTTP: `POST /sync/standby-ready`, `GET /sync/status`, `GET /sync/inventory`. Extra `fd-08` still does not count. Isolated node does **not** `sync.start()` and does **not** call `applyInventoryFreeze`. Test: `runtime/test/node-standby-gate.test.ts`. Full `npm run runtime:test` **154/154**. Completing P24 **MUST NOT** start `pilotStartedAt`. **Not** 7/7 healthy / **not** 30-day / **not** production.

**P25 Explorer overlays (2026-08-17):** Explorer Certificates + Home show **non-green** read-only chips for `officialStandbysReady` / `hashIndexCommittedInAc` (`explorer/src/lib/labOverlays.ts`). Green seating pills stay `seatingQualified === true` only (`archiveSeating.ts` unchanged). Missing overlay fields omit the chip (trusted-fetch). Tests: `npm run explorer:test` **8/8**. **Public SPA published (2026-08-18T00:02:39Z):** `https://dle.conet.network/` now serves `index-DaEv6psZ.js` (replaced stale `index-DfEo8U8r.js`). Live `/health` at publish still `officialStandbysReady=false` (`count=1`), `hashIndexCommittedInAc=false`, `seatingQualified=true`, `pilotStartedAt=null` — chips are warn/neutral, **not** green ready. Completing P25 **MUST NOT** start `pilotStartedAt`. **Next:** parked / review only. **Not** 7/7 healthy / **not** 30-day / **not** production.

### After P11: next lab gates

P11 closed the seating **control plane**. **P12 / P13 / P14 / P15 / P16 / P17 / P18 / P19 / P20 / P21 / P22 landed** (engine + tests). Snapshot: `src/canvas/dle-mvp-p12-milestones-2026-08.md`. Completing any of these **MUST NOT** start `pilotStartedAt`. Do **not** change whitepaper production terms in this track.

| Gate | Goal | Not |
|---|---|---|
| **P12** | **landed (engine + tests).** Seating votes = EIP-712 `ArchiveSyncQualificationCertificate` (domain `CoNET-DLE-Archive`, `chainId` 224422). After cutover, reject HMAC seating votes. keep-only. `recoverAddress` must land on current-active `membershipRoot`. | L1 MembershipCheckpoint settle; replacing BFT AC HMAC or on-demand HMAC in the same gate; wipe; `pilotStartedAt` |
| **P13** | **landed (engine + tests).** Freeze `hostedChainSetRoot` / `lastACRef` / candidate set **before** the bound beacon. Bind to a finalized CL view if one is injected; otherwise an honest lab-labeled wait (`labSyncBeaconAfterFreeze`). | Reading `publicrpc` / `rpc1` as live CL RANDAO; claiming keccak-after-freeze is production \(R^{\mathrm{sync}}_e\); HTTP-fetching EL RPC |
| **P14** | **landed (engine + tests).** Lab freezer hosted-set stays lab-only. Production \(C_G\) = L1 `archiveGroupId` ∪ `{lastAC, membershipRoot, hashIndexRoot}`. Optional injected L1 small-set smoke. | Writing 2249 lab chains into the whitepaper as production \(C_G\); HTTP-scanning `publicrpc`/`rpc1` as production \(C_G\); shrinking live seating to the L1 small-set |
| **P15** | **landed (engine + tests).** Challenge / opening = EIP-712 `ArchiveStateChallenge` (`samplesRoot`; `hmacForgeable: false`). HMAC / unsigned envelopes `ERR_SYNC_CHALLENGE_HMAC_CUTOVER`. Samples must rematch seed. | Replacing BFT AC HMAC or on-demand HMAC in the same gate; putting 2250 samples in typed data; changing `challengeHashOf`; `pilotStartedAt` |
| **P16** | **landed (engine + tests).** BFT AC votes = EIP-712 `ArchiveBftVote` (same domain; seating key reused). HMAC / unsigned votes `ERR_BFT_HMAC_CUTOVER`. keep-only disk HMAC certificates. | Replacing on-demand HMAC or P6 \(Q_V\) HMAC in the same gate; changing `membershipRootOf` / Mode A `valueHash`; L1 wrapper / corpus SSZ; wipe; `pilotStartedAt` |
| **P17** | **landed (engine + tests).** On-demand attests = EIP-712 `ArchiveOnDemandAttest` (same domain; seating key reused). HMAC / unsigned attests `ERR_ONDEMAND_HMAC_CUTOVER`. keep-only disk HMAC attests. | Replacing the on-demand lab beacon or P6 \(Q_V\) HMAC; changing SelectionLog into AC; gossip wait-hook; wipe; `pilotStartedAt` |
| **P18** | **landed (engine + tests).** P6 \(Q_V\) = EIP-712 `ArchiveValidatorQuorumAttest` (same domain; seating key reused on request-derived `validatorId`). HMAC / unsigned attests `ERR_VALIDATOR_QUORUM_HMAC_CUTOVER`. keep-only disk HMAC \(Q_V\). | Replacing the on-demand lab beacon; gossip wait-hook; changing committee / `membershipRootOf` / Mode A `valueHash`; wipe; `pilotStartedAt` |
| **P19** | **landed (engine + tests).** On-demand freeze-then-bind: persist `ondemandFreezeHex` first, then bind honest-wait / injected CL view / options beacon. Instant `labBeaconAfterFreeze(poolRoot)` is contrast only. `publicrpc` / `rpc1` rejected. keep-only `legacy-instant`. | Painting `ondemandLabBeaconAfterFreeze` as production CL RANDAO; gossip wait-hook (later **P20**); replacing P17 attest / P18 \(Q_V\); wipe; `pilotStartedAt` |
| **P20** | **landed (engine + daemon + tests).** Wait hooks are not intra-group gossip. `ingest` rejects `miners` / `hooks` / `hook` (`ERR_ONDEMAND_HOOK_NOT_GOSSIP`). Daemon must fan out to every active archive; one accept ≠ group pool. Lab HTTP `:27101` is **not** production DePIN gossip. | Turning HTTP hook into production DePIN gossip; forwarding miners on `/ondemand/message`; exposing hook on explorer nginx; wipe; `pilotStartedAt` |
| **P21** | **landed (engine + tests).** Lab BFT vote / QC / AC bind live/bound `hashIndexRoot` (after `membershipRoot`; `topicQcRef` encoding changes). Tree `committedInAc` stays false. Overlay `hashIndexCommittedInAc` when AC root ≠ `ZERO32`. keep-only skip QC/AC rebuild if certificate exists. | Flipping tree `committedInAc`; painting overlay as production AC commitment / 30-day; changing `membershipRootOf` / Mode A `valueHash`; wipe; `pilotStartedAt` |
| **P22** | **landed (engine + tests).** Official standby readiness = lab EIP-712 `ArchiveStandbyReadiness` (`string` `groupId`; seating key reused). Extra `fd-08` ingest-only, does **not** count. `POST /sync/standby-ready`. New-chain accept waits for two official standbys (`ERR_NEWCHAIN_STANDBY_NOT_READY`). Isolated `node.ts` wiring is **P24**. | Painting as production OperatorDomain / secp256k1 / 30-day; counting `fd-08`; changing Home green pills; wipe; `pilotStartedAt` |
| **P23** | **landed (live keep-deploy + evidence; honest 6/7).** `lab:deploy-g1-keep` on official G1. Six hosts `LIVE_OK` with P12–P22 overlay fields under `syncQualification`. fd-01 new-chain **409 → 200** (`ERR_NEWCHAIN_STANDBY_NOT_READY` then accept `0xe8229f16…81b472`). Official standby fd-06 HTTP unstable (event-loop starve; retry still no `LIVE_OK`). Extra `fd-08` unofficial. G2 BFT/ondemand off. | Claiming 7/7 healthy or durable `officialStandbysReady`; treating unit tests as the live proof; wipe; `pilotStartedAt`; promoting `fd-08`; forcing G2 voting; restarting EL/CL |
| **P24** | **landed (engine + tests).** Isolated `node.ts` new-chain accept uses the same `officialStandbysReady` callback as `lab-cli` `syncHolder`. No `sync.start()` / no inventory freeze. Extra `fd-08` still does not count. `runtime:test` **154/154**. | Production OperatorDomain; changing `archiveSeating.ts`; claiming 7/7 healthy; `sync.start()` against dummy peer URLs; `pilotStartedAt` |
| **P25** | **landed (Explorer overlay + tests + public SPA).** Certificates + Home **non-green** read-only overlays for `officialStandbysReady` / `hashIndexCommittedInAc` (`explorer/src/lib/labOverlays.ts`; `npm run explorer:test` 8/8). Public `dle.conet.network` now serves `index-DaEv6psZ.js` (2026-08-18T00:02:39Z). Live `/health` at publish: ready=false count=1, hash-index unbound. Green pills stay `seatingQualified === true` only. Missing overlay fields omit the chip. | Changing `archiveSeating.ts` seating logic; painting overlays as production AC / 30-day; flipping tree `committedInAc`; inventing P26 |

Parked (later tracks, not the next gate): IdentityEligible / OperatorDomain / \(U_e\); `PilotQualificationGate`; flipping tree `committedInAc`; production DePIN gossip; live CL RANDAO / production \(C_G\). Lab overlay `hashIndexCommittedInAc` is display-only (tree stays `committedInAc: false`; production AC commitment formula unchanged). Official standby readiness is **no longer parked**. 2026-08-17 review: `src/canvas/dle-mvp-milestone-assessment-2026-08-17.md`.

**Must not:** start `pilotStartedAt`; wipe keepers / `fd-05`; promote `fd-08` to an official 8th voter; live-inject a missing object; restart EL/CL.

### Other archive invariants

- `command: archive`, `runtime: nodejs`, `producesBlocks: false`, `hasTipVm: false`
- `eth_chainId` / `net_version` = **CoNET-DLE Testnet** EIP-155 id `0x44c45` / 281669 — unique versus CoNET L1 `224422` and Base `8453`. This is the plane chain id, **not** a group id. Never proxy L1 `publicrpc`.
- `dle_info.chainName` = `CoNET-DLE Testnet`
- Reject `eth_call` / `eth_getBalance` / writes
- Deploy: keep-data only (`lab:deploy-g1-keep` / `lab:deploy-archive-keep` / `lab:deploy-m6`). **`lab:deploy-archive-keep` 会重写 G1 `config.json` 且不带 `planeDirectory`** — 恢复 \(G_e=2\) 必须再跑 `lab:deploy-g1-keep`（只动 G1）或 `lab:deploy-m6`（会重启 G2）。Never restart geth / beacon / validator。停 archive 时若 SIGTERM 8s 后仍活（事件循环饿死），仅对 `dle-30d-lab` / `dle-m6-g2` 的 `lab-cli`/`agent` 补 SIGKILL；protect 命中 geth/beacon/validator 则 abort

---

## On-demand

See `src/shared/ondemand/RULES.md`. Waiting pool / SelectionLog is **not** \(G_e\). **P17 landed** on-demand attest EIP-712 `ArchiveOnDemandAttest` and did **not** replace the on-demand lab beacon. **P18 landed** P6 \(Q_V\) EIP-712 and did **not** replace the on-demand lab beacon or gossip wait-hook. **P19 landed** on-demand freeze-then-bind (honest-wait / injected view; **not** production CL RANDAO). **P20 landed** wait-hook honesty: hooks are not intra-group gossip; miner must POST every active archive; lab HTTP is **not** production DePIN gossip. **P21** binds `hashIndexRoot` into lab BFT and did **not** change on-demand. **P22** lands official standby readiness EIP-712 and did **not** change on-demand. **P25** lands Explorer overlays and did **not** change on-demand.

---

## Client

See `src/daemon/RULES.md`. Daemon must not treat `dle_tip.height` as cluster count. **P18 landed** P6 \(Q_V\) EIP-712 and did **not** change daemon hook / new-chain-user HTTP. **P19 landed** on-demand freeze-then-bind and did **not** change gossip wait-hook. **P20 landed** daemon fan-out honesty (`fanoutComplete` / `singleArchiveAcceptNotGroupPool`); new-chain-user HTTP still only `schema === 'DleLabValidatorQuorumV1'`. **P21** binds `hashIndexRoot` into lab BFT and did **not** change daemon hook / new-chain-user HTTP. **P22** lands official standby readiness EIP-712 (`lab-cli` + new-chain accept gate) and did **not** change daemon hook / new-chain-user HTTP. **P24** wires isolated `node.ts` to the same callback and did **not** change daemon hook / new-chain-user HTTP. **P25** lands Explorer overlays and did **not** change daemon hook / new-chain-user HTTP. Do not treat `challengeEip712` / `bftEip712` / `ondemandEip712` / `newchainValidatorQuorumEip712` / `ondemandLabBeaconAfterFreeze` / `ondemandHookNotGossip` / `hashIndexCommittedInAc` / `standbyReadyEip712` / `officialStandbysReady` / `newchainOfficialStandbysReady` / `productionCgAvailable` as production OperatorDomain / L1 wrapper / live CL RANDAO / 30-day qualification / \(C_G\) / production DePIN gossip / production AC commitment / production secp256k1.

Lab random-create user: `src/daemon/newchain-user-cli.ts` on `70.35.205.77:/home/peter/dle-newchain-user` (`npm run lab:deploy-newchain-user`). Genesis smoke is asset + storage + trade; then a `setTimeout` chain (15–45s) posts a random class. Do not mix this process with `dle-ondemand-clients`.
