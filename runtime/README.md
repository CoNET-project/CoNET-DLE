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

`eth_chainId` 返回 **CoNET-DLE Testnet** EIP-155 id（`0x44c45` / `281669`），用来和 CoNET L1 `224422`、Base `8453` 区分；**不是** Group ID。用户可见 Group ID 是引导组 L1 登记交易 hash。`/rpc` **从不**代理 `publicrpc` / `rpc1` / `base-rpc`。`eth_call` / `eth_getBalance` / `eth_sendRawTransaction` 返回 method-not-found（无 tip VM、无 EVM 账户模型）。支持 JSON-RPC 2.0 **batch**（最多 32）。`lab-cli` 联网后 `dle_getArchiveCertificate` 返回实验室 4-of-5 PrecommitQC（**P16** 新票为 EIP-712 `ArchiveBftVote`，`hmacForgeable: false`；磁盘旧 HMAC 证书 keep-only 可恢复；**P21** 把 live/bound `hashIndexRoot` 写入实验室 BFT 票 / QC / AC；树视图 `committedInAc` 仍为 false；AC 携带非零 bound root 时 overlay `hashIndexCommittedInAc` — **不是**生产 AC 承诺 / 冻结 L1 wrapper / corpus SSZ）。无 roster 的 `startArchiveNode` 仍诚实空。

P3 on-demand（`runtime/src/shared/ondemand` + `runtime/src/archive/ondemand`；守则 [`src/shared/ondemand/RULES.md`](./src/shared/ondemand/RULES.md)）：实验室自动 seed 9 个 miner 并 freeze `poolRoot`，再按白皮书 \(R_e\) 抽 **7+2**。等待池 **不是** cluster 数 \(G_e\)。`dle_getWaitingPool` / `dle_getSelectionLog`、`GET /ondemand/pool`、`GET /ondemand/selection`、`POST /ondemand/hook`。七主机 ≥4 个 active EIP-712 attest（**P17** `ArchiveOnDemandAttest`）同一 `poolRoot`/`roulette` 后 `endorsed=true`。磁盘旧 HMAC attest keep-only 仍可恢复。单节点本地可复算 committee，但 **诚实 `endorsed=false`**。实验室 beacon = **先冻后绑**（默认 honest-wait `labOnDemandBeaconAfterFreeze`，或注入 CL view；即时 `labBeaconAfterFreeze(poolRoot)` 仅 contrast），**不是** CoNET L1 CL RANDAO（**P19**；P17 当时未换 beacon）。等待钩 **不** intra-group gossip（**P20**）：`ingest` 拒绝 `miners` / `hooks` / `hook`（`ERR_ONDEMAND_HOOK_NOT_GOSSIP`）；miner / daemon 必须对组内每一台活跃归档 POST 同一钩；一台 accept ≠ 组等待池一致。实验室 `POST /ondemand/hook`（TCP **27101**）**不是** 生产 DePIN gossip。Explorer nginx **不得**暴露 hook。SelectionLog **不是** AC，也 **不**改 P1 Mode A `valueHash`。重复钩拒绝（anti-hoard）。**不得**把 `endorsed` / `ondemandEip712` / `ondemandHookNotGossip` 画成 30 天资格或生产 gossip。

## 源码边界

| 路径 | 环境 |
|---|---|
| `runtime/src/archive/*` | Node.js（`node:fs` / `node:http`） |
| `runtime/src/daemon/core.ts`、`browser.ts` | isomorphic / browser（禁止 `node:`） |
| `runtime/src/daemon/cli.ts`、`serve-browser.ts` | Node 启动器 |
| `runtime/src/shared/*` | 双方共用协议，无 Node API |

测试：`npm run runtime:test`

## 七主机实验室

`lab-cli.js` 部署到 7 台 `~/dle-30d-lab`，监听 **27101**。P0/P2 验收：`command:archive`、`runtime:nodejs`、`producesBlocks:false`、7×7 `/liveness`（完整 `/health` 仅作诊断）、daemon probe（`eth_chainId=0x44c45`，`eth_call` 拒绝）。心跳 `lastQuorumOk` **不是** BFT，也 **不是** 席位资格。追块 `SYNCING` 不得入席；自报已同步须组内随机状态抽检 + \(Q_A=4/5\)（§5.2.0f / `RULES.md` §ArchiveSyncQualificationV1）。入席对照最富同组节点的 `/sync/status` 四根，并从**同一 donor** 追库存；已入座后库存增长不得撤证。实验室门面已实现 `ArchiveStateChallengeV1`（**P15** EIP-712 `ArchiveStateChallenge` + **P13** 实验室 keccak beacon，**不是** 生产 OperatorDomain / CL RANDAO）。`GET /sync/status` 的 `seatingQualified` 才是实验室席位。实验室 BFT / on-demand 还须等 5 个 active 四根对齐、没有未入座 active，以及进程启动满 30 分钟（`LAB_HOLD_BFT_AFTER_BOOT_MS`），避免证书恢复后立刻出块把库存打散。`hashIndexRoot` / `proveHashIndex` 共用进程内 Merkle 缓存，避免每次挑战或 Explorer `dle_proveHash` 对全库存重建叶子。G1 keep 只跑 `npm run lab:deploy-g1-keep`（合并 G1+G2 `planeDirectory`，不重启 G2）。启动探针只等 `GET /liveness`。从零加入：只清 wipe-safe 入座机的 `~/dle-30d-lab/data`（P7 曾清 `fd-05`/`fd-07`，leaf 4956）。**P8a–P8d 已落地**：join/挑战冻新编目；双方有 AC 必须打开 AC；`/health` 不重建 `pendingChallenge`；P8d 随机抽 **fd-05 + fd-06**，wipe→accept leaf 均 **5194**（零增长，无 STALE）。**P9 已过线（2026-08-17T06:35:54Z）：** 七台 G1 `GET /sync/opening` unique hosted **2103 === opened 2103**，`sampleCount=2104`；`/health` 七台 `QUALIFIED`、leaf **5225**。仍 HMAC，**不是** 生产 \(C_G\)。**P10 已过线（引擎 + 单测 + live smoke）：** 抽检方缺对象（`ERR_SYNC_CHALLENGER_MISSING`）不得 `POST /sync/reject`，inbound 为 no-op；`holdClaimed` + `OBJECT_MISMATCH` 才终端 `REJECTED`。对抗只走单测。live keep 七台 `LIVE_OK`（不 wipe）；`lab:smoke-rejected-safety` 七台 `QUALIFIED`、无 active `REJECTED`（`p10-rejected-safety.json` `at=2026-08-17T06:55:13.921Z`）。**P11 已过线（2026-08-17T07:52:17.884Z）：** extra standby `fd-08-hosthatch-hk1`（`167.104.98.104`）空 datadir 全开入座 `QUALIFIED`；官方 5+2 七台 + `fd-05` 仍 `QUALIFIED`（未 wipe）；`membershipRoot` 仍 `0xdeb200a9…`；joiner opening **2249 === 2249**（`sampleCount=2250`）；accept ~5.6 min。`npm run lab:p11-full-open-join`。证据 `p11-*.json`。见 `RULES.md` §P8 / §P9 / §P10 / §P11 / §P12。这 **不是** 30 天资格。**P12 已过线（引擎 + 单测，2026-08-17）：** 入座票 `POST /sync/vote` / `/sync/reject` 为 EIP-712 `ArchiveSyncQualificationCertificate`（domain `CoNET-DLE-Archive`，`chainId` 224422，`verifyingContract` 只绑已部署 `ArchiveCertificateVerifierV1`）。cutover 后 HMAC 入座票 `ERR_SYNC_HMAC_CUTOVER`。**P15 已过线（引擎 + 单测，2026-08-17）：** 挑战 / `GET /sync/opening` 为 EIP-712 `ArchiveStateChallenge`（`samplesRoot`；`hmacForgeable: false`）。HMAC / 未签名信封 `ERR_SYNC_CHALLENGE_HMAC_CUTOVER`。**P16 已过线（引擎 + 单测，2026-08-17；当时 `runtime:test` 125/125）：** BFT AC 新票为 EIP-712 `ArchiveBftVote`（同域；复用入座钥）。HMAC / 未签名票 `ERR_BFT_HMAC_CUTOVER`。磁盘旧 HMAC **证书** keep-only 可恢复。**P17 已过线（引擎 + 单测，2026-08-17；当时 `runtime:test` 128/128）：** on-demand attest 为 EIP-712 `ArchiveOnDemandAttest`（同域；复用入座钥）。HMAC / 未签名 attest `ERR_ONDEMAND_HMAC_CUTOVER`。磁盘旧 HMAC attest keep-only 可恢复。on-demand lab beacon **未换**。**P18 已过线（引擎 + 单测，2026-08-17；`runtime:test` 131/131）：** P6 \(Q_V\) 为 EIP-712 `ArchiveValidatorQuorumAttest`（同域；复用入座钥于 request 派生 `validatorId`）。HMAC / 未签名票 `ERR_VALIDATOR_QUORUM_HMAC_CUTOVER`。磁盘旧 HMAC \(Q_V\) keep-only 可恢复。确定性实验室入座密钥，**不是** OperatorDomain / L1 settle / 生产签名。绿点仍只看 `seatingQualified`；**不得**把 `seatingEip712` / `challengeEip712` / `bftEip712` / `ondemandEip712` / `newchainValidatorQuorumEip712` 画成生产。**P13 已过线（引擎 + 单测，2026-08-17）：** 先 persist `ArchiveSyncFreezeV1`（无 seed），再 bind；无终局 CL view 则诚实实验室 `labSyncBeaconAfterFreeze`。**禁止**把 `publicrpc` / `rpc1` 读成 live CL RANDAO；**禁止**把 freeze 后 keccak 宣传为生产 \(R^{\mathrm{sync}}_e\)。`status`/`health` 标 `freezeBeforeBeacon` / `labBeaconAfterFreeze` / `notProductionBeacon`。绿点仍只看 `seatingQualified`。**P14 已过线（引擎 + 单测，2026-08-17）：** 实验室 freezer hosted-set 继续当实验室开口（P9/P11 全开语义不变）；生产 \(C_G\) 只认 L1 `archiveGroupId` ∪ `{lastAC, membershipRoot, hashIndexRoot}`。默认无 L1 view（诚实等待）。**禁止**把 2249 条实验室链或 `publicrpc`/`rpc1` 扫描写成生产 \(C_G\)。可选注入小集仍标 `notProductionCg` / `notLiveL1Scan`；`health()` 不建 production samples。绿点仍只看 `seatingQualified`。见 `RULES.md` §P12 / §P13 / §P14 / §P15 / §P16 / §P17 / §P18 / §P19 / §P20 / §P21 / §P22。**P19 已过线（引擎 + 单测，2026-08-17；当时 `runtime:test` 134/134）：** on-demand 先 persist `ondemandFreezeHex` 再 bind（默认 honest-wait；`publicrpc`/`rpc1` 拒绝）。即时 `labBeaconAfterFreeze(poolRoot)` 仅 contrast。**P20 已过线（引擎 + daemon + 单测，2026-08-17；`runtime:test` 140/140）：** 等待钩不 gossip；`ingest` 拒绝 miner/hook 注入；daemon 必须扇出到每一台活跃归档。实验室 HTTP **不是** 生产 DePIN gossip。**P21 已过线（引擎 + 单测，2026-08-17；当时 `runtime:test` 148/148）：** 实验室 BFT 票 / QC / AC 绑定 live/bound `hashIndexRoot`；树 `committedInAc` 仍为 false；overlay 仅当 AC 根 ≠ `ZERO32`。**不是** 生产 AC 承诺。**P22 已过线（引擎 + 单测，2026-08-17；当时 `runtime:test` 153/153）：** 官方 standby（`fd-06` / `fd-07`）入座后签实验室 EIP-712 `ArchiveStandbyReadiness`；extra `fd-08` 可 ingest **不计入**官方人数；`POST /sync/standby-ready`；`lab-cli` 新链 accept 须两台官方就绪，否则 409 `ERR_NEWCHAIN_STANDBY_NOT_READY`。**不是** 生产 OperatorDomain / secp256k1 / 30 天门。绿点仍只看 `seatingQualified`。完成本轨 **不得** 开 `pilotStartedAt`。**P23 已过线（live keep-deploy + 证据，2026-08-17；诚实 6/7）：** `lab:deploy-g1-keep` 把 P12–P22 二进制发到官方 G1。六台 `LIVE_OK`，`/health.syncQualification` 出现 EIP-712 overlay。fd-01 新链 **409** `ERR_NEWCHAIN_STANDBY_NOT_READY` → **200** accept（`requestId` `0xe8229f16…81b472`）。官方 standby `fd-06` HTTP 不稳（事件循环饿死；二次 keep-data 仍无 `LIVE_OK`）。**不得**宣称 7/7 健康或七台 `officialStandbysReady` 长期为 true。G2 BFT/ondemand 仍关。**不是** 30 天资格。证据：`pilot/evidence/conet-dle-p23-live-2026-08/`。**P24 已过线（引擎 + 单测，2026-08-17；`runtime:test` 154/154）：** 隔离 `node.ts` 新链 accept 与 `lab-cli` 共用同一 `officialStandbysReady` 回调；不 `sync.start()`、不冻库存。extra `fd-08` 仍不计。**不是** 7/7 健康 / 30 天资格。**P25 已过线（Explorer overlay + 单测，2026-08-17；`explorer:test` 8/8）：** Certificates + Home **非绿**芯片展示 `officialStandbysReady` / `hashIndexCommittedInAc`。绿点仍只 `seatingQualified === true`。**下一闸：** 停放 / 仅审查。审查：`src/canvas/dle-mvp-milestone-assessment-2026-08-17.md`。

P1 联网 BFT（独立包 `runtime/src/archive/bft`）：5 个 active 对冻结 TradeOpened 候选做 Mode A 重放，交换 prevote/precommit，签发 **4-of-5 实验室 AC**；2 个 standby 不投票。**P16** 新票为 EIP-712 `ArchiveBftVote`（`hmacForgeable: false`）；磁盘旧 HMAC 证书 keep-only 可恢复。**P21** 把 live/bound `hashIndexRoot` 写入实验室 BFT 票 / QC / AC；树视图 `committedInAc` 仍为 false；AC 携带非零 bound root 时 overlay `hashIndexCommittedInAc`。**P22** 官方 standby 就绪签是另一条轨（`ArchiveStandbyReadiness`；extra `fd-08` 不计），**不是** BFT 投票。**P24** 把同一回调接到隔离 `node.ts`。**P25** 只在 Explorer 画非绿 overlay，不改入座绿点。证据：`pilot/evidence/conet-dle-30d-lab-2026-08/bft-p1-accept.json`。**不是** 30 天资格，**不是**生产 AC 承诺 / 冻结 L1 wrapper / corpus SSZ。

产物必须带 `package.json` `"type":"module"`（系统 Node 18 否则会把 ESM `.js` 当 CJS）。P12+ 归档 tarball 还必须带 `ethers`（`runtime:build` 对 `runtime/dist/archive` 做 `npm install --omit=dev`）；远程解包不得用无依赖 stub 覆盖 `app/package.json`。部署只 SIGTERM `agent.mjs` / `lab-cli.js`，不得碰 geth / beacon / validator。

编程守则（改归档 / on-demand / daemon 后必须同任务更新）：[`RULES.md`](./RULES.md)、[`src/shared/ondemand/RULES.md`](./src/shared/ondemand/RULES.md)、[`src/daemon/RULES.md`](./src/daemon/RULES.md)。

只读 explorer 面（P4 脚手架，无新域名）：

- `GET /health` — 进程健康 + **`liveGroupCount` / `liveGroupIds`**（\(G_e\)；无裂变 = **1**；实验室 M6 第二组后 = **2**）。须写在 `extraHealth` **之后**，避免被覆盖
- `GET /api/v2/dle` — chain id、**`chainName: CoNET-DLE Testnet`**、tip、`producesBlocks=false`、**`liveGroupCount` / `liveGroupIds`**（顶层与 `archive`；发出面一律 `canonicalGroupId`）；有实验室 AC 时 tip `finalized=true`；可带 `waitingPool` / `selection`。Explorer Home 用 Clusters 展示 \(G_e\)，**不再**用 Tip height 面板（NFT 42 AC height 恒为 `0x1`）。第二组 Group ID 是 G2 L1 `registerLiveGroup` tx，**不是**实验室 keccak（keccak 仅为别名）
- `GET /api/v2/dle/events` — 内存 WAL 环（listen / rpc / lab-start / heartbeat / bft-vote / archive-certificate / ondemand-*）
- `GET /api/v2/dle/certificate` — 实验室联网 AC（无 BFT 时仍诚实空）
- `POST /bft/message` / `GET /bft/status` — 实验室 prevote/precommit 交换（复用 27101）
- `GET /ondemand/pool` / `GET /ondemand/selection` / `POST /ondemand/hook` / `POST /ondemand/freeze` / `POST /ondemand/message` — 实验室等待池与 SelectionLog（复用 27101）
- `POST /newchain/request` / `GET /newchain/chains` — 实验室 Mode A 三类新链创世；新 \(Q_V\) 为 EIP-712 `ArchiveValidatorQuorumAttest`（**P18**；**不是** 生产 secp256k1 / L1 NFT / 30 天资格）。随机用户：`70.35.205.77:/home/peter/dle-newchain-user`（`npm run lab:deploy-newchain-user`）

本地 UI：`npm run explorer:dev`（见 `explorer/README.md`）。Home / Certificates 展示 waiting pool、`poolRoot`、7+2、`endorsed`；首屏 seed 七主机 P3 验收，仅可信 live 覆盖。`eth_chainId` 仍是 CoNET-DLE Testnet `0x44c45`，不是 L1 `224422`。`liveGroupIds` 含引导组 L1 登记交易 hash；实验室 M6 另含 G2 L1 `registerLiveGroup` tx（Home Clusters 下打开 Blockscout `/tx/`；实验室 keccak 仅为别名）。`dle_locateHash` 在 \(G_e \ge 2\) 走 `locatePlane`；全平面 JSON-RPC `null` 仅当每个活跃组都返回可信本组 `notFound`。一组超时是 `unavailable`，不是 `null`。实验室 M7：`tipStateRoot` / `membershipRoot` 为一等 `HashObjectKind`，命中返回 typed 对象而不是 AC；同 hash 后一 height 为 first-write-wins；`ZERO32` 不编目。这 **不是** 30 天资格。
