# CoNET-DLE Explorer

Read-only explorer for **CoNET-DLE** archive events, 5+2 node identity, Archive Certificates, and the lab on-demand waiting pool / 7+2 SelectionLog.

**Programming rules (update in the same task as code/spec changes):** [`RULES.md`](./RULES.md).

This is **not** an L1 Blockscout clone and **not** an `eth_call` browser.

| DLE | L1 Blockscout |
| --- | --- |
| CoNET-DLE Testnet EIP-155 `0x44c45` (281669) | CoNET L1 `224422` |
| Tip finality = Archive Certificate (PrecommitQC) | Blocks / execution receipts |
| Archive nodes **do not produce blocks** | Full nodes produce and execute |
| No tip VM — `eth_call` is rejected | EVM browser |

Public hostname (user-authorized): **`https://dle.conet.network`** on `70.35.205.77`.
The SPA is same-origin; nginx proxies `/health`, `/rpc`, `/api/v2/dle`, and read-only `/ondemand/pool` + `/ondemand/selection` to lab archives on TCP **27101**. It does **not** expose `POST /ondemand/hook` or freeze.
Do **not** invent additional hostnames, and do **not** write this URL into Solidity constants.

The UI uses a dark neon glass theme and the DLE mark in `explorer/public/dle-mark.png`. Events are listed **newest first**. There is no top navigation bar — main pages use a title capsule, detail pages use a circular back button, and section tabs stay in the footer.

**Mock auction (local):** `/mock-auction` is a detail page for the mock-L1 EventIngress / match / certificate / settlement timeline. **MVP round 2:** the page may sign sell/buy/attest with **session-only** lab keys (memory; never localStorage). Hash helpers live in `explorer/src/lib/mockAuctionWire.ts` (no runtime import). It is **not** CoNET mainnet and **not** production DePIN. Archive legality stays Archive-side when `MOCK_L1_*` RPC custody is configured. Use the Home pill **Mock auction (local)** or navigate directly.

## Run locally

From `src/conet-layer2` (install explorer deps once):

```bash
npm --prefix explorer install

# Terminal 1 — Node.js archive (does not produce blocks)
npm run archive -- --port 27101 --data-dir ./data/dle-archive

# Terminal 2 — explorer
npm run explorer:dev
```

Open `http://127.0.0.1:27121/`. The UI defaults to `http://127.0.0.1:27101` (`GET /health`, `POST /rpc`, `GET /api/v2/dle`).

Vite also proxies `/archive/*` to that port if you set the endpoint to `http://127.0.0.1:27121/archive`.

Build / public deploy:

```bash
# from this subproject
npm run explorer:build

# from BeamioContract repo root (script is not in this subproject)
./scripts/deployDleExplorer.sh
```

The public UI defaults to `https://dle.conet.network` (same origin). Local default remains `http://127.0.0.1:27101`.
Public nginx also exposes `GET /ondemand/pool` and `GET /ondemand/selection`.

## Lab hosts

The seven-domain roster (5 active + 2 standby) is bundled as a **fixture**. Point the Home endpoint at `http://<lab-host>:27101` to merge live `/health` fields (`lastQuorumOk`, `lastPeerOk`, `heartbeats`) onto the matching `domainId`.

This explorer does **not** claim 30-day qualification. Heartbeat quorum on 27101 is not BFT and is **not** seating (`ArchiveSyncQualificationV1`). A live `/health` overlay **must not** be shown as “caught up” or seating-qualified. A lab networked 4-of-5 AC may appear on Certificates (**P16** votes are lab EIP-712 `ArchiveBftVote`; keep-only disk HMAC certificates may still restore tip finality). It is **not** a frozen EIP-712 L1 wrapper or corpus SSZ object. After P11, Home Archives stays **7**. **P12 landed:** seating votes are lab EIP-712; the green pill is still `seatingQualified === true` only. Do **not** render `seatingEip712` as production. **P13 landed:** do **not** render `labBeaconAfterFreeze` as production CL RANDAO. **P15 landed:** challenge / opening are lab EIP-712; do **not** render `challengeEip712` as production. **P16 landed:** BFT AC votes are lab EIP-712; do **not** render `bftEip712` as production. **P17 landed:** on-demand attests are lab EIP-712 `ArchiveOnDemandAttest`; do **not** render `ondemandEip712` / `endorsed` as 30-day qualification. The on-demand lab beacon was keccak after freeze at P17. **P18 landed:** new-chain \(Q_V\) is lab EIP-712 `ArchiveValidatorQuorumAttest`; do **not** render `newchainValidatorQuorumEip712` as production. **P19 landed:** on-demand beacon is freeze-then-bind lab keccak; do **not** render `ondemandLabBeaconAfterFreeze` as production CL RANDAO. **P20 landed:** wait hooks are not intra-group gossip; do **not** render lab HTTP hook as production DePIN gossip. **P21 landed:** certificate may expose `hashIndexRoot`; overlay `hashIndexCommittedInAc` is lab display when AC root ≠ `ZERO32`. Tree views stay `committedInAc: false`. Do **not** render overlay as production AC commitment or the 30-day gate. **P22 landed:** `/health` may expose `standbyReadyEip712` / `officialStandbysReady` / `newchainOfficialStandbysReady` / `newchainStandbyReadyEip712`. Extra `fd-08` does **not** count. Do **not** render those as seating, production OperatorDomain, or the 30-day gate. Green seating pills stay `seatingQualified === true` only. **P14 landed:** do **not** render lab 2249 / `labCgOpening` / `productionCgAvailable` / an injected small-set as production \(C_G\). **P23 landed (2026-08-17; honest 6/7):** keep-data deploy of P12–P22 to official G1. Six hosts `LIVE_OK` with overlay fields under `syncQualification`. fd-01 new-chain 409→accept. fd-06 HTTP unstable. Do **not** claim 7/7 healthy or durable `officialStandbysReady`. Green pills stay `seatingQualified === true` only. **P24 landed:** isolated `node.ts` new-chain accept uses the same `officialStandbysReady` callback as `lab-cli`. **P25 landed:** Certificates + Home show **non-green** read-only overlays for `officialStandbysReady` / `hashIndexCommittedInAc` (`src/lib/labOverlays.ts`; parent `npm run explorer:test` 8/8). Green pills stay `seatingQualified === true` only. Missing overlay fields omit the chip. **P25 seating-copy honesty (same gate, not P26):** Home Seating gauge + archive detail say **lab EIP-712**, never **lab HMAC** (`src/lib/labSeatingCopy.ts`). **Public SPA published (2026-08-18T00:18:49Z):** `https://dle.conet.network/` serves `index-U1o9ul_I.js`. Live `/health` at publish still `officialStandbysReady=false` (`count=1`), `hashIndexCommittedInAc=false` — chips are warn/neutral, **not** green ready. **fd-06 remapped (2026-08-18, not P26):** official standby seat keep-data on Explorer host `70.35.205.77` (`~/dle-30d-lab` :27101). Leftover `216.225.193.174` excluded. Do **not** add `.77:27101` to nginx upstream. Do **not** stop nginx / on-demand / newchain-user. Completing this remap **MUST NOT** start `pilotStartedAt`. **Scrape 2026-08-18T00:52Z:** honest **7/7** `GET :27101/liveness`; `officialStandbysReady` still false (`count=1`, not sticky). **Fan-out 2026-08-18T00:57Z:** official standby envelopes POSTed to 7× `/sync/standby-ready` (200); six seats flickered `ready=true` then dropped as inventory grew. **Peer-stale 2026-08-18T01:03Z:** official peers still gossiped fd-06 to leftover `.174`. **Peer-refresh 2026-08-18T01:10Z:** `lab:keep-refresh-fd06-peers` ok; official configs now `http://70.35.205.77:27101`. Seven-seat `ready=true` flickered at 01:12:01Z then dropped as roots drifted. **Split 2026-08-18T07:05Z / 07:08Z:** honest **7/7** LIVE_OK; two official standbys on **different four roots** (fd-06 camp A vs fd-07 camp B). Envelope POST cannot make `count=2`. **08:01Z flicker** 6/7 then drop in 21s. **Operator authorized inventory freeze** via `lab:keep-freeze-inventory` / `POST /sync/inventory-freeze`. Engine + tests: `runtime:test` **157/157**; `pilot` **14/14**; `explorer:test` **8/8**. **Live freeze 2026-08-18T08:35Z:** official 7 + extra fd-08 `inventoryFrozen=true` `reason=operator`; honest **7/7** LIVE_OK; `officialStandbysReady=true` count=2; leaf **9750**; `pilotStartedAt=null`. Evidence: `pilot/evidence/conet-dle-p23-live-2026-08/operator-inventory-freeze.json`. Explorer nginx must **not** expose `POST /sync/inventory-freeze` or `POST /sync/pilot-clock`. `/health` may show `warmupStartedAt` / `pilotStartedAt` / `clockIsNotQualification`. Do **not** paint those as 30-day qualification. Do **not** add a green clock chip. Green seating pill remains `seatingQualified === true` only. **Operator authorized clock start** via `npm run lab:start-pilot-clock`. **Live clock 2026-08-18T09:53:58.092Z** (`warmupStartedAt=2026-08-14T17:10:16.786Z`; `pilotQualified=false`; `clockIsNotQualification=true`). Clock ≠ qualification. **Explorer clock overlay (2026-08-18, not P26):** Home + Certificates show a **non-green** clock chip (`30-day clock running (not qualified)` / `30-day clock not started`). Missing `/health` clock fields omit the chip. `pilotQualified` stays false in Certificates JSON. Never a green clock chip. Tests: `npm run explorer:test` **10/10**. **Public SPA published (2026-08-18T10:15:00Z):** `https://dle.conet.network/` now serves `index-C8IdTq4H.js` (replaced pre-clock `index-U1o9ul_I.js`). Live `/health`: `pilotRunning=true`, `pilotStartedAt=2026-08-18T09:53:58.092Z`, `pilotQualified=false`. Clock chip is warn, **not** green qualified. Do **not** change `archiveSeating.ts`. Do **not** paint overlays as production AC / 30-day. Do **not** invent P26. **Runtime scrape 2026-08-18T23:41Z (~13.8h into clock):** 8/8 HTTP OK + clock-aligned + seating `QUALIFIED`; `pilotQualified` still false; `lastQuorumOk` **6/8** (fd-02 false peer=5; fd-07 false **peer=0**); this scrape omitted `leafCount` / `officialStandbysReady` / AC roots on all eight — **missing fields ≠ 0 / empty inventory**. Evidence: `pilot/evidence/conet-dle-p23-live-2026-08/runtime-review-2026-08-18T2341Z.json`. Reviews: `src/canvas/dle-mvp-runtime-review-2026-08-18.md` (runtime) · `src/canvas/dle-mvp-work-review-2026-08-18.md` (control plane).

## What it shows

1. **Home** — Chain ID (`0x44c45`, hint **CoNET-DLE Testnet**) with a **Group ID** capsule (bootstrap L1 register tx; click opens CoNET Blockscout `/tx/…`; not the decimal / “Not L1 224422” hint), **Clusters** (unique canonical `liveGroupIds` / \(G_e\); genesis and no fission = **1**; lab M6 fission = **2**; second Group ID is the G2 L1 register tx `0xf781f2c2…876d5153` and **does** open Blockscout `/tx/`; laboratory keccak / uint `2` alias that tx; legacy `dle.lab.group.v1` aliases the first-group hash and must not count as a second group; **not** Tip height), archive count, 5+2 roles, AC / finalized, waiting pool, 7+2 SelectionLog (`poolRoot` / committee / standbys / endorsed), `producesBlocks=false`, no tip VM. Tip **hash** stays under the metric row (DLE lookup). Programming rules: [`RULES.md`](./RULES.md).
2. **Events** — WAL / heartbeat / rpc / lab-start / ondemand-* rows from `/api/v2/dle/events`, or last trusted / demo fixture.
3. **Archives** — seven-domain identity and live health overlay. **`fd-01-ionos-45` stays live** on `45.132.74.220` (nginx upstream). **`fd-03-ionos-98` stays live** on `45.132.74.221` (nginx upstream). **`fd-06-ionos-174` stays live** on `70.35.205.77` (official standby; **not** nginx upstream). Do **not** proxy excluded `74.208.224.45`, `198.251.77.98`, leftover `216.225.193.174`, or Explorer-host `:27101`. Green seating pill **only** when `seatingQualified === true` (lab `ArchiveStateChallengeV1`; P12 seating votes, P15 challenge / opening, and P16 BFT AC votes are EIP-712; P13 lab beacon is freeze-then-bind and **not** live CL RANDAO; P14 lab hosted-set / injected \(C_G\) smoke is **not** production \(C_G\)). Heartbeat `lastQuorumOk` is reachability, not seating. From-zero join lab: wipe only wipe-safe G1 joiners (`fd-05` / `fd-06` / `fd-07`) `~/dle-30d-lab/data`; never keepers. Live keepers `fd-01..04` must share the same four inventory roots, not just green pills. **P8c:** `/health` is a slim seating overlay (no `pendingChallenge` rebuild). Do not add a second seating poll. **P8d landed:** random fd-05+fd-06, leaf stayed 5194.
4. **Certificates** — lab networked 4-of-5 PrecommitQC **and** the on-demand SelectionLog. They are different objects. AC is tip finality (P16 lab EIP-712 `ArchiveBftVote`; **P21** may show `certificate.hashIndexRoot` / overlay `hashIndexCommittedInAc` when the bound root is non-zero — **not** production AC commitment; **not** a frozen L1 wrapper). SelectionLog is the recomputable 7+2 draw (P17 lab EIP-712 `ArchiveOnDemandAttest`; P19 beacon is freeze-then-bind lab keccak, **not** live CL RANDAO; P20 hooks are not gossip). P6 also shows new-chain \(Q_V\) / pending / certified counts from `/health` (per-`chainNftId` AC, never NFT 42). Live \(Q_V\) is lab EIP-712 `ArchiveValidatorQuorumAttest` (**P18**); **not** production. **P22 / P25** may show `newchainOfficialStandbysReady` / `newchainStandbyReadyEip712` / `officialStandbysReady` / `hashIndexCommittedInAc` as **non-green** chips — extra `fd-08` does **not** count; **not** seating; **not** production OperatorDomain / AC commitment / 30-day. Clock fields (`warmupStartedAt` / `pilotStartedAt` / `clockIsNotQualification` / `pilotQualified`) are read-only; the clock chip is warn/neutral only and **not** 30-day qualification.
5. **Hash lookup** — `/hash/:hash`. Lab M7 pills: **Tip state root** / **Membership root** for first-class kinds; a hit returns the typed object, not the Archive Certificate.
6. **JSON-RPC** — ethers-shaped read facade (`eth_chainId`, `net_version`, synthetic tip block) plus `dle_*` including `dle_getWaitingPool` / `dle_getSelectionLog`; explicit rejection of `eth_call` / `eth_getBalance` / writes. Isolated from L1 `publicrpc`.

First paint seeds the 2026-08-15 lab accept (`poolRoot=0x1a0895b0…8def74`, 7+2, 5 active attests, `endorsed=true`; historical HMAC snapshot). A trusted live `/ondemand/pool` + `/ondemand/selection` (or `/api/v2/dle`) overwrites that snapshot. Failed fetches keep the last trusted values. Lab beacon is freeze-then-bind lab keccak (**P19**), **not** CoNET L1 CL RANDAO. Instant `labBeaconAfterFreeze(poolRoot)` is contrast-only. Live attests are EIP-712 `ArchiveOnDemandAttest` (**P17**). Wait hooks are not intra-group gossip (**P20**); lab HTTP is **not** production DePIN gossip. SelectionLog is **not** an Archive Certificate and **not** 30-day qualification. Do **not** paint `ondemandEip712` / `ondemandHookNotGossip` as production.

Refresh uses a `setTimeout` chain. Failed fetches keep the last trusted snapshot and never treat an untrusted empty body as “no data”.

## Boundaries

- Independent `package.json` — do not `../..` import `runtime`, `archive-a`, or `archive-b`.
- No wallet SDK and no Local Storage private keys. Only the archive URL and last trusted explorer snapshot are cached.
- User-visible copy is English.
