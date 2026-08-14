# CoNET-DLE Archive Tendermint 一致性规范

**状态：** 规范性草案；可执行 v2 语料与 Archive A MVP 已冻结，生产互操作闭环尚未完成
**修订：** 2026-08-13
**成对译本：** [`DLE-Archive-Tendermint-Conformance-Spec.md`](./DLE-Archive-Tendermint-Conformance-Spec.md)
**遗留不可变向量：** [`DLE-Archive-Tendermint-Vectors-v1.json`](./DLE-Archive-Tendermint-Vectors-v1.json)
**规范可执行语料：** [`../../conformance/corpus/DLE-Archive-Tendermint-Vectors-v2.json`](../../conformance/corpus/DLE-Archive-Tendermint-Vectors-v2.json)
**Schema：** [`../../conformance/schema/dle-archive-tendermint-corpus-v2.schema.json`](../../conformance/schema/dle-archive-tendermint-corpus-v2.schema.json)
**SHA-256 manifest：** [`../../conformance/DLE-Archive-Tendermint-Corpus-v2.sha256`](../../conformance/DLE-Archive-Tendermint-Corpus-v2.sha256)

本规范冻结白皮书摘要对应的字节级与状态转换行为。Archive 实现只有通过完整向量语料后，才可在生产 membership root 下投票。

## 1. 范围与不可协商基线

- Active roster 固定为五个 archive voter，Byzantine bound \(f=1\)，quorum \(Q_A=4/5\)，另有两个不投票的 ready standby。
- Finality：Tendermint 风格 `Proposal → PrevoteQC → PrecommitQC (= ArchiveCertificate)`。
- Archive coordinator 只引用不可变的 validator-produced candidate；archive 永不生产或修改 block。
- 共识 sign bytes 使用 canonical SSZ；Protobuf 仅作传输。
- 每张 vote 绑定 `membershipEpoch`、`membershipRoot` 与 `keyEpoch`。
- 每个安全状态转换必须先持久写入 WAL，再网络发送。

## 2. Canonical 向量产物

`DLE-Archive-Tendermint-Vectors-v1.json` 继续作为不可变兼容产物。其六个 Proposal/Vote 向量逐字节嵌入规范性 `conformance/corpus/DLE-Archive-Tendermint-Vectors-v2.json`。v2 语料另含：

1. 以下对象的精确 SSZ bytes、SSZ `hash_tree_root` 与 signing root：
   - 无 valid round 的 proposal；
   - 携带 valid-round QC 的 proposal；
   - non-nil prevote；
   - nil prevote；
   - 绑定 PrevoteQC 的 non-nil precommit；
   - nil precommit；
2. 带顺序输入、输出、错误、终态与 state root 的机器可读 lock/valid-round 状态转换；
3. 固定 `PrevoteQC`、`ArchiveCertificate`、`TimeoutCertificate`、`CandidateRejectCertificate` container 与 golden root；
4. 字节精确的 WAL safety record/frame，以及损坏/截断尾部结果；
5. coordinator 选择、membership activation/rejection 与 `CandidateRejectCertificate` 冲突案例；
6. 字节精确的系统型 RS `(7,4)` 向量、DA root 与全部 35 组四分片重建集合；
7. 确定性的 `5 active + 2 ready standby` 计划退出生命周期。

实现必须直接把 v2 JSON 作为测试输入，并用仓库内 schema 校验。可转换成实现语言的 fixture，但 CI 必须先验证其与仓库产物及 SHA-256 manifest 逐字节一致。

## 3. SSZ 与签名规则

Canonical container 与字段顺序以白皮书 §5.2.1 为准；向量文件冻结具体序列化结果。

- unsigned integer 为固定宽度 little-endian；
- `Bytes32` 恰好 32 bytes；
- container root 使用 SSZ SHA-256 merkleization；
- `signingRoot = keccak256(UTF8(domainTag) || hash_tree_root(object))`；
- decode 必须消费全部 bytes；
- unknown version、unknown field、trailing bytes、host-endian 数、omitted default、map 与 JSON sign bytes 均拒绝；
- `0x00…00` 是唯一 nil value；
- `NONE=0xffffffff` 只允许用于 `validRoundOrNone` / `lockedRoundOrNone`；
- non-nil precommit vote 必须全部绑定完全相同的非零 `prevoteQCRef`。

Canonical bytes、object root、signing root、domain tag、membership root 或 key epoch 任一不一致都属于共识无效，不是可容忍的传输差异。

## 4. Nil vote 向量

Nil 是有签名的 round-progress vote，不是第二个 candidate。

- proposal 缺失、无效、不可用或 lock conflict ⇒ 持久化并发送 `Prevote(nil)`。
- 4/5 nil prevote QC 或 prevote timeout ⇒ 保留全部旧 lock/valid 字段并发送 `Precommit(nil)`。
- 4/5 nil precommit QC 或有效 precommit timeout certificate ⇒ 进入下一 round，继续保留 lock/valid。
- Nil QC 永不解锁旧 value。
- 协议要求 nil vote 时静默 abstain 的实现不符合 liveness，并可能形成可验证 non-participation evidence。

## 5. `lockedRound` / `validRound`

强制向量冻结：

1. unlocked 的首个 proposal：prevote 有效 proposal value；
2. 与 lock 同 value：prevote proposal value；
3. 冲突 proposal 没有高于 `lockedRound` 的 QC：prevote nil 并保留 lock；
4. 冲突 proposal 携带 `validRound > lockedRound` 的有效 non-nil PrevoteQC：prevote 被 justify 的 value；
5. 仅收到 proposal/justify QC 不改变 lock；
6. 只有当前 round 的 non-nil 4/5 PrevoteQC 才更新 `validValue/validRound`、`lockedValue/lockedRound` 并授权 non-nil precommit；
7. timeout certificate 只推进 round，永不解锁。

## 6. WAL crash/restart

WAL record 必须原子包含：

```text
domain, height, round, step,
exact canonical sign bytes,
signing root, signature,
proposal hash,
lockedValue/lockedRound,
validValue/validRound,
QC/TC references,
membershipEpoch/root, keyEpoch
```

必须覆盖 fsync 前、fsync 后/send 前、partial send 后、peer receipt 后、QC observation 后与 AC persistence 后等 crash point。

- 没有 durable vote 时，restart 可按正常 transition 重新决策。
- 已有 durable vote 时，只能重传 byte-identical bytes/signature。
- 同一 `(domain,height,round,step)` 的不同 vote 以 `ERR_WAL_DOUBLE_SIGN` 拒绝。
- WAL 损坏/不完整时进入 non-voting recovery。节点可提供 read，但在从至少四个当前成员同步 current AC、membership/key epoch、lock/valid state 与 QC 前不得签名。
- 只有 AC 与 committed-height transition 都 durable 后，才能把 AC 作为 final 对外服务。

## 7. 动态名册 activation 向量

对于 old root `M0` 在高度 \(H\) final、`activationHeight=H+1` 的更新：

- 高度 \(H\)：仅 `M0` 与旧 `keyEpoch` 的 vote 有效；
- 高度 \(H+1\)：仅 `M1` 与新 `keyEpoch` 的 vote 有效；
- mixed-root 或 mixed-key-epoch QC 永远无效；
- old/new root 在同一高度永远不能同时拥有 write authority；
- L1 membership switch 必须先 final，honest node 才能签高度 \(H+1\)。

如果节点看到同一 group/activation height 的两个不同 finalized-L1 checkpoint 声明，不得按 RPC 到达顺序选择。节点以 `ERR_AMBIGUOUS_L1_MEMBERSHIP_CHECKPOINT` 进入 non-voting recovery，直到解析出唯一 canonical L1 checkpoint。

## 8. Candidate reject 与 accept

`CandidateRejectCertificate` 是带 evidence 的 veto object，不是 Tendermint ledger value。

- 同一 `(chainNftId, tipHeight, candidateId, attemptNonce, membershipEpoch)` 同时获得 reject certificate 与 non-nil PrevoteQC 时，冻结 height，并以 `ERR_REJECT_ACCEPT_CONFLICT` 进入 L1 dispute。
- 到达顺序、round number 或“哪边签名更多”都不能选 winner。
- 有效 AC 已存在后才到达 reject certificate，archive 永不本地 rollback；应发布 `BadFinalityEvidence`，证据成立时冻结 L1 spendability 并进入 dispute/re-home。
- Reject signature 与 accept vote 必须绑定同一 candidate/attempt/membership conflict domain，archive 不得声称二者互不相关。

## 9. 强制 rejection code

Wire/API 可包装这些值，但语义 code 固定：

- `ERR_INVALID_CANONICAL_SSZ`
- `ERR_SIGNING_ROOT_MISMATCH`
- `ERR_NIL_ENCODING`
- `ERR_INVALID_VALID_ROUND`
- `ERR_LOCK_CONFLICT`
- `ERR_WAL_DOUBLE_SIGN`
- `ERR_WAL_RECOVERY_REQUIRED`
- `ERR_MEMBERSHIP_NOT_ACTIVE`
- `ERR_MEMBERSHIP_ROOT_MISMATCH`
- `ERR_MIXED_MEMBERSHIP_ROOT`
- `ERR_KEY_EPOCH_MISMATCH`
- `ERR_AMBIGUOUS_L1_MEMBERSHIP_CHECKPOINT`
- `ERR_REJECT_ACCEPT_CONFLICT`
- `ERR_REJECT_AFTER_FINALITY`

实现不得把 safety fault 折叠成普通 timeout 或静默忽略。

## 10. 跨实现发布门

生产发布要求：

1. 至少两个独立语言实现推导出全部已发布 SSZ byte/root；
2. 确定性 replay 每个 semantic vector；
3. 在全部 WAL 边界做 crash injection；
4. 对 duplicate signer、mixed root、畸形 bitmap/list、错误 QC child root 与重复 signature 做 Byzantine 测试；
5. 在 \(H-1,H,H+1,H+2\) 做动态 membership 测试；
6. 在 QC 前、QC 后、AC 前、AC 后做 reject/accept conflict 测试；
7. CI 校验 corpus hash；修改向量必须经过 protocol-version/revision 审查。

Archive A 会重算六个不可变 v1 Proposal/Vote 向量与全部 v2 certificate 字节/root，校验 JSON Schema，确定性 replay v2 FSM/生命周期向量，验证 WAL 损坏行为，并从全部 35 种 4-of-7 子集重建每个 RS 向量。这仍不能替代强制要求的第二个生产语言实现。

任何一个向量不一致的实现都不得签 production `dle.archive.tendermint.v1` 对象。

## 11. 已冻结 v2 机器边界与剩余发布阻塞项

第一批可执行实现冻结下列规则。实现必须从 v2 语料读取精确值，不得从本摘要手抄：

1. **Certificate 与引用。** Certificate kind 固定为 `PrevoteQC=1`、`ArchiveCertificate=2`、`TimeoutCertificate=3`、`CandidateRejectCertificate=4`。每张 certificate 有五个规范 active-signer slot、bitmap 位 `0..4`、65-byte signature、零填充的未签名 signature slot，且 popcount 至少为四。Standby 永不占 certificate signer slot。引用为 `SHA-256(UTF8("dle.archive.certref.v2") || uint8(kind) || hash_tree_root(certificate))`。
2. **Signing root。** Fixed-container root 使用 SSZ SHA-256 merkleization。Signing root 继续为 `keccak256(UTF8(domainTag) || hash_tree_root(object))`；v2 语料分别冻结 QC、AC、TC、Reject 的 domain tag 与 golden root。
3. **Coordinator。** 五个 active `Bytes32` member ID 按无符号 bytewise 升序排序。选择 preimage 为 `UTF8("dle.archive.coordinator.v1")`，随后依次拼接 little-endian `archiveGroupId:uint64`、`chainNftId:uint256`、`tipHeight:uint64`、`attemptNonce:uint64`、`membershipRoot:Bytes32`、`round:uint32`。候选为 `SHA-256(preimage || counter:uint32le)`；取低 64 位并按 little-endian 解释，在 `floor(2^64/5)*5` 以下做 rejection sampling，再 modulo five。
4. **WAL。** Frame 为 `DLEW || version:uint16le || flags:uint16le || sequence:uint64le || payloadLength:uint32le || SHA-256(payload) || payload || SHA-256(header||payload)`。Safety-record payload 包含精确 canonical sign bytes、root、65-byte signature、proposal/lock/valid/QC/TC state、membership/key epoch 与 committed height。`fsync` 是 emit 边界。同一 `(domain,height,round,step)` 的字节不同 record 返回 `ERR_WAL_DOUBLE_SIGN`；损坏或截断尾部必须进入 non-voting recovery。
5. **Error 与 reject reason。** 该版本的全集是语料中的 `errorEnums` 与 `rejectReasons`。每个 reject reason 都要求非零 evidence hash。
6. **RS `(7,4)` 与 DA。** `dle.rs.v1` 使用语料内固定的系统型 generator matrix，域为 `GF(2^8)`，primitive polynomial 为 `0x11d`。输入 frame 为 `uint64le(bodyLength)||body||zero-padding`。Domain-separated SHA-256 leaf/branch 规则及第八个 pad leaf 均由语料固定。全部 35 种四分片子集必须重建出精确 body。
7. **可执行语义与 5+2 生命周期。** FSM 与 lifecycle vector 是顺序数据，不是自然语言。State root 绑定全部安全字段。计划退出向量只以有序 `standby[0]` 替换一个 active slot，同时增加两个 epoch、保留四名 active、前移 `standby[1]`，且不降低 quorum。

仍有以下生产阻塞项：

1. 冻结 L1 验证所用的唯一 canonical EIP-712 wrapper，包括 secp256k1 signature 是签该 wrapper 还是直接签 SSZ 派生 root；实现不得自造映射，也不得要求两份独立语义 signature；
2. 由第二套独立生产语言实现复现完整 schema/corpus，并运行跨进程 differential test；
3. 在确定性 core 外补齐生产 networking、key custody/rotation、L1 checkpoint 验证、signature recovery 与 crash-injection integration。

在这些阻塞项闭合前，不得启用任何生产 archive signer。
