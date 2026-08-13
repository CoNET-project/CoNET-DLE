# CoNET-DLE OperatorDomainRegistryV1 规范

**状态：** v1 规范性身份/相关性规范
**修订：** 2026-08-13
**成对译本：** [`DLE-OperatorDomainRegistryV1-Spec.md`](./DLE-OperatorDomainRegistryV1-Spec.md)
**适用范围：** Archive 准入、5 active + 2 standby 成组、轮换、托管 tip 验证人选择、挑战/裁决、收益敞口、冷静期与相关风险报告。

本规范把运营者独立性判断从治理自由裁量的白皮书文字中拆出，明确哪些规则机械执行、哪些需要受证明的外部证据、如何处理未知，以及哪个确定性结果在 L1 生效。

## 1. 安全主张与明确边界

不同 EOA、archive NFT、hostname、cloud account 或 legal name 都不能证明控制独立。`OperatorDomainRegistryV1` 用于降低隐藏共同控制与相关基础设施风险；它不能用密码学证明匿名参与者必然是不同自然人或公司。

因此：

- 客观密码学/关联规则自动执行；
- 非密码学证据只按版本化裁决策略处理；
- mandatory evidence 缺失、过期、有争议或不可验证时均为 `UNKNOWN`，绝非 `INDEPENDENT`；
- Governance 不得绕过本状态机手工把两个身份标成独立。

## 2. Canonical 标识与记录

```text
OperatorRecordV1 {
  canonicalOperatorId,
  operatorCredentialCommitment,
  beneficialControlCommitment,
  stakeControllerCommitment,
  archiveNftIds[],
  validatorIds[],
  infrastructureClaimIds[],
  status,
  operatorPolicyVersion,
  evidenceVersion,
  validFromL1Block,
  validUntilL1Block,
  lastDecisionId
}

InfrastructureClaimV1 {
  claimId,
  exactTenantOrAttestationRoot,
  asn,
  providerId,
  regionId,
  metroId,
  facilityOrPowerDomainId,
  keyCustodyDomainId,
  softwareSupplyChainId,
  evidenceCommitment,
  attestorSetId,
  issuedAt,
  expiresAt
}
```

`canonicalOperatorId` 是 finalized registry decision 产生的身份，不从 EOA 直接推导。Alias record 把全部已知 archive/validator/stake identity 唯一映射到一个 canonical operator。

## 3. 三个互相独立的域

| 域 | 必须承诺/证明 | 协议直接用途 |
| --- | --- | --- |
| **身份/控制** | credential/nullifier、stake controller、beneficial-control commitment、已证明 alias | 一个 canonical operator 在全部 live group 的 archive active-or-standby 席位合计最多一席 |
| **基础设施** | exact tenant/attestation root、ASN/provider、region/metro、facility/power、custody 与 software-supply domain | 同一 5+2 组禁止 exact tenant/root 复用；同一声明 ASN/provider、region/metro 或 power domain 最多占七席中的两席 |
| **角色** | 按 canonical operator 索引 archive NFT 与 validator identity | Hosting-group archive operator 不得验证该组 tip；同一 validator committee 每个 canonical operator 最多一席 |

通过一个域不能替代另一个域。不同法律实体共享 exact tenant 时仍违反 tenant 规则；不同 tenant 由一个已证明 beneficial controller 控制时仍违反 operator 规则。

## 4. 状态与状态机

```text
UNREGISTERED
  → PROVISIONAL
  → ACTIVE
  → CHALLENGED
  → ACTIVE | MERGED | SUSPENDED
  → COOLDOWN
  → ACTIVE | EXITED
```

- `PROVISIONAL`：evidence 已提交但未 final；不得占 active/standby/validator seat。
- `ACTIVE`：全部 mandatory evidence 当前有效，且无 blocking challenge。
- `CHALLENGED`：冻结新 assignment 与轮入席位；现有 consensus authority 继续服从当前 L1 membership root，直到 membership switch。
- `MERGED`：为 exposure、multiplicity、cooldown 与 sanction 把 alias 不可逆映射到一个 canonical operator；以后拆分必须有新的 evidence/adjudication decision，且永不改写历史 root。
- `SUSPENDED`：evidence 过期、冲突或 adjudication 不可用；不得新分配。
- `COOLDOWN`：operator 及全部 alias 在 L1 deadline 前不合格。

Registry decision 不直接改写 active consensus roster。移除席位必须走正常原子 membership-switch 协议。

## 5. 确定性准入裁决

对 candidate set \(C\)，`evaluateCandidateSet(policyVersion, evidenceRoot, C)` 只能返回：

```text
ELIGIBLE
INELIGIBLE(reasonCode, conflictIds[])
UNKNOWN(reasonCode, missingOrDisputedIds[])
```

Formation/rotation 只有 `ELIGIBLE` 才能继续；`UNKNOWN` fail closed。

评估顺序固定：

1. 验证 L1-final policy/evidence version 与有效期；
2. 把每个 identity 解析为 canonical operator；
3. 拒绝重复 canonical operator 或 cooldown alias；
4. 拒绝 exact tenant/attestation-root 复用；
5. 执行版本化 infrastructure concentration cap；
6. 执行 archive/validator role exclusion；
7. 拒绝未解决 active challenge 与冲突 evidence；
8. 对排序后的 candidate leaf 和 decision input 做 commitment。

实现不得使用 RPC 到达顺序、本地 allowlist、reputation UI 或 governance 人工偏好作为 tie-break。

## 6. Attestor 与证据类别

L1 policy 冻结：

- `attestorSetId` 与 threshold；
- 可接受 evidence schema 与 issuer；
- 有效/刷新期限；
- conflict-of-interest 排斥；
- challenge bond、response、decision 与 appeal 期限；
- objective merge 与 adjudicated merge 规则；
- negligent stale data 与 intentional concealment 的不同 sanction。

Evidence 分三类：

1. **客观关联：** 相同 credential/nullifier、attestation key/root、stake controller、mutually authenticated control proof 或其它 policy-defined cryptographic equality。Threshold-valid 证明足以自动 merge。
2. **受证明的结构化事实：** 由批准的独立 attestor 签署 cloud tenant、legal entity、beneficial controller、facility/power、custody provider 或 supply-chain claim。
3. **自由叙述指控：** 无法验证的材料自身不能 merge identity；只能开启 challenge 并要求结构化 evidence。

Attestor 不得证明其自身 operator、infrastructure 或 legal-control domain；threshold 计算排除 conflicted attestor。

## 7. 挑战与裁决

```text
OPEN → RESPONSE → EVIDENCE_FROZEN → DECIDED → APPEALABLE → FINAL
```

`ChallengeV1` 绑定：

```text
challengeId, policyVersion, evidenceVersion,
challenger, accusedOperatorIds[],
claimType, evidenceCommitment,
openedAt, responseDeadline,
evidenceFreezeBlock, decisionDeadline,
bond, requestedRemedy
```

规则：

- duplicate challenge 使用 `challengeId`/evidence nullifier，不得重置期限；
- adjudicator commit vote 前，evidence 必须在 finalized L1 block 冻结；
- 从预冻结 eligible set 配合未来 finalized beacon 确定性选择 adjudicator；
- vote 绑定完整 evidence root 与 policy version；
- quorum/threshold 由 policy 固定，不按个案选择；
- timeout 导致 `UNKNOWN/SUSPENDED`，不是无罪；
- appeal 必须有新 evidence root 或可证明 procedure fault，并尽可能使用不相交 adjudicator set；
- final decision 可从 L1 input replay，并发出一个单调 `decisionId`。

## 8. 裁决效果

Final merge decision 原子执行：

1. 把全部 alias 映射到一个 `canonicalOperatorId`；
2. 聚合 archive、validator、stake、reward、exposure 与 cooldown record；
3. 冻结全部 alias 的新 assignment；
4. 为冲突席位开启确定性 replacement；
5. 追回 hidden multiplicity 对应的未分配收益；
6. 执行 policy-defined concealment slash；
7. 标记历史 root 污染，但不改写 finalized AC。

Live group 若变为 policy-invalid，则进入 `DOMAIN_REMEDIATION`：现有 finality 只在当前 membership root 下继续，新 tip assignment 冻结，并须在有界窗口启动 membership switch/re-home。Governance 不得静默豁免。

## 9. Root 与版本绑定

每个 membership leaf 绑定：

```text
archiveNftId, signingKey,
canonicalOperatorId,
operatorRecordHash,
infrastructureClaimHash,
roleDomainHash,
operatorPolicyVersion,
evidenceVersion
```

`operatorDomainRoot` 与 `infrastructurePolicyRoot` 被纳入 group formation、membership update，并通过 `membershipRoot` 进入全部 consensus vote/certificate。

Policy upgrade：

- 通过 delayed L1 activation；
- 永不改变 historical root 的解释；
- 只从 activation height 影响 eligibility；
- 不允许 old/new policy version 在同一高度同时 authoritative；
- 下一次 formation/rotation 前必须重新评估。

## 10. 保守相关性会计

Registry eligibility 不等于 statistical independence。Risk report 必须保守聚合 unknown/disputed evidence，并公布以下 exposure：

- canonical operator；
- exact tenant/attestation root；
- provider/ASN；
- region/metro；
- facility/power；
- key custody；
- software image/supply chain；
- legal/beneficial-control domain；
- archive↔validator overlap。

未知字段在解决前计入最保守的适用 bucket。Dashboard label 永不覆盖 L1 eligibility。

## 11. 强制测试向量与发布门

实现测试必须包含：

1. 不同 EOA/NFT、相同 objective credential ⇒ merge；
2. 不同 legal entity、相同 exact tenant ⇒ group rejection；
3. 同一 operator 同时使用 archive 与 hosted-tip validator identity ⇒ role rejection；
4. stale/missing attestation ⇒ `UNKNOWN`，非 eligible；
5. conflicting attestor ⇒ challenge/suspension；
6. duplicate challenge/evidence nullifier ⇒ 幂等拒绝；
7. challenge timeout ⇒ suspended，不是 exonerated；
8. evidence 未变的 appeal ⇒ 拒绝；
9. policy switch activation height ⇒ 无 mixed-version root；
10. formation 后 merge ⇒ assignment freeze + membership remediation，不改写 AC；
11. conflicted attestor 从 quorum 排除；
12. 不同 RPC/event arrival order 下确定性 replay ⇒ 相同 decision/root。

生产要求跨实现 root 一致、对抗式 challenge 测试，以及通过审计的 upgrade/appeal 路径。

## 12. 禁止实现者自由裁量

- 禁止用 EOA/NFT 唯一性证明独立。
- 禁止 `UNKNOWN → INDEPENDENT` fallback。
- 禁止无 evidence commitment、versioned policy 与 replayable decision 的 governance-only alias merge。
- 禁止本地 node/operator allowlist 覆盖 L1 state。
- 禁止 bootstrap、standby、emergency rotation 或 validator selection 的静默例外。
- 禁止后续 identity decision 改写 historical membership root 或 finalized certificate。
