# DLE Explorer programming rules

Read-only SPA for the isolated CoNET-DLE lab. Not Blockscout. Not a tip VM browser.

Public host: `https://dle.conet.network` (authorized). Do not invent extra `dle.*` hostnames.

After any Explorer programming or display-spec change, **update this file in the same task** (`conet-dle-write-back-subproject.mdc`).

## Home metrics (2026-08-16)

The first metric row is:

| Slot | Label | Value | Notes |
|---|---|---|---|
| 1 | Chain ID | `0x44c45` | **CoNET-DLE Testnet** EIP-155 `eth_chainId`. Hint = `CoNET-DLE Testnet`. **No** “Decimal 281,669. Not CoNET L1 224422.” Under the value: **Group ID** capsule = bootstrap L1 `registerTxHash` `0x3076a806…6f2ad0`. Click opens CoNET L1 Blockscout `/tx/{hash}` via `openExternalUrl`. Not `tip.hash`. |
| 2 | **Clusters** | `liveGroupCount` | Live archive groups \(G_e\). Genesis is **1**. After lab M6 fission = **2**. |
| 3 | Archives | roster length · 5+2 | Official voting roster only. P11 extra standby `fd-08-hosthatch-hk1` is **not** an 8th Home Archives node. |
| 4 | Archive Certificate | Available / Empty | Tip finality object. |

**Removed:** Home `Tip height` MetricCard. Archive Certificate height on NFT 42 is written to `0x1` after AC and does not grow. Showing it as a dashboard number is misleading.

**Kept:** the **Tip hash** capsule under the metric row (DLE `/hash/` lookup), not a height panel. That capsule is **not** the Chain ID L1 register tx.

### Chain ID + Group ID capsule

- **Value in the card:** CoNET-DLE Testnet EIP-155 hex (`0x44c45`). Hint: `CoNET-DLE Testnet`.
- **Capsule under it:** label **Group ID**; value = L1 bootstrap group register tx (`BOOTSTRAP_GROUP_REGISTER_TX_HASH` in `config/l1Routing.ts`), copied from the CoNET deploy snapshot. Do **not** `../..` import `deployments/`.
- **Click:** `https://mainnet.conet.network/tx/{hash}` through this subproject’s `openExternalUrl`. Copy writes the full 32-byte hash.
- **Not** lab decimal `281669`, **not** CoNET L1 chain id `224422` as hint text, **not** L1 storage uint `1`, **not** `dle_tip.hash` / AC `valueHash`.

### Clusters semantics

- **Clusters = \(G_e\)** = distinct live `groupId`s on the lab route table (including the genesis group).
- **No fission ⇒ 1.** Creating asset / storage / trade lab chains copies NFT 42’s Group ID (bootstrap register tx hash) and **must not** increment this number.
- A later fission that introduces a **new** Group ID increments \(G_e\) by 1. Production Group ID is that group’s L1 register tx hash. **Lab M6 + G2 L1 register + host cutover (2026-08-16):** hosts emit `0xf781f2c23fe3b3dac09dc3e1929016b0af200ee93978e916df64d750876d5153` as `hop1.ownGroupId` / `liveGroupIds`. `canonicalGroupId` still maps leftover laboratory keccak / `2` / `0x2` onto that tx. Show the canonical hash under Clusters **with** a Blockscout `/tx/` link. The Chain ID Group ID capsule stays the first-group bootstrap tx only.

Trusted fields (Explorer must not `../..` import runtime):

```text
GET /health          → liveGroupCount, liveGroupIds
GET /api/v2/dle      → same at top level and under archive
```

Parse only a trusted integer `>= 1`. Missing field, timeout, or non-2xx: keep last trusted value or default **1**. Never treat failure as `0` or empty.

**Legacy `/health` (unupgraded archives):** `parseLiveGroupIds` / `parseClusterCount` must run `canonicalGroupId` on each id **before** unique-count. `[dle.lab.group.v1]` and `[dle.lab.group.v1, 0x3076…]` are **one** cluster. Prefer unique canonical `liveGroupIds` over a raw `liveGroupCount` that double-counted aliases. `parseWaitingPool` / `parseSelectionLog` canonicalize `groupId`. `parseArchiveInfo` defaults missing `chainName` to `CoNET-DLE Testnet`. Copy `canonicalGroupId` / `sameGroupId` in `explorer/src/protocol.ts` — do **not** `../..` import runtime.

Home hint copy (English):

- `clusterCount <= 1` → `Genesis cluster — no fission yet`
- else → `N live archive groups after fission`

Implementation: `HomePage.tsx` MetricCard `Clusters`; `useArchiveFeed.ts` + `parseClusterCount` / `parseLiveGroupIds`; default `GENESIS_CLUSTER_COUNT = 1`.

## Hash lookup (2026-08-16 M7)

`/hash/:hash` pills must distinguish first-class kinds. A hit on `tipStateRoot` / `membershipRoot` shows **Tip state root** / **Membership root**, not Archive Certificate.

| `locator.kind` | Pill |
|---|---|
| `ac` | Archive Certificate |
| `prevoteQc` | Prevote QC |
| `tipStateRoot` | Tip state root |
| `membershipRoot` | Membership root |

Not-found copy: these roots are first-class kinds; a hit returns the typed object, not the AC. Do **not** `../..` import runtime kinds — copy the English labels in `HashLookupPage.tsx`.

## Certificates (2026-08-16 P6)

Certificates page may show laboratory **new-chain** counts from trusted `/health`:

| Field | Meaning |
|---|---|
| `newchainCount` | Accepted Mode A lab chains |
| `newchainArchivePending` | \(Q_V\) passed, per-chain AC not yet formed |
| `newchainArchiveCertified` | Per-`chainNftId` 4-of-5 AC present |
| `newchainValidatorQuorum` | Lab \(Q_V\) size (`5`) |
| `newchainValidatorQuorumEip712` | Lab \(Q_V\) uses EIP-712 `ArchiveValidatorQuorumAttest` (**P18**); **not** production |
| `newchainHmacForgeable` | `false` after P18 cutover; disk HMAC \(Q_V\) keep-only |
| `newchainOfficialStandbysReady` | Lab overlay: two official standbys signed EIP-712 readiness (**P22**); extra `fd-08` does **not** count |
| `newchainStandbyReadyEip712` | Lab new-chain accept gate uses EIP-712 readiness; **not** production OperatorDomain / 30-day |
| `warmupStartedAt` | Operator warmup stamp (ISO). Read-only. **Not** 30-day qualification |
| `pilotStartedAt` | Operator 30-day clock stamp (ISO). Live `2026-08-18T09:53:58.092Z`. **Not** qualification |
| `clockIsNotQualification` | Always treat as true for UI. Clock ≠ `PilotQualificationGate` |
| `pilotQualified` | Certificates JSON always shows `false` when any clock field is present. **Never** paint as qualified |

Home **Clusters** stays \(G_e\). A new-chain AC **must not** change NFT 42 tip / `eth_blockNumber`. New-chain AC is **not** an L1 birth certificate and **not** 30-day qualification. Failed health keeps last trusted snapshot. SelectionLog attests on this page are lab EIP-712 `ArchiveOnDemandAttest` (**P17**); do **not** paint them as HMAC or as 30-day qualification. The on-demand lab beacon is freeze-then-bind lab keccak (**P19**), **not** production CL RANDAO. Do **not** paint `ondemandLabBeaconAfterFreeze` as live RANDAO. Wait hooks are **not** intra-group gossip (**P20**); lab HTTP is **not** production DePIN gossip. Do **not** paint `ondemandHookNotGossip` as production gossip. New-chain \(Q_V\) on this page is lab EIP-712 `ArchiveValidatorQuorumAttest` (**P18**); do **not** paint `newchainValidatorQuorumEip712` as production. **P22** may expose `newchainOfficialStandbysReady` / `newchainStandbyReadyEip712` on `/health`; do **not** paint them as seating, production OperatorDomain, or the 30-day gate. Extra `fd-08` does **not** count. Do **not** change `archiveSeating.ts`.

## Seating vs reachability (2026-08-16)

Whitepaper §5.2.0f / runtime `RULES.md` §ArchiveSyncQualificationV1.

`GET /health` alive, `lastQuorumOk`, `lastPeerOk`, and heartbeats prove **reachability only**. Explorer **MUST NOT** label a host as seating-qualified / `SyncQualified` / “caught up” from those fields.

Laboratory `ArchiveStateChallengeV1` **is implemented**. Merge `health.syncQualification` + `health.syncRoster`. A **green** seating pill is allowed **only** when `seatingQualified === true`. Sync phase labels use `SYNCING` / `CLAIMED_SYNC` / `STATE_CHALLENGE` / `QUALIFIED` / `REJECTED`. Home **Seating** gauge uses that same boolean; **Quorum** remains heartbeat / BFT AC reachability. Do **not** call HTTP liveness “archive qualification”. Prefer `GET /liveness` for process-up; full `/health` includes `sync.health()` and must not be the deploy probe. Green pills on a **split** `hashIndexRoot` / `lastACRef` are not a seated group — compare the four roots before treating the row as wipe-safe. Lab **P9 landed (2026-08-17):** every hosted `chainNftId` (`health.labCgOpening === 'all-hosted'`; unique opening **2103**). That is **not** the production 30-day \(C_G\) open. Do **not** scrape `/sync/opening` or rebuild challenges from Explorer. This is **not** the 30-day `PilotQualificationGate`.

**P8c landed:** `/health` no longer rebuilds `pendingChallenge`. Explorer still scrapes `/health` for `syncQualification.phase` / `seatingQualified` + `syncRoster` only — do **not** add a second seating poll or read `pendingChallenge` from health. Green pills on a **split** `hashIndexRoot` / `lastACRef` are not wipe-safe. **P8d landed:** random wipe fd-05+fd-06; join-window leaf stayed 5194; no `ERR_SYNC_CHALLENGE_STALE`. **P10 landed:** `/health` may also expose `hasUnseatedActive` / `alignedQualifiedCount` (read-only). Do **not** scrape `/sync/opening` for P10. A `REJECTED` **active** is unseated — do not paint it green. Do **not** treat a voter-missing reject as a candidate fault. **P11 landed:** extra joiner `fd-08` is outside official 5+2 — Home Archives stays 7. Do not paint an 8th voting seat. Live accept `2026-08-17T07:52:17Z`: joiner `QUALIFIED`, official seven still `QUALIFIED`. **P12 landed:** seating votes are lab EIP-712; do **not** paint `seatingEip712` as production. Green pills stay `seatingQualified === true` only. **P13 landed:** challenge freeze-then-bind is lab-labeled (`labBeaconAfterFreeze` / `notProductionBeacon`). Do **not** paint those flags as production CL RANDAO. **P14 landed:** lab freezer hosted-set / `labCgOpening` is **not** production \(C_G\). Do **not** paint `productionCgAvailable` or an injected L1 small-set as a live L1 full scan. **P15 landed:** challenge / opening are lab EIP-712 (`challengeEip712`). Do **not** paint `challengeEip712` as production. **P16 landed:** BFT AC votes are lab EIP-712 `ArchiveBftVote` (`bftEip712`). Do **not** paint `bftEip712` as a frozen L1 wrapper or corpus SSZ. **P17 landed:** on-demand attests are lab EIP-712 `ArchiveOnDemandAttest` (`ondemandEip712`). Do **not** paint `ondemandEip712` / `endorsed` as 30-day qualification or a production beacon. The on-demand lab beacon was keccak after freeze at P17. **P18 landed:** new-chain \(Q_V\) is lab EIP-712 `ArchiveValidatorQuorumAttest` (`newchainValidatorQuorumEip712`). Do **not** paint `newchainValidatorQuorumEip712` as production secp256k1 or 30-day qualification. **P19 landed:** on-demand beacon is freeze-then-bind lab keccak (`ondemandLabBeaconAfterFreeze`). Do **not** paint it as live CL RANDAO. **P20 landed:** wait hooks are not intra-group gossip (`ondemandHookNotGossip`). Do **not** paint lab HTTP hook as production DePIN gossip. **P21 landed:** certificate may expose `hashIndexRoot`; overlay `hashIndexCommittedInAc` is lab display when AC root ≠ `ZERO32`. Tree views stay `committedInAc: false`. Do **not** paint overlay as production AC commitment or the 30-day gate. **P22 landed:** `/health` may expose `standbyReadyEip712` / `officialStandbysReady` / `newchainOfficialStandbysReady` / `newchainStandbyReadyEip712`. Extra `fd-08` does **not** count. Do **not** paint those as seating, production OperatorDomain, or the 30-day gate. Do **not** change `archiveSeating.ts`. Green pills stay `seatingQualified === true` only.

## After P11 (Home display)

Official Home **Archives** stays the 7-domain roster. Extra joiner `fd-08` is not an 8th Archives node. **P12 landed:** seating votes are lab EIP-712. Green seating pill remains `seatingQualified === true` only. Do **not** paint `seatingEip712` / `notL1Settled` as production OperatorDomain or L1 settle. **P13 landed:** freeze-then-bind lab beacon is honest-labeled. Do **not** paint `labBeaconAfterFreeze` / `notProductionBeacon` as live CL RANDAO. **P15 landed:** challenge / opening are lab EIP-712. Do **not** paint `challengeEip712` as production. **P16 landed:** BFT AC votes are lab EIP-712 `ArchiveBftVote`. Do **not** paint `bftEip712` as a frozen L1 wrapper or corpus SSZ. **P17 landed:** on-demand attests are lab EIP-712 `ArchiveOnDemandAttest` (`ondemandEip712`). Do **not** paint `ondemandEip712` / `endorsed` as 30-day qualification or a production beacon. The on-demand lab beacon was keccak after freeze at P17. **P18 landed:** new-chain \(Q_V\) is lab EIP-712 `ArchiveValidatorQuorumAttest` (`newchainValidatorQuorumEip712`). Do **not** paint `newchainValidatorQuorumEip712` as production secp256k1 or 30-day qualification. **P19 landed:** on-demand beacon is freeze-then-bind lab keccak. Do **not** paint `ondemandLabBeaconAfterFreeze` as live CL RANDAO. **P20 landed:** wait hooks are not intra-group gossip. Do **not** paint `ondemandHookNotGossip` as production DePIN gossip. **P21 landed:** certificate may expose `hashIndexRoot`; overlay `hashIndexCommittedInAc` is lab display. Do **not** paint overlay as production AC commitment or the 30-day gate. **P22 landed:** `/health` may expose `standbyReadyEip712` / `officialStandbysReady` / `newchainOfficialStandbysReady`. Extra `fd-08` does **not** count. Do **not** paint those as seating or the 30-day gate. Do **not** change `archiveSeating.ts`. Green seating pills stay `seatingQualified === true` only. **P14 landed:** do **not** paint lab 2249 / `labCgOpening` / `productionCgAvailable` / an injected small-set as production \(C_G\). Completing those gates **MUST NOT** be shown as 30-day qualification. **P23 landed (2026-08-17; honest 6/7):** keep-data deploy of P12–P22 to official G1. Six hosts `LIVE_OK` with overlay fields under `syncQualification`. fd-01 new-chain 409→accept. fd-06 HTTP unstable. Do **not** claim 7/7 healthy or durable `officialStandbysReady`. Green pills stay `seatingQualified === true` only. **P24 landed:** isolated `node.ts` new-chain accept uses the same `officialStandbysReady` callback as `lab-cli`. **P25 landed:** Certificates + Home show **non-green** read-only overlays for `officialStandbysReady` / `hashIndexCommittedInAc` (`src/lib/labOverlays.ts`; parent `npm run explorer:test` 8/8). Green pills stay `seatingQualified === true` only. Missing overlay fields omit the chip. **Public SPA published (2026-08-18T00:18:49Z):** `https://dle.conet.network/` serves `index-U1o9ul_I.js` (replaced stale `index-DaEv6psZ.js`). Live `/health` at publish still `officialStandbysReady=false` (`count=1`), `hashIndexCommittedInAc=false` — chips are warn/neutral, **not** green ready. **P25 seating-copy honesty (same gate, not P26):** Home Seating gauge + archive detail say **lab EIP-712**, never **lab HMAC** (`src/lib/labSeatingCopy.ts`). Deploy from parent-repo `scripts/deployDleExplorer.sh` (not this subproject). **fd-06 remapped (2026-08-18, not P26):** official standby seat keep-data on Explorer host `70.35.205.77` (`~/dle-30d-lab` :27101; `domainId` + wallet stay). Leftover `216.225.193.174` is excluded. Do **not** add `70.35.205.77:27101` to Explorer nginx upstream (standby is not an upstream; this is the Explorer host). Do **not** stop nginx / on-demand / newchain-user when starting the fd-06 DLE. **Scrape 2026-08-18T00:52Z:** honest **7/7** `GET :27101/liveness`; fd-01 `/health` still `officialStandbysReady=false` (`count=1`; ready is not sticky). **Fan-out 2026-08-18T00:57Z:** official standby envelopes POSTed to 7× `/sync/standby-ready` (200); six seats flickered `ready=true` then dropped as inventory grew (`leafCount` 9141→9145). **Peer-stale 2026-08-18T01:03Z:** fd-01 / fd-07 still pointed fd-06 at leftover `.174`. **Peer-refresh 2026-08-18T01:10Z:** `lab:keep-refresh-fd06-peers` ok; all official configs now `http://70.35.205.77:27101`. Seven-seat `ready=true` flickered at 01:12:01Z then dropped as roots drifted. **Split 2026-08-18T07:05Z / 07:08Z:** honest **7/7** LIVE_OK; two official standbys on **different four roots** (fd-06 camp A vs fd-07 camp B, +1 leaf race). Envelope POST cannot make `count=2`. **08:01Z flicker** 6/7 then drop in 21s. **Operator authorized inventory freeze** via `lab:keep-freeze-inventory` / `POST /sync/inventory-freeze`. Engine + tests: `runtime:test` **157/157**; `pilot` **14/14**; `explorer:test` **8/8**. **Live freeze 2026-08-18T08:35Z:** official 7 + extra fd-08 `inventoryFrozen=true` `reason=operator`; honest **7/7** LIVE_OK; `officialStandbysReady=true` count=2; leaf **9750**; `pilotStartedAt=null`. Evidence: `pilot/evidence/conet-dle-p23-live-2026-08/operator-inventory-freeze.json`. Explorer nginx must **not** expose `POST /sync/inventory-freeze` or `POST /sync/pilot-clock`. `/health` may show `warmupStartedAt` / `pilotStartedAt` / `clockIsNotQualification`. Do **not** paint those as 30-day qualification. Do **not** add a green clock chip. Green seating pill remains `seatingQualified === true` only. Do **not** add `.77:27101` to nginx. **Operator authorized clock start** via `npm run lab:start-pilot-clock`. **Live clock 2026-08-18T09:53:58.092Z** (`warmupStartedAt=2026-08-14T17:10:16.786Z`; `pilotQualified=false`; `clockIsNotQualification=true`). Clock ≠ qualification. **Explorer clock overlay (2026-08-18, not P26):** Certificates + Home show a **non-green** `pilotClockPill` from `/health.pilotRunning` (else derive from `pilotStartedAt`). Running → warn `30-day clock running (not qualified)`; explicit null / not started → neutral `30-day clock not started`; missing fields omit the chip. `pilotQualified: true` is ignored. Never `tone: 'ok'`. Green seating pill remains `seatingQualified === true` only. Tests: `npm run explorer:test` **10/10**. **Public SPA published (2026-08-18T10:15:00Z):** `https://dle.conet.network/` now serves `index-C8IdTq4H.js` (replaced pre-clock `index-U1o9ul_I.js`). Live `/health`: `pilotRunning=true`, `pilotStartedAt=2026-08-18T09:53:58.092Z`, `pilotQualified=false`, `clockIsNotQualification=true`. Clock chip is warn, **not** green qualified. Do **not** change `archiveSeating.ts`. Do **not** paint overlays as production AC / 30-day. Do **not** invent P26. **Runtime scrape 2026-08-18T23:41Z (~13.8h):** 8/8 HTTP + clock-aligned + seating `QUALIFIED`; `pilotQualified` false; `lastQuorumOk` 6/8 (fd-07 `peer=0`); omitted leaf/ready/AC roots ≠ zero/empty. Evidence: `pilot/evidence/conet-dle-p23-live-2026-08/runtime-review-2026-08-18T2341Z.json`. Reviews: parent `src/canvas/dle-mvp-runtime-review-2026-08-18.md` · `dle-mvp-work-review-2026-08-18.md`.

## Mock auction page (`/mock-auction`, 2026-08)

Detail page (footer hidden). Local mock-L1 `/mockl1/*` + `/trade/*` against the configured archive endpoint. Home links with a warn pill **Mock auction (local)**.

**MVP round 2:** session-only lab private keys may **sign** sell/buy/attest in the browser (`ethers`); keys are **never** written to localStorage / IndexedDB. Order / candidate hashing is mirrored in `explorer/src/lib/mockAuctionWire.ts` (no runtime import). Archive legality remains Archive-side when RPC custody is configured — the page may pass lab flags only for Archive without `MOCK_L1_*`.

**MVP round 3:** when Archive has on-chain settle configured, match timeline may show a **real** `settlementTxHash` from `MockDleAuctionSettlement.settle` (local Hardhat/Anvil). Do **not** paint lab demo fake hashes as mainnet settles.

**MVP round 4:** `/mock-auction` shows a **Settlement summary** (phase pills + `HashCapsule` for `settlementTxHash`) and may **POST** `/trade/settle` with `executeOnChain` so Archive runs authority `settle`. The browser **never** holds `certificateAuthority` / `MOCK_L1_AUTHORITY_PRIVATE_KEY`. Health pills may show `custody:` / `settle:` from `/health` (`tradeRpcCustodyMode`, `tradeOnChainSettleConfigured`).

**MVP round 5:** `/mock-auction` may **POST** `/trade/list` with the seller **session** private key (must match sell maker; never persisted) so Archive runs `list` into escrow. Settlement summary shows `listTxHash` / `listError`. Health pill `list:` from `tradeListConfigured` / `tradeListMode`. List **before** Archive settle when on-chain settle is enabled.

**MVP round 6:** `/mock-auction` may **POST** `/trade/approve` with the buyer **session** private key (must match buy maker; never persisted) so Archive runs ERC-20 `approve` for the quote. Settlement summary shows `approveTxHash` / `approveError`. Health pill `approve:` from `tradeApproveConfigured` / `tradeApproveMode`. Prefer list → approve → Archive settle.

| Rule | Detail |
|---|---|
| Scope | Local Hardhat/Anvil mock network only |
| UI | May sign client orders/attests/list/approve with session keys; may ask Archive to settle via HTTP; does **not** self-claim Archive legality / quorum; does **not** hold authority key or broadcast settle txs |
| Labels | Always show `mockL1Only` / `notProductionDepin` pills; custody/list/approve/settle mode from health when trusted |
| Forbidden | Painting as CoNET mainnet, production DePIN, or live CL RANDAO; persisting private keys; treating demo fake hashes as on-chain settles |

## Other Explorer invariants

- Official G1 nginx upstream (parent-repo `scripts/nginx-dle.conet.network.conf`): `45.132.74.220:27101`, `45.132.74.221:27101`, `167.254.243.38:27101`, `170.205.39.67:27101`. **Never** proxy excluded IONOS `74.208.224.45` or `198.251.77.98`. Do not proxy shared-beacon `216.225.197.189`, leftover `216.225.193.174`, or standby `212.227.242.207`. Do **not** add Explorer host `70.35.205.77:27101` (fd-06 standby is colocated there). Do **not** expose `POST /sync/inventory-freeze` or `POST /sync/pilot-clock` on Explorer nginx.
- No top navigation bar. Main pages: title capsule. Detail: circular back button. Tabs in the footer.
- Refresh: `setTimeout` chain only. No `setInterval`.
- Failed fetches keep the last trusted snapshot (`beamio-trusted-vs-untrusted-fetch.mdc`).
- User-visible strings: English.
- Independent `package.json`. Do not import `runtime`, `archive-a`, or `archive-b`.
- Cache only archive URL + last trusted snapshot. No wallet keys on disk. Session keys on `/mock-auction` are memory-only and cleared on reload.

## Related

- Archive API: `../runtime/RULES.md` §Archive (`liveGroupCount`) and §ArchiveSyncQualificationV1（`/health` ≠ seating）
- Client: `../runtime/src/daemon/RULES.md`
- On-demand (not Clusters): `../runtime/src/shared/ondemand/RULES.md`
