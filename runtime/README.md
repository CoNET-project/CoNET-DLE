# CoNET-DLE runtime：归档 node / daemon

本目录是 **P1 运行时脚手架**，与 `implementations/archive-a`、`archive-b`（进程内共识核）隔离：**禁止**从本包 import 那两套共识实现。

## 两个 command

| Command | npm | 实行环境 | 职责 |
|---|---|---|---|
| **`archive`** | `npm run archive` | **仅 Node.js** | 归档全节点进程：磁盘 WAL、HTTP/JSON-RPC（默认 TCP **27101**）、**不出块**、**无 tip VM** |
| **`daemon`** | `npm run daemon` | **Node 或 browser** | 轻量客户端：用 `fetch` 连归档、on-demand 等待钩（脚手架）、**不写磁盘 WAL** |

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

`eth_chainId` 返回实验室 DLE id（`0x44c45`），**不是** CoNET L1 `224422`。`eth_call` / `eth_sendRawTransaction` 返回 method-not-found（无 tip VM）。

## 源码边界

| 路径 | 环境 |
|---|---|
| `runtime/src/archive/*` | Node.js（`node:fs` / `node:http`） |
| `runtime/src/daemon/core.ts`、`browser.ts` | isomorphic / browser（禁止 `node:`） |
| `runtime/src/daemon/cli.ts`、`serve-browser.ts` | Node 启动器 |
| `runtime/src/shared/*` | 双方共用协议，无 Node API |

测试：`npm run runtime:test`

## 七主机实验室（2026-08-14 已验收）

`lab-cli.js` 已部署到 7 台 `~/dle-30d-lab`，监听 **27101**。验收：`command:archive`、`runtime:nodejs`、`producesBlocks:false`、7×7 `/health`、daemon probe（`eth_chainId=0x44c45`，`eth_call` 拒绝）。这是心跳 quorum，**不是**联网 BFT / AC，**不是** 30 天资格。

产物必须带 `package.json` `"type":"module"`（系统 Node 18 否则会把 ESM `.js` 当 CJS）。部署只 SIGTERM `agent.mjs` / `lab-cli.js`，不得碰 geth / beacon / validator。

只读 explorer 面（P4 脚手架，无新域名）：

- `GET /api/v2/dle` — chain id、tip、空 AC、`producesBlocks=false`
- `GET /api/v2/dle/events` — 内存 WAL 环（listen / rpc / lab-start / heartbeat）
- `GET /api/v2/dle/certificate` — 诚实空证书

本地 UI：`npm run explorer:dev`（见 `explorer/README.md`）。`eth_chainId` 仍是 `0x44c45`，不是 L1 `224422`。
