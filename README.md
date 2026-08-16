# CoNET-DLE

**CoNET Distributed Ledger Expansion** — parallel, event-only, archive-finalized ledger shards on CoNET DePIN.

[中文简介](#中文简介) · [English](#what-this-repository-is) · [Whitepaper (EN)](src/whitepaper/Decentralization%20Cluster%20multi-chain.md) · [白皮书（中文）](src/whitepaper/Decentralization%20Cluster%20multi-chain.zh-CN.md)

GitHub: [github.com/CoNET-project/CoNET-DLE](https://github.com/CoNET-project/CoNET-DLE)

---

## 中文简介

CoNET-DLE 是一套 **轻量、并行、按事件出块** 的账本扩展层：每条 tip 由验证者委员会提议，由托管该分片的 **5 活跃 + 2 待命** 归档组用 Tendermint 风格 **PrevoteQC → PrecommitQC（Archive Certificate）** 终局。归档节点 **没有出块权**。

本仓库是 **规范、双实现 TypeScript MVP、一致性语料、隔离实验室与只读 Explorer** 的独立 Git 项目。它 **不是** CoNET L1 全节点，也 **不是** 生产准入声明。

| 当前事实 | 说明 |
|---|---|
| 白皮书 | 英 / 中成对，须同任务同步 |
| Archive A / B | 两套独立 TypeScript 共识核，禁止互相 import |
| 实验室 | 7 台独立主机、仅 TCP **27101**、进程名 `dle-30d-lab` |
| 资格 | **尚未合格**：72h warmup 已启动，30 天 100/30/100 计数器仍为 0 |
| L1 合约 | **不在本仓**；Solidity 在 BeamioContract `src/dle/`，链上 **尚未部署** |

**严禁**在实验室主机上停止、启动或重启 `geth` / `beacon-chain` / `validator`。故障注入只允许对 `dle-30d-lab` 归档进程发 `SIGTERM`。

---

## What this repository is

CoNET-DLE shards **by ledger**, not by tricks on one global tip:

- **No event ⇒ no block.** Empty-slot mining and archive-produced control blocks are forbidden.
- **Validator committee** proposes (`N_V = 7`, `Q_V = 5/7`).
- **Archive group** finalizes with **strict 4-of-5** (`N_A = 5`, `f = 1`, `Q_A = 4`). Do not lower quorum because a member is offline.
- **5+2 membership:** five non-overlapping active voters plus two dedicated standbys. `maxGroupsPerArchive = 1`.
- **DA:** byte-exact systematic Reed–Solomon `dle.rs.v1` `(n, k) = (7, 4)`.
- **Transport:** CoNET DePIN wallet-address gossip + OpenPGP. Entry/mailbox nodes must not read plaintext.
- **Asset band (design):** per-tip safety cap is frozen at **100 USDC-equivalent**. The 10 USDC floor and 1.2× coverage gates remain **provisional** until a measured cost epoch closes.

This repo implements **executable specs and lab software**. It does **not** claim:

- production new-chain admission;
- a closed cost epoch;
- networked BFT / Archive Certificate on the lab mesh;
- on-chain CoNET L1 DLE deployment or Blockscout verification.

Lab `/health` mesh (7×7 HTTP 200) is a **heartbeat quorum**, not consensus.

---

## Repository layout

| Path | Role |
|---|---|
| [`src/whitepaper/`](src/whitepaper/) | Normative design (EN + zh-CN), Tendermint / gateway / OperatorDomain specs, TLA+ |
| [`conformance/`](conformance/) | Canonical v2 corpus, JSON schema, independent-process differential runner |
| [`implementations/archive-a/`](implementations/archive-a/) | Archive A TypeScript MVP (no shared consensus core) |
| [`implementations/archive-b/`](implementations/archive-b/) | Archive B TypeScript MVP (must not import Archive A) |
| [`runtime/`](runtime/) | Archive node + daemon scaffolding (Node archive; isomorphic daemon; **does not produce blocks**). Programming: [`runtime/RULES.md`](runtime/RULES.md) |
| [`pilot/`](pilot/) | Dry-run DSL + isolated 30-day lab CLI, inventories, evidence schemas |
| [`explorer/`](explorer/) | Read-only SPA. Home **Clusters** = \(G_e\) (no Tip height panel). Programming: [`explorer/RULES.md`](explorer/RULES.md) |
| [`evidence/`](evidence/) | CI evidence scripts (local, no SSH, no secrets) |
| [`docs/`](docs/) | Pilot notes, CI evidence contract |
| [`.github/workflows/`](.github/workflows/) | TypeScript MVP CI + pilot lint/test/dry-run |

**L1 Solidity** (`Queue`, `Chain/Archive Registry`, `OperatorDomain`, AC verifier, Dispute, BurnMint Gateway, …) lives in the **BeamioContract** tree (`src/dle/`), not in this GitHub repository. Treat that suite as undeployed until a verified `deployments/conet-DLE-*.json` exists on CoNET `224422`.

---

## Status (honest)

| Gate | Status |
|---|---|
| Dual TS MVP + corpus v2 + CI evidence | Implemented; CI is local-only (no deploy, no SSH) |
| Isolated 7-host lab (`~/dle-30d-lab`, TCP 27101) | Deployed; 7×7 `/health` accepted as heartbeat mesh |
| Lab billing (operator-stated) | **USD 4 / host / month**, unmetered; invoice subtotal **USD 28** for the 2026-08 host-month window |
| 72-hour warmup | Clock started **2026-08-14T17:10:16.786Z** (do not reset) |
| 30-day qualification (100 rotations / 30 re-homes / 100 takeovers, no `safety-failure`) | **Not qualified** — counters remain 0 until warmup completes |
| Networked Tendermint / AC on lab | **Not** claimed |
| CoNET L1 DLE contracts | **Not deployed** from this repo |
| Public evidence bundle | Schemas + redactor exist; do not publish raw host IPs or `billingRef` |

SSH host lists (`pilot/lab/hosts.json`) are **private inventory**. Public evidence allowlist is only: `inventory.json`, `gate.json`, `failures.ndjson`, `meter.ndjson`, `invoice.json` — all passed through `PublicEvidenceRedactor`.

---

## Requirements

- **Node.js 22** (matches CI)
- npm workspaces are **not** used; install per package as shown below

---

## Quick start (conformance)

From the repository root:

```bash
npm ci
npm --prefix implementations/archive-b ci

npm run evidence:verify
npm run corpus:check
npm run boundary:check
npm run archive-a:test
npm run archive-b:test
npm run differential:test
```

Root `npm test` runs Archive A tests plus the differential suite. Archive A and Archive B **may** share the corpus JSON; they **must not** import each other’s source.

See [`docs/ci-evidence.md`](docs/ci-evidence.md) and [`conformance/README.md`](conformance/README.md).

---

## Local archive + explorer

Archive listens on **TCP 27101**, `command: archive`, `producesBlocks: false`. `eth_chainId` is **CoNET-DLE Testnet** EIP-155 `0x44c45` (**not** CoNET L1 `224422`, **not** a group id). User-visible **Group ID** is the L1 bootstrap register tx hash. `eth_call` / `eth_sendRawTransaction` are rejected (no tip VM).

```bash
npm run archive -- --port 27101 --data-dir ./data/dle-archive

# another terminal
npm --prefix explorer install
npm run explorer:dev
# http://127.0.0.1:27121/  →  archive at 127.0.0.1:27101
```

Daemon (does not write WAL):

```bash
npm run daemon -- --archive http://127.0.0.1:27101 --wait
```

Details: [`runtime/README.md`](runtime/README.md), [`explorer/README.md`](explorer/README.md).

---

## Isolated 30-day lab

Seven **host-isolated** machines run only `~/dle-30d-lab` (archive `lab-cli.js`). Port **27101** only.

```bash
cd pilot
npm ci
npm run lab:preflight
npm run lab:deploy
npm run lab:status
npm run lab:warmup
# crash inject: SIGTERM dle-30d-lab only — never EL/CL
npm run lab:inject-crash -- --domain <domainId>
```

Use the compiled pilot CLI for deploy/accept (`npm run build` then `node dist/src/cli.js …`) as documented in [`pilot/lab/README.md`](pilot/lab/README.md). Dry-run scenarios stay `simulationOnly: true` / `destructive: false`. Real network/disk/WAL/oracle/treasury/L1 injection is **not** open.

Qualification model (not yet met): continuous 72h warmup, then 30 days with ≥100 rotation, ≥30 re-home, ≥100 takeover. Any `safety-failure` **restarts the epoch** (warmup + window + counters). Old evidence is append-only.

Full notes: [`docs/pilot/README.md`](docs/pilot/README.md).

---

## Safety and operations

- **Never** restart CoNET L1 execution or consensus (`geth`, `beacon-chain`, `validator`) as part of DLE lab work.
- Deprecated L1 leftover hosts must **never** `start-with-va`.
- Do not invent new public hostnames for metadata or Solidity constants. Reuse existing CoNET / Beamio domains and path prefixes.
- Do not copy `~/.master.json` between machines.
- User-facing product strings in explorer UI are English.

---

## License and authorship

Design whitepaper author: **Peter Xie** (first draft 2023; current revision on the whitepaper title page).

If this tree does not yet contain a `LICENSE` file, treat contribution terms as unpublished until one is added to the repository root.
