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
npm run explorer:build
./scripts/deployDleExplorer.sh
```

The public UI defaults to `https://dle.conet.network` (same origin). Local default remains `http://127.0.0.1:27101`.
Public nginx also exposes `GET /ondemand/pool` and `GET /ondemand/selection`.

## Lab hosts

The seven-domain roster (5 active + 2 standby) is bundled as a **fixture**. Point the Home endpoint at `http://<lab-host>:27101` to merge live `/health` fields (`lastQuorumOk`, `lastPeerOk`, `heartbeats`) onto the matching `domainId`.

This explorer does **not** claim 30-day qualification. Heartbeat quorum on 27101 is not BFT and is **not** seating (`ArchiveSyncQualificationV1`). A live `/health` overlay **must not** be shown as “caught up” or seating-qualified. A lab networked 4-of-5 AC may appear on Certificates (**P16** votes are lab EIP-712 `ArchiveBftVote`; keep-only disk HMAC certificates may still restore tip finality). It is **not** a frozen EIP-712 L1 wrapper or corpus SSZ object. After P11, Home Archives stays **7**. **P12 landed:** seating votes are lab EIP-712; the green pill is still `seatingQualified === true` only. Do **not** render `seatingEip712` as production. **P13 landed:** do **not** render `labBeaconAfterFreeze` as production CL RANDAO. **P15 landed:** challenge / opening are lab EIP-712; do **not** render `challengeEip712` as production. **P16 landed:** BFT AC votes are lab EIP-712; do **not** render `bftEip712` as production. **P17 landed:** on-demand attests are lab EIP-712 `ArchiveOnDemandAttest`; do **not** render `ondemandEip712` / `endorsed` as 30-day qualification. The on-demand lab beacon was keccak after freeze at P17. **P18 landed:** new-chain \(Q_V\) is lab EIP-712 `ArchiveValidatorQuorumAttest`; do **not** render `newchainValidatorQuorumEip712` as production. **P19 landed:** on-demand beacon is freeze-then-bind lab keccak; do **not** render `ondemandLabBeaconAfterFreeze` as production CL RANDAO. **P20 landed:** wait hooks are not intra-group gossip; do **not** render lab HTTP hook as production DePIN gossip. **P21 landed:** certificate may expose `hashIndexRoot`; overlay `hashIndexCommittedInAc` is lab display when AC root ≠ `ZERO32`. Tree views stay `committedInAc: false`. Do **not** render overlay as production AC commitment or the 30-day gate. **P22 landed:** `/health` may expose `standbyReadyEip712` / `officialStandbysReady` / `newchainOfficialStandbysReady` / `newchainStandbyReadyEip712`. Extra `fd-08` does **not** count. Do **not** render those as seating, production OperatorDomain, or the 30-day gate. Green seating pills stay `seatingQualified === true` only. **P14 landed:** do **not** render lab 2249 / `labCgOpening` / `productionCgAvailable` / an injected small-set as production \(C_G\). **P23 landed (2026-08-17; honest 6/7):** keep-data deploy of P12–P22 to official G1. Six hosts `LIVE_OK` with overlay fields under `syncQualification`. fd-01 new-chain 409→accept. fd-06 HTTP unstable. Do **not** claim 7/7 healthy or durable `officialStandbysReady`. Green pills stay `seatingQualified === true` only. **P24 landed:** isolated `node.ts` new-chain accept uses the same `officialStandbysReady` callback as `lab-cli`. Explorer UI is unchanged. **Next (not landed):** **P25** read-only overlays for `officialStandbysReady` / `hashIndexCommittedInAc`. Do **not** change `archiveSeating.ts`. Review: `src/canvas/dle-mvp-milestone-assessment-2026-08-17.md`.

## What it shows

1. **Home** — Chain ID (`0x44c45`, hint **CoNET-DLE Testnet**) with a **Group ID** capsule (bootstrap L1 register tx; click opens CoNET Blockscout `/tx/…`; not the decimal / “Not L1 224422” hint), **Clusters** (unique canonical `liveGroupIds` / \(G_e\); genesis and no fission = **1**; lab M6 fission = **2**; second Group ID is the G2 L1 register tx `0xf781f2c2…876d5153` and **does** open Blockscout `/tx/`; laboratory keccak / uint `2` alias that tx; legacy `dle.lab.group.v1` aliases the first-group hash and must not count as a second group; **not** Tip height), archive count, 5+2 roles, AC / finalized, waiting pool, 7+2 SelectionLog (`poolRoot` / committee / standbys / endorsed), `producesBlocks=false`, no tip VM. Tip **hash** stays under the metric row (DLE lookup). Programming rules: [`RULES.md`](./RULES.md).
2. **Events** — WAL / heartbeat / rpc / lab-start / ondemand-* rows from `/api/v2/dle/events`, or last trusted / demo fixture.
3. **Archives** — seven-domain identity and live health overlay. **`fd-01-ionos-45` stays live** on `45.132.74.220` (nginx upstream). **`fd-03-ionos-98` stays live** on `45.132.74.221` (nginx upstream). Do **not** proxy excluded `74.208.224.45` or `198.251.77.98`. Green seating pill **only** when `seatingQualified === true` (lab `ArchiveStateChallengeV1`; P12 seating votes, P15 challenge / opening, and P16 BFT AC votes are EIP-712; P13 lab beacon is freeze-then-bind and **not** live CL RANDAO; P14 lab hosted-set / injected \(C_G\) smoke is **not** production \(C_G\)). Heartbeat `lastQuorumOk` is reachability, not seating. From-zero join lab: wipe only wipe-safe G1 joiners (`fd-05` / `fd-06` / `fd-07`) `~/dle-30d-lab/data`; never keepers. Live keepers `fd-01..04` must share the same four inventory roots, not just green pills. **P8c:** `/health` is a slim seating overlay (no `pendingChallenge` rebuild). Do not add a second seating poll. **P8d landed:** random fd-05+fd-06, leaf stayed 5194.
4. **Certificates** — lab networked 4-of-5 PrecommitQC **and** the on-demand SelectionLog. They are different objects. AC is tip finality (P16 lab EIP-712 `ArchiveBftVote`; **P21** may show `certificate.hashIndexRoot` / overlay `hashIndexCommittedInAc` when the bound root is non-zero — **not** production AC commitment; **not** a frozen L1 wrapper). SelectionLog is the recomputable 7+2 draw (P17 lab EIP-712 `ArchiveOnDemandAttest`; P19 beacon is freeze-then-bind lab keccak, **not** live CL RANDAO; P20 hooks are not gossip). P6 also shows new-chain \(Q_V\) / pending / certified counts from `/health` (per-`chainNftId` AC, never NFT 42). Live \(Q_V\) is lab EIP-712 `ArchiveValidatorQuorumAttest` (**P18**); **not** production. **P22** may show `newchainOfficialStandbysReady` / `newchainStandbyReadyEip712` — extra `fd-08` does **not** count; **not** seating; **not** production OperatorDomain / 30-day.
5. **Hash lookup** — `/hash/:hash`. Lab M7 pills: **Tip state root** / **Membership root** for first-class kinds; a hit returns the typed object, not the Archive Certificate.
6. **JSON-RPC** — ethers-shaped read facade (`eth_chainId`, `net_version`, synthetic tip block) plus `dle_*` including `dle_getWaitingPool` / `dle_getSelectionLog`; explicit rejection of `eth_call` / `eth_getBalance` / writes. Isolated from L1 `publicrpc`.

First paint seeds the 2026-08-15 lab accept (`poolRoot=0x1a0895b0…8def74`, 7+2, 5 active attests, `endorsed=true`; historical HMAC snapshot). A trusted live `/ondemand/pool` + `/ondemand/selection` (or `/api/v2/dle`) overwrites that snapshot. Failed fetches keep the last trusted values. Lab beacon is freeze-then-bind lab keccak (**P19**), **not** CoNET L1 CL RANDAO. Instant `labBeaconAfterFreeze(poolRoot)` is contrast-only. Live attests are EIP-712 `ArchiveOnDemandAttest` (**P17**). Wait hooks are not intra-group gossip (**P20**); lab HTTP is **not** production DePIN gossip. SelectionLog is **not** an Archive Certificate and **not** 30-day qualification. Do **not** paint `ondemandEip712` / `ondemandHookNotGossip` as production.

Refresh uses a `setTimeout` chain. Failed fetches keep the last trusted snapshot and never treat an untrusted empty body as “no data”.

## Boundaries

- Independent `package.json` — do not `../..` import `runtime`, `archive-a`, or `archive-b`.
- No wallet SDK and no Local Storage private keys. Only the archive URL and last trusted explorer snapshot are cached.
- User-visible copy is English.
