# CoNET-DLE Explorer

Read-only explorer for **CoNET-DLE** archive events, 5+2 node identity, and Archive Certificates.

This is **not** an L1 Blockscout clone and **not** an `eth_call` browser.

| DLE | L1 Blockscout |
| --- | --- |
| Lab chain id `0x44c45` (281669) | CoNET L1 `224422` |
| Tip finality = Archive Certificate (PrecommitQC) | Blocks / execution receipts |
| Archive nodes **do not produce blocks** | Full nodes produce and execute |
| No tip VM — `eth_call` is rejected | EVM browser |

Public hostname (user-authorized): **`https://dle.conet.network`** on `70.35.205.77`.
The SPA is same-origin; nginx proxies `/health`, `/rpc`, and `/api/v2/dle` to lab archives on TCP **27101**.
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

## Lab hosts

The seven-domain roster (5 active + 2 standby) is bundled as a **fixture**. Point the Home endpoint at `http://<lab-host>:27101` to merge live `/health` fields (`lastQuorumOk`, `lastPeerOk`, `heartbeats`) onto the matching `domainId`.

This explorer does **not** claim 30-day qualification. Heartbeat quorum on 27101 is not networked BFT / AC.

## What it shows

1. **Home** — chain id, tip height, archive count, 5+2 roles, AC / finalized, `producesBlocks=false`, no tip VM.
2. **Events** — WAL / heartbeat / rpc / lab-start rows from `/api/v2/dle/events`, or last trusted / demo fixture.
3. **Archives** — seven-domain identity and live health overlay.
4. **Certificates** — honest empty `dle_getArchiveCertificate` until a networked AC exists.
5. **JSON-RPC** — `eth_chainId`, `eth_blockNumber`, `dle_info`, `dle_tip`; explicit `eth_call` rejection.

Refresh uses a `setTimeout` chain. Failed fetches keep the last trusted snapshot and never treat an untrusted empty body as “no data”.

## Boundaries

- Independent `package.json` — do not `../..` import `runtime`, `archive-a`, or `archive-b`.
- No wallet SDK and no Local Storage private keys. Only the archive URL and last trusted explorer snapshot are cached.
- User-visible copy is English.
