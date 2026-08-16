# CoNET-DLE runtime：归档 node / daemon

本目录是 **P1/P2/P3 运行时**：归档 / daemon command + 与 L1 publicrpc 隔离的 JSON-RPC 2.0 只读 facade + 实验室 on-demand 等待钩 / 可重算 7+2 抽选。与 `implementations/archive-a`、`archive-b`（进程内共识核）隔离：**禁止**从本包 import 那两套共识实现。

## 两个 command

| Command | npm | 实行环境 | 职责 |
|---|---|---|---|
| **`archive`** | `npm run archive` | **仅 Node.js** | 归档全节点进程：磁盘 WAL、HTTP/JSON-RPC（默认 TCP **27101**）、**不出块**、**无 tip VM** |
| **`daemon`** | `npm run daemon` | **Node 或 browser** | 轻量客户端：用 `fetch` 连归档、`POST /ondemand/hook`、本地复算 7+2、**不写磁盘 WAL** |

浏览器页（daemon 逻辑在页面内执行）：

```bash
npm run daemon:browser
# 打开 http://127.0.0.1:27111/  （本进程只托管 HTML）
```

## 用法

```bash
# 终端 1 — 归档节点（Node.js）
cd src/conet-layer2
npm run archive -- --port 27101 --data-dir ./data/dle-archive

# 终端 2 — daemon（Node 启动器，核心仍是 isomorphic）
npm run daemon -- --archive http://127.0.0.1:27101 --wait
```

`eth_chainId` 返回 **CoNET-DLE Testnet** EIP-155 id（`0x44c45` / `281669`），用来和 CoNET L1 `224422`、Base `8453` 区分；**不是** Group ID。用户可见 Group ID 是引导组 L1 登记交易 hash。`/rpc` **从不**代理 `publicrpc` / `rpc1` / `base-rpc`。`eth_call` / `eth_getBalance` / `eth_sendRawTransaction` 返回 method-not-found（无 tip VM、无 EVM 账户模型）。支持 JSON-RPC 2.0 **batch**（最多 32）。`lab-cli` 联网后 `dle_getArchiveCertificate` 返回实验室 4-of-5 PrecommitQC（HMAC-SHA256，**可伪造**，不是冻结 EIP-712 / corpus SSZ）。无 roster 的 `startArchiveNode` 仍诚实空。

P3 on-demand（`runtime/src/shared/ondemand` + `runtime/src/archive/ondemand`；守则 [`src/shared/ondemand/RULES.md`](./src/shared/ondemand/RULES.md)）：实验室自动 seed 9 个 miner 并 freeze `poolRoot`，再按白皮书 \(R_e\) 抽 **7+2**。等待池 **不是** cluster 数 \(G_e\)。`dle_getWaitingPool` / `dle_getSelectionLog`、`GET /ondemand/pool`、`GET /ondemand/selection`、`POST /ondemand/hook`。七主机 ≥4 个 active HMAC attest 同一 `poolRoot`/`roulette` 后 `endorsed=true`。单节点本地可复算 committee，但 **诚实 `endorsed=false`**。实验室 beacon = freeze **之后**的 keccak，**不是** CoNET L1 CL RANDAO。SelectionLog **不是** AC，也 **不**改 P1 Mode A `valueHash`。重复钩拒绝（anti-hoard）。HMAC 可伪造，不是 30 天资格。

## 源码边界

| 路径 | 环境 |
|---|---|
| `runtime/src/archive/*` | Node.js（`node:fs` / `node:http`） |
| `runtime/src/daemon/core.ts`、`browser.ts` | isomorphic / browser（禁止 `node:`） |
| `runtime/src/daemon/cli.ts`、`serve-browser.ts` | Node 启动器 |
| `runtime/src/shared/*` | 双方共用协议，无 Node API |

测试：`npm run runtime:test`

## 七主机实验室

`lab-cli.js` 部署到 7 台 `~/dle-30d-lab`，监听 **27101**。P0/P2 验收：`command:archive`、`runtime:nodejs`、`producesBlocks:false`、7×7 `/health`、daemon probe（`eth_chainId=0x44c45`，`eth_call` 拒绝）。心跳 `lastQuorumOk` **不是** BFT。

P1 联网 BFT（独立包 `runtime/src/archive/bft`）：5 个 active 对冻结 TradeOpened 候选做 Mode A 重放，交换 prevote/precommit，签发 **4-of-5 实验室 AC**；2 个 standby 不投票。证据：`pilot/evidence/conet-dle-30d-lab-2026-08/bft-p1-accept.json`。**不是** 30 天资格，**不是**生产签名。

产物必须带 `package.json` `"type":"module"`（系统 Node 18 否则会把 ESM `.js` 当 CJS）。部署只 SIGTERM `agent.mjs` / `lab-cli.js`，不得碰 geth / beacon / validator。

编程守则（改归档 / on-demand / daemon 后必须同任务更新）：[`RULES.md`](./RULES.md)、[`src/shared/ondemand/RULES.md`](./src/shared/ondemand/RULES.md)、[`src/daemon/RULES.md`](./src/daemon/RULES.md)。

只读 explorer 面（P4 脚手架，无新域名）：

- `GET /health` — 进程健康 + **`liveGroupCount` / `liveGroupIds`**（\(G_e\)；无裂变 = **1**）。须写在 `extraHealth` **之后**，避免被覆盖
- `GET /api/v2/dle` — chain id、tip、`producesBlocks=false`、**`liveGroupCount` / `liveGroupIds`**（顶层与 `archive`）；有实验室 AC 时 tip `finalized=true`；可带 `waitingPool` / `selection`。Explorer Home 用 Clusters 展示 \(G_e\)，**不再**用 Tip height 面板（NFT 42 AC height 恒为 `0x1`）
- `GET /api/v2/dle/events` — 内存 WAL 环（listen / rpc / lab-start / heartbeat / bft-vote / archive-certificate / ondemand-*）
- `GET /api/v2/dle/certificate` — 实验室联网 AC（无 BFT 时仍诚实空）
- `POST /bft/message` / `GET /bft/status` — 实验室 prevote/precommit 交换（复用 27101）
- `GET /ondemand/pool` / `GET /ondemand/selection` / `POST /ondemand/hook` / `POST /ondemand/freeze` / `POST /ondemand/message` — 实验室等待池与 SelectionLog（复用 27101）

本地 UI：`npm run explorer:dev`（见 `explorer/README.md`）。Home / Certificates 展示 waiting pool、`poolRoot`、7+2、`endorsed`；首屏 seed 七主机 P3 验收，仅可信 live 覆盖。`eth_chainId` 仍是 CoNET-DLE Testnet `0x44c45`，不是 L1 `224422`。`liveGroupIds` 为引导组登记交易 hash。
