# CoNET DLE 30 天 5+2 Pilot 脚手架

本目录说明 `pilot/` 独立 TypeScript 包。当前包同时包含：

1. **dry-run 脚手架**：只执行内存/文件级模拟，不连接主机、不调用 SSH、不部署、不停止或重启任何进程。
2. **正式 30 天隔离实验室**（`inventories/conet-dle-30d-lab-2026-08.json` + `lab/`）：在用户指定的 7 台独立主机上部署 `~/dle-30d-lab` 轻量归档副本。实验室进程名固定为 `dle-30d-lab`，**禁止**停止、重启或启动 `geth` / `beacon-chain` / `validator`。已弃用 L1 主机 **禁止 start-with-va**。

正式实验室命令：

```bash
cd pilot
npm run lab:preflight
npm run lab:deploy
npm run lab:status
npm run lab:warmup
# 仅允许杀死 dle-30d-lab/agent.mjs，绝不碰 EL/CL
npm run lab:inject-crash -- --domain fd-01-ionos-45
```

## 资格模型

- Inventory 必须恰好包含 7 个唯一 `domainId`、7 个唯一 `operatorDomainId`、7 个唯一 `hostId`。
- 拓扑固定为 5 个 active + 2 个 standby。
- 每个资格 epoch 先完成连续 72 小时 warmup，随后才开始连续 30 天 pilot 窗口。
- pilot epoch 内至少完成 100 次 rotation、30 次 rehome、100 次 takeover。
- 任一 `safety-failure` 立即开启新 epoch：warmup 与 30 天窗口均重新计时，三个计数器清零；旧证据只追加保留，不删除或改写。

## 故障场景 DSL

DSL 是 JSON 数组，每项必须显式声明 `simulationOnly: true` 与 `destructive: false`。支持：

`process-crash`、`network-partition`、`disk-corruption`、`wal-corruption`、`duplicate-message`、`reorder-message`、`stale-membership`、`oracle-fault`、`treasury-fault`、`l1-reorg-simulation`。

```json
[
  {
    "schema": "FailureScenarioV1",
    "id": "partition-001",
    "kind": "network-partition",
    "targetDomainIds": ["domain-1"],
    "durationMs": 1000,
    "parameters": { "lossPercent": 100, "direction": "bidirectional" },
    "simulationOnly": true,
    "destructive": false
  }
]
```

`SimulationOnlyScenarioRunner` 只生成合成 `FailureSampleV1`。正式实验室另有 **隔离** `lab-inject-crash`：只向 `dle-30d-lab/agent.mjs` 发 `SIGTERM`，并拒绝任何匹配 `geth` / `beacon-chain` / `validator` / `prysm` 的 PID。网络/磁盘/WAL/Oracle/Treasury/L1 真实注入仍未开放。

## 本地验证

```bash
cd pilot
npm ci
npm run lint
npm run typecheck
npm test
npm run dry-run
```

CI 只运行上述 lint、typecheck、test、dry-run，不读取 secrets。

实际 inventory 填好后可单独执行只读预检：

```bash
npm run preflight -- --inventory /path/to/inventory.json
```

## 公开证据

- append-only NDJSON：`AppendOnlyNdjsonWriter`
- 稳定脱敏：`PublicEvidenceRedactor`
- 文件索引：`SHA256SUMS`
- manifest：`EvidenceManifestV1`
- schema：`evidence/schemas/pilot-evidence-v1.schema.json`

公开 bundle 只接受恰好五种 allowlisted 文件：`inventory.json`、`gate.json`、
`failures.ndjson`、`meter.ndjson`、`invoice.json`。构建器强制接收
`PublicEvidenceRedactor`，拒绝额外字段、未识别文件和符号链接；验证器再次校验
完整语义、文件集合、NDJSON、SHA-256 与真实路径。不得将 raw 主机、账单或凭据文件
直接放入公开证据目录。

构建与验证：

```bash
npm run bundle -- \
  --source /path/to/redacted-source \
  --output /path/to/new-public-bundle \
  --pilot-id pilot-2026-01 \
  --gate /path/to/gate.json \
  --redaction-salt public-correlation-salt

npm run verify -- --bundle /path/to/new-public-bundle
```

Bundle 输出目录必须尚不存在，避免覆盖既有公开证据。构建器会再次对 JSON/NDJSON 进行脱敏并生成 SHA-256 索引；验证器会拒绝路径穿越、hash/size 不一致及损坏的 NDJSON。

## 正式实验室已提供 / 仍缺

已提供：7 台独立主机、5+2 角色、provider / region / ASN、隔离部署目录与 72h warmup 门、跨域 TCP 27101 全网 mesh、每月 **USD 4 / 主机** 且 **流量不限** 的可归属发票（7×$4 = **$28 / 月**）。

仍缺（资格与成本 epoch 不得提前关闭）：

1. 72h warmup 完成之后的 30 天连续窗口与 100/30/100 计数。
2. 除进程崩溃外的真实故障注入审批与 runbook。
3. 公开脱敏 bundle（`invoice.json` 的 `sourceBillingRefs` 须经 `PublicEvidenceRedactor`）。
