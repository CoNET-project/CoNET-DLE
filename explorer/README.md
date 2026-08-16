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

This explorer does **not** claim 30-day qualification. Heartbeat quorum on 27101 is not BFT. A lab networked 4-of-5 AC (HMAC-SHA256) may appear on Certificates; it is **not** a frozen EIP-712 L1 wrapper or corpus SSZ object.

## What it shows

1. **Home** — Chain ID (`0x44c45`, hint **CoNET-DLE Testnet**) with a **Group ID** capsule (bootstrap L1 register tx; click opens CoNET Blockscout `/tx/…`; not the decimal / “Not L1 224422” hint), **Clusters** (unique canonical `liveGroupIds` / \(G_e\); genesis and no fission = **1**; legacy `dle.lab.group.v1` aliases the hash and must not count as a second group; **not** Tip height), archive count, 5+2 roles, AC / finalized, waiting pool, 7+2 SelectionLog (`poolRoot` / committee / standbys / endorsed), `producesBlocks=false`, no tip VM. Tip **hash** stays under the metric row (DLE lookup). Programming rules: [`RULES.md`](./RULES.md).
2. **Events** — WAL / heartbeat / rpc / lab-start / ondemand-* rows from `/api/v2/dle/events`, or last trusted / demo fixture.
3. **Archives** — seven-domain identity and live health overlay.
4. **Certificates** — lab networked 4-of-5 PrecommitQC **and** the on-demand SelectionLog. They are different objects. AC is tip finality; SelectionLog is the recomputable 7+2 draw. Not production SSZ / EIP-712.
5. **JSON-RPC** — ethers-shaped read facade (`eth_chainId`, `net_version`, synthetic tip block) plus `dle_*` including `dle_getWaitingPool` / `dle_getSelectionLog`; explicit rejection of `eth_call` / `eth_getBalance` / writes. Isolated from L1 `publicrpc`.

First paint seeds the 2026-08-15 lab accept (`poolRoot=0x1a0895b0…8def74`, 7+2, 5 active attests, `endorsed=true`). A trusted live `/ondemand/pool` + `/ondemand/selection` (or `/api/v2/dle`) overwrites that snapshot. Failed fetches keep the last trusted values. Lab beacon is keccak after freeze, **not** CoNET L1 CL RANDAO. HMAC attests are forgeable. SelectionLog is **not** an Archive Certificate and **not** 30-day qualification.

Refresh uses a `setTimeout` chain. Failed fetches keep the last trusted snapshot and never treat an untrusted empty body as “no data”.

## Boundaries

- Independent `package.json` — do not `../..` import `runtime`, `archive-a`, or `archive-b`.
- No wallet SDK and no Local Storage private keys. Only the archive URL and last trusted explorer snapshot are cached.
- User-visible copy is English.
