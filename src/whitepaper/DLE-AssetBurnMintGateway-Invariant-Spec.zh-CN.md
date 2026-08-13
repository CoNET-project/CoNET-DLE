# CoNET-DLE AssetBurnMintGateway 不变量规范

**状态：** v1 规范性安全规范
**修订：** 2026-08-13
**成对译本：** [`DLE-AssetBurnMintGateway-Invariant-Spec.md`](./DLE-AssetBurnMintGateway-Invariant-Spec.md)
**适用范围：** CoNET L1 canonical `AssetBurnMintGateway` 代理、Treasury V3 DLE authority interface、全部准入 Treasury V3 规范 ERC-20、资产 tip backing 分配、普通退出与挑战式强制退出。

本文是 burn/mint 守恒与故障行为的规范性来源。双语 CoNET-DLE 白皮书只保留产品摘要；实现必须符合本规范及其可执行模型。

## 1. 记账域

全部数量使用准入资产的精确 raw integer units。Oracle 的 USDC 估值只用于准入与 tip 尺寸，不参与本金守恒。

对每个资产 \(a\)：

- `physicalBurned[a]`：规范 `TreasuryBridgeV3` authority rail 已为 DLE 证明实际 burn 的累计数量。
- `pendingBurnLiability[a]`：处于 `BURNED_PENDING` 的数量。
- `l2CreditLiability[a]`：全部 tip 当前已激活的 L2 本金负债；包括可花余额、冻结的普通退出金额，以及在对应 L1 mint 最终确认前处于挑战期的强制退出金额。
- `refundedPending[a]`：只从未激活 pending burn 重新 mint 的累计数量。
- `mintedExit[a]`：普通与强制退出最终确认后重新 mint 的累计数量。
- `reservedReplacement[a]`：其它跨链 operation、Treasury client 与外部 minter 均无法占用的 Treasury-policy 隔离 replacement 权利。

最低强制不变量：

\[
\mathrm{l2CreditLiability}(a)
+\mathrm{refundedPending}(a)
+\mathrm{mintedExit}(a)
\le \mathrm{physicalBurned}(a).
\]

v1 更强的守恒等式：

\[
\boxed{
\mathrm{physicalBurned}(a)=
\mathrm{pendingBurnLiability}(a)
+\mathrm{l2CreditLiability}(a)
+\mathrm{refundedPending}(a)
+\mathrm{mintedExit}(a)
}
\]

未履行替代义务为：

\[
\mathrm{reservedReplacement}(a)=
\mathrm{pendingBurnLiability}(a)+\mathrm{l2CreditLiability}(a).
\]

除非 Treasury V3 原子保留精确数量的排他 replacement 权利，Gateway 必须拒绝 burn。仅查看通用 token 的 `cap - totalSupply` 不充分，因为其它 bridge route 或 minter 可能占用该余量。

### 1.1 Treasury V3 规范资产边界

DLE v1 principal 仅限经规范 `TreasuryBridgeV3` 资产路径发行或登记的 CoNET L1 `TreasuryCanonicalERC20V3` proxy。Token 仅仅暴露名为 `burnFrom` 与 `mint` 的函数，并不构成准入资格。

被引用的准入版本必须绑定并验证：

```text
treasuryProxy
treasuryImplementationVersion
treasuryPolicyVersion
canonicalTokenProxy
canonicalTokenImplementationVersion
treasuryAssetKind == Canonical
dleTreasuryAdapterCodeHash
mintBurnRoleProof
replacementReservationPolicyHash
```

开发者 FX 的普通流入还要求 token 已由 `DeveloperFxIssuer` 登记且 `isForwardAllowed(token) == true`。规范 conet-USDC 遵守同一 DLE 会计与 oracle 规则，但除非其 Treasury profile 明确指定，否则不继承 developer-FX stake 语义。

职责分工是规范性的：

1. `TreasuryBridgeV3` 是唯一 token 级 DLE burn/remint authority，也是全局单次消费 treasury operation domain 的持有者。
2. `AssetBurnMintGateway` 验证 DLE oracle/AC/exit 条件并持有 receipt、right 与守恒会计；它调用 Treasury V3，且不得持有不受约束的独立 mint 路径。
3. 外链资产先完成 CoNET 去中心化国库基础设施中的独立路由。依实际部署，该路由可为 `TreasuryBridgeV3` 操作，或独立的 CREATE2 `ConetTreasury` / `ConetTreasuryPeer` 轨。所得 CoNET token 只有在 Treasury V3 将其识别为 canonical，且准入注册表激活精确 proxy/version 后，DLE 才可 burn/remint。
4. DLE 退出得到 CoNET 规范 token。之后转往 Base 或其它链是已配置国库路由上的另一笔独立操作，不能复用 DLE receipt、exit right、nonce、operation id 或 fee。

现有 Treasury V3 原语——规范 token role、managed mint/burn、miner 治理 bridge policy、排序 quorum attestation 与 `operationExecuted` replay protection——是必要条件但不是充分条件。`AssetBurnMintGateway` 与 DLE 专属 Treasury interface 是目标协议组件，不是已部署 `TreasuryBridgeV3` 合约的别名。生产还必须提供经验证的 DLE 专属 Treasury interface：限制 canonical gateway 为唯一 caller、burn 时预留 replacement capacity、暴露累计 supply 事实，并在普通 pause 或 oracle 故障下保持 refund/safety-exit mint 可用。

## 2. Tip 与 adapter epoch 记账

`l2CreditByTip[assetNftId][adapterEpoch]` 是 canonical 每 tip 负债；其中 `adapterEpoch` 标识被冻结的 Treasury proxy/policy/token-implementation/DLE-interface tuple。对每个资产：

\[
\sum_{t,e:\,\mathrm{asset}(t)=a}
\mathrm{l2CreditByTip}(t,e)
=\mathrm{l2CreditLiability}(a).
\]

内部 spillover 或 split 不得改变资产全局 credit。必须通过 L1-final `BackingReallocationV1` 原子扣减源 tip/epoch lot 并增加目标 tip/epoch lot；完成后目标才可花费：

```text
BackingReallocationV1 = {
  asset, sourceAssetNftId,
  targetAssetNftIds[],
  adapterEpoch, treasuryPolicyVersion,
  amounts[],
  sourceACRef, targetGenesisACRefs[],
  allocationNonce, membershipRoots[],
  l1ContextBlockHash
}
```

所有 amount 必须为正，总和必须等于源端扣减；全部目标必须绑定同一资产与 adapter epoch；`allocationNonce` 只能使用一次。原先 `burnedInByAssetNftId` 的表述不是充分的 backing 模型，因为新 spillover tip 没有第二次 L1 实际 burn。实现必须用当前分配的 credit liability，而不是历史 burn 来源，作为每 tip 退出上限。

V1 禁止一个 tip 混合 adapter epoch。split 保留源 epoch。新 adapter epoch 下的新流入使用新 tip，或采用另行规范的全有或全无迁移。

## 3. Receipt 状态机

```text
NONE
  -- 精确 burn + 保留替代权利 --> BURNED_PENDING

BURNED_PENDING
  -- 有效 genesis AC、deadline 前、
     oracle/admission 健康 --> ACTIVATED

BURNED_PENDING
  -- deadline 当时或之后 --> REFUNDED
```

终态分支互斥：

- `activateBurnIngress` 要求 `block.timestamp < burnActivationDeadline`。
- `refundBurnIngress` 要求 `block.timestamp >= burnActivationDeadline`。
- 两者均要求 `status == BURNED_PENDING`，并在外部 mint 调用前写入终态。
- 在精确 deadline 处只有 refund 有效；同一块的交易排序不能让两个分支都有效。
- 迟到的 genesis AC 不能重新激活已退款 receipt。
- 已激活 receipt 永远不能进入 pending-refund 路径。

状态增量：

```text
burn:       physicalBurned += amount; pendingBurnLiability += amount
activate:   pendingBurnLiability -= amount; l2CreditLiability += amount
refund:     pendingBurnLiability -= amount; refundedPending += amount
exit mint:  l2CreditLiability -= amount; mintedExit += amount
reallocate: source tip credit -= amount; target tip credit += amount
```

每个转换均保持强守恒等式。全部 Treasury V3 调用必须有 reentrancy guard。mint 前先写 accounting 与 nullifier；Treasury mint 失败时整笔交易回滚。

## 4. Genesis 永久失败与激活

如果 burn 对应的 genesis 永远未 final，则该 burn 始终不可花。deadline 后任何人都可触发向原 burner 精确退款；调用者不得改变收款人。退款路径：

1. 校验 receipt 与终态边界；
2. 标记 `REFUNDED`、消耗 burn id，并把 pending 记账移到 `refundedPending`；
3. 消耗该 receipt 的 Treasury-reserved replacement 权利与另一份单次使用的 `treasuryOperationId`；
4. 使用 receipt 绑定的 Treasury policy/adapter epoch 向 `from` 精确 mint 规范数量；
5. 任一步或 mint 失败时原子回滚。

AC 本身不足以创造 credit。只有 tip FSM gapless 消费了 L1-final `BurnIngressActivated` 事件后，才存在可花 credit。

## 5. 普通/强制退出共享权利状态

普通与强制退出不得对同一余额使用相互独立的 replay 域。两者共用：

```text
exitRightId = H(
  "dle.asset.exit-right.v1",
  assetNftId, owner, asset,
  balanceEpoch, sourceStateRoot,
  amount, positionNonce
)

ExitRightStatus =
  NONE | NORMAL_PENDING | FORCE_CHALLENGE |
  CONSUMED | CANCELLED | SUPERSEDED_BY_FORCE
```

规则：

1. 普通请求原子地从可花余额移除 amount，并置 `NORMAL_PENDING`。
2. 强制请求只能申领尚未被普通请求保留的 credit。
3. 普通退出超过规定时限后，强制请求可接管完全相同的 `exitRightId`，并原子标记普通请求为 `SUPERSEDED_BY_FORCE`；不得创建第二份权利。
4. 普通和强制 finalizer 都要求权利未消耗；mint 前标记 `CONSUMED`，扣减 `l2CreditByTip` / `l2CreditLiability`，增加 `mintedExit` 并推进 `mintSequence`。
5. 相同 right、claim id、exit nonce 或 mint sequence 的第二笔交易必须 revert，或无 mint 地幂等返回。
6. 不同 stale proof 也不能透支：每次 mint 还必须同时受当前每 tip credit 和资产全局 `l2CreditLiability` 限制。

## 6. AC 新鲜度与动态名册

每份退出证明绑定 `archiveGroupId`、`membershipEpoch`、`membershipRoot`、`keyEpoch`、`tipHeight`、`parentArchiveCertificateHash` 与 L1 context。

- Gateway 维护单调的 `latestKnownAC[assetNftId]`。
- 普通退出 certificate 必须等于或后继于最新已知 AC，并保留完全相同的 pending debit。
- 强制退出 challenge 可用严格更新的后继 AC 替换提交证明。
- superseded branch、非后继的更高高度、混合 membership QC、低于 freshness floor 的 AC 一律拒绝。
- Membership 切换遵守 Tendermint 向量规范；旧 root 签名不能授权 activation height 及其后的退出。

Oracle freshness 不等于 AC freshness。本金退出按精确资产单位计价，不得依赖 oracle quote。

## 7. Treasury/adapter 升级与 mint-cap 安全

每个 pending receipt 与每份 tip liability 绑定：

```text
adapterEpoch
adapterCodeHash
treasuryProxy
treasuryPolicyVersion
canonicalTokenProxy
canonicalTokenImplementationVersion
burnCapabilityHash
mintCapabilityHash
mintAuthorityProof
reservedReplacement
```

只有以下任一条件成立时才允许升级：

1. 旧 epoch 的 `pendingBurnLiability + l2CreditLiability` 为零；
2. 旧 Treasury policy/token implementation/DLE adapter 作为不可改的 `EXIT_ONLY` 路径保留到负债归零；或
3. 原子迁移把精确 Treasury-reserved replacement 权利转给新 epoch，并证明等价的精确 mint 权限。

治理不得用新 Treasury/token/adapter tuple 重新解释旧 receipt、把 reserved capacity 降到未偿负债以下、撤销旧退出路径或复用 epoch。升级期间暂停新 burn。每次 activation、refund、reallocation、exit 都检查 Treasury proxy、policy version、规范 token proxy/implementation、DLE adapter code hash 与 epoch。

以下资产不具备准入资格：

- 其它 Treasury route 或外部 minter 可占用 DLE replacement quota；
- 第三方可永久撤销被冻结的 Treasury safety-mint 路径；
- 全局 token 或 Treasury pause 可阻塞 refund/final exit，且不存在协议控制、timelock、pause-exempt 的安全路径；
- mint 语义含 fee、rebase、callback 歧义或不能精确执行。

## 8. Pause、oracle breaker 与 mint 失败

Pause 控制必须非对称：

- `INGRESS_PAUSED` 阻止新 burn 与 activation。
- `TRANSFER_PAUSED` 阻止普通 L2 transfer/reallocation。
- 两者都不得阻止 pending refund、full normal exit、挑战式 force exit 或已 final mint retry。
- 任何治理 pause 函数都不得在未精确 mint 时删除 claim 或消耗 nonce。

Oracle 熔断时：

- 新 burn、activation、普通 transfer 与依赖价值的 spillover 停止；
- 精确单位的 full normal exit 仍有效；
- force exit 仍有效，并使用 `emergencyReserveUsdc6`；
- 需要价值 floor 检查的 partial normal exit 改走 full exit 或 force exit，不得没收。

Treasury mint 暂时失败时，交易回滚且权利保持未消费。重试必须使用相同 id 与 amount。除非完成明确的 adapter-epoch 迁移，否则不得替换 Treasury policy、token implementation、adapter、收款人或数量。

## 9. Replay 与 nonce 域

- `burnNonce` 按 `(asset, burner)` 单调；`burnId` 由合约派生且单次使用。
- `treasuryOperationId` 由 `{treasuryProxy, gateway, canonicalToken, action, burnId|exitRightId, amount, recipient, treasuryPolicyVersion}` 派生，并在 Treasury V3 DLE domain 全局单次使用。
- `allocationNonce` 按源 tip 单调。
- L2 `eventNonce` 按 `(assetNftId, owner, eventDomain)` 单调并提交进 state root。
- `exitNonce` 按 `(assetNftId, owner)` 单调，但不能替代 `exitRightId`。
- `claimId` 与 force-exit nullifier 是同一 `exitRightId` 的确定性别名。
- `mintSequence` 按 tip 严格递增，并由 L2 FSM gapless 消费。
- 完全相同的重复提交必须幂等/拒绝；冲突重复产生 evidence，禁止“最后写入获胜”。

## 10. 强制形式化验证发布门

生产部署前必须全部通过：

1. **TLA+/TLC 状态模型：** `DLEAssetBurnMintGateway.tla` 在有界并发 trace 中检查守恒、receipt 级记账、activation/refund 边界、credit 到 exit-right 的唯一绑定、activation/claim replay domain、普通/强制退出竞争、stale AC、pause/oracle 下安全退出活性、capacity 耗尽及保守的零未偿负债 adapter-upgrade 分支。其抽象 adapter epoch 表示被冻结的 Treasury proxy/policy/token-implementation/DLE-interface tuple；`EXIT_ONLY` 共存、treasury-operation replay 与 reservation 原子迁移仍必须另做 Solidity 级属性证明。
2. **Solidity 属性证明器：** Certora、Halmos 或等价工具检查所有 public/external transition 后的强守恒等式，并证明每份 right 最多 mint 一次。
3. **有状态 fuzz：** Foundry/Echidna handler 交错执行 Treasury burn、activation、refund、normal exit、force challenge/finalize、reallocation、pause、oracle breaker、Treasury/token/adapter upgrade、重复 treasury operation 与恶意 token callback。
4. **Treasury DLE conformance：** 用 success、revert、reentrancy、short mint、over-mint、stale policy、duplicate operation 与 callback mock 检查精确 supply delta、全局单次 operation id、gateway-only authority、排他 replacement reservation、pause-exempt refund/exit、developer-FX qualification 与 proxy/policy/token/code-hash/epoch 绑定。
5. **差分记账：** 每条生成 trace 后，事件派生 ledger、合约 storage 与 reference model 必须一致。

**有界参考模型结果（2026-08-13）。** TLC 2026-08-11（rev `0894c34`）已完成仓库配置：两个 receipt、两个 exit right、mint capacity 为二、`MaxAC=2`、`MaxAdapterEpoch=2`；结果为 **生成 612,105 个状态、73,184 个 distinct state、深度 18、剩余状态为零，且无不变量违反**。该结果只关闭有界规范检查；不证明任意 `uint256` 金额、Solidity storage/layout、真实 adapter 或密码学 proof verification。

强制场景语料包括：

- genesis 永不 final，随后 refund；
- deadline block 同时提交 activation 与 refund；
- normal exit 对 force exit，以及 force 接管超时 normal right；
- stale/non-descendant AC 与旧/新 membership-root 冲突；
- Treasury proxy/policy/token-implementation/DLE-adapter 在仍有 pending/activated liability 时升级；
- mint capacity 耗尽、被外部占用或其它 route 试图窃取 reservation；
- ingress/transfer pause 时 refund 与 exit 仍可用；
- oracle breaker 时 full normal 与 force exit 仍可用；
- 重复 burn receipt、treasury operation id、event nonce、allocation nonce、exit nonce、claim id 与 mint sequence；
- Treasury mint revert 后使用不变 right 与 policy tuple 重试。

任何 counterexample 都是发布阻断。发现 counterexample 后治理可以暂停新流入，但不得对既有负债豁免守恒或安全退出属性。
