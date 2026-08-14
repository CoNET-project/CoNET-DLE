# CoNET-DLE Archive Tendermint Conformance Specification

**Status:** Normative draft; executable v2 corpus and Archive A MVP frozen, production interoperability closure incomplete
**Revision:** 2026-08-13
**Paired translation:** [`DLE-Archive-Tendermint-Conformance-Spec.zh-CN.md`](./DLE-Archive-Tendermint-Conformance-Spec.zh-CN.md)
**Legacy immutable vectors:** [`DLE-Archive-Tendermint-Vectors-v1.json`](./DLE-Archive-Tendermint-Vectors-v1.json)
**Canonical executable corpus:** [`../../conformance/corpus/DLE-Archive-Tendermint-Vectors-v2.json`](../../conformance/corpus/DLE-Archive-Tendermint-Vectors-v2.json)
**Schema:** [`../../conformance/schema/dle-archive-tendermint-corpus-v2.schema.json`](../../conformance/schema/dle-archive-tendermint-corpus-v2.schema.json)
**SHA-256 manifest:** [`../../conformance/DLE-Archive-Tendermint-Corpus-v2.sha256`](../../conformance/DLE-Archive-Tendermint-Corpus-v2.sha256)

This specification freezes the byte-level and state-transition behavior that the whitepaper summarizes. A compatible archive implementation MUST pass the complete vector corpus before it may vote on a production membership root.

## 1. Scope and non-negotiable baseline

- Active roster: exactly five archive voters, Byzantine bound \(f=1\), quorum \(Q_A=4/5\), plus two non-voting ready standbys.
- Finality: Tendermint-style `Proposal → PrevoteQC → PrecommitQC (= ArchiveCertificate)`.
- Archive coordinator references an immutable validator-produced candidate; archives never produce or mutate blocks.
- Consensus sign bytes are canonical SSZ. Protobuf is transport-only.
- Each vote binds `membershipEpoch`, `membershipRoot`, and `keyEpoch`.
- Every safety transition is durably written to the WAL before network transmission.

## 2. Canonical vector artifact

`DLE-Archive-Tendermint-Vectors-v1.json` remains an immutable compatibility artifact. Its six Proposal/Vote vectors are embedded byte-for-byte in the normative `conformance/corpus/DLE-Archive-Tendermint-Vectors-v2.json`. The v2 corpus additionally contains:

1. exact SSZ bytes, SSZ `hash_tree_root`, and signing root for:
   - proposal without a valid round;
   - proposal carrying a valid-round QC;
   - non-nil prevote;
   - nil prevote;
   - non-nil precommit bound to a PrevoteQC;
   - nil precommit;
2. machine-readable lock/valid-round state transitions with ordered inputs, outputs, errors, final states, and state roots;
3. fixed `PrevoteQC`, `ArchiveCertificate`, `TimeoutCertificate`, and `CandidateRejectCertificate` containers and golden roots;
4. byte-exact WAL safety records and frames, including corrupt/truncated-tail outcomes;
5. coordinator selection, membership activation/rejection, and `CandidateRejectCertificate` conflict cases;
6. byte-exact systematic RS `(7,4)` vectors, DA roots, and all 35 four-shard reconstruction sets;
7. the deterministic `5 active + 2 ready standby` planned-exit lifecycle.

Implementations MUST consume the v2 JSON artifact as test input and validate it against the checked-in schema. Re-keying it into implementation-native fixtures is allowed only if CI first verifies byte-for-byte equality with the checked-in artifact and SHA-256 manifest.

## 3. SSZ and signature rules

The canonical containers and field order are those in §5.2.1 of the whitepaper. The vector artifact fixes their concrete serialization.

- unsigned integers are fixed-width little-endian;
- `Bytes32` is exactly 32 bytes;
- container roots use SSZ SHA-256 merkleization;
- `signingRoot = keccak256(UTF8(domainTag) || hash_tree_root(object))`;
- decoding must consume all bytes;
- unknown versions, unknown fields, trailing bytes, host-endian numbers, omitted defaults, maps, and JSON sign bytes are rejected;
- `0x00…00` is the only nil value;
- `NONE=0xffffffff` is valid only in `validRoundOrNone` / `lockedRoundOrNone`;
- non-nil precommit votes must all bind the identical non-zero `prevoteQCRef`.

Any mismatch in canonical bytes, object root, signing root, domain tag, membership root, or key epoch is consensus-invalid—not a recoverable transport variation.

## 4. Nil vote vectors

Nil is a signed round-progress vote, not a second candidate.

- Missing/invalid/unavailable proposal or lock conflict ⇒ persist and emit `Prevote(nil)`.
- A 4/5 nil prevote QC or prevote timeout ⇒ preserve all prior lock/valid fields and emit `Precommit(nil)`.
- A 4/5 nil precommit QC or valid precommit timeout certificate ⇒ enter the next round while preserving lock/valid state.
- Nil QC never unlocks an earlier value.
- An implementation that silently abstains where the protocol requires nil voting fails liveness conformance and may generate verifiable non-participation evidence.

## 5. `lockedRound` / `validRound`

The required vectors freeze:

1. unlocked first proposal: prevote the valid proposed value;
2. same-value lock: prevote the proposed value;
3. conflicting proposal without a QC above `lockedRound`: prevote nil and keep the lock;
4. conflicting proposal with a valid non-nil PrevoteQC at `validRound > lockedRound`: prevote the justified value;
5. receiving a proposal/justify QC does not itself change the lock;
6. only the current round's non-nil 4/5 PrevoteQC updates `validValue/validRound`, `lockedValue/lockedRound`, and authorizes non-nil precommit;
7. timeout certificates advance rounds but never unlock.

## 6. WAL crash/restart

The WAL record must atomically include:

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

Required crash points include before fsync, after fsync/before send, after partial send, after peer receipt, after QC observation, and after AC persistence.

- If no durable vote exists, restart may apply the normal transition rules.
- If a durable vote exists, restart may only retransmit byte-identical bytes/signature.
- A different vote at the same `(domain,height,round,step)` is rejected as `ERR_WAL_DOUBLE_SIGN`.
- Corrupt/incomplete WAL enters non-voting recovery. The node may serve reads but cannot sign until it has reconciled current AC, membership/key epoch, lock/valid state, and QCs from at least four current members.
- AC is served as final only after the AC and committed-height transition are durable.

## 7. Dynamic roster activation vectors

For an update finalized under old root `M0` at height \(H\) with `activationHeight=H+1`:

- height \(H\): only `M0` and old `keyEpoch` votes count;
- height \(H+1\): only `M1` and new `keyEpoch` votes count;
- a mixed-root or mixed-key-epoch QC is always invalid;
- old and new roots never have simultaneous write authority at one height;
- the L1 membership switch must be final before any honest node signs height \(H+1\).

If a node observes two different finalized-L1 checkpoint claims for the same group and activation height, it MUST NOT choose by RPC arrival order. It enters non-voting recovery with `ERR_AMBIGUOUS_L1_MEMBERSHIP_CHECKPOINT` until the unique canonical L1 checkpoint is resolved.

## 8. Candidate reject versus accept

`CandidateRejectCertificate` is an evidence-bound veto object, not a Tendermint ledger value.

- If the same `(chainNftId, tipHeight, candidateId, attemptNonce, membershipEpoch)` obtains both a reject certificate and a non-nil PrevoteQC, the height freezes and enters L1 dispute with `ERR_REJECT_ACCEPT_CONFLICT`.
- Arrival order, round number, or “more signatures” does not select a winner.
- If a reject certificate arrives after a valid AC, archives never roll back locally. They emit `BadFinalityEvidence`, freeze L1 spendability if upheld, and enter dispute/re-home.
- Reject signatures and accept votes bind the same candidate/attempt/membership conflict domain so an archive cannot claim the objects were unrelated.

## 9. Required rejection codes

The wire/API spelling may wrap these values, but the semantic codes are frozen:

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

Implementations must not collapse safety faults into a generic timeout or silently ignore them.

## 10. Cross-implementation release gate

Production requires:

1. at least two independent-language implementations deriving every published SSZ byte/root exactly;
2. deterministic state-transition replay of every semantic vector;
3. crash-injection tests at all WAL boundaries;
4. Byzantine tests for duplicate signers, mixed roots, malformed bitmap/list, wrong QC child root, and duplicate signatures;
5. dynamic membership tests at \(H-1,H,H+1,H+2\);
6. reject/accept conflict tests before QC, after QC, before AC, and after AC;
7. a corpus-hash check in CI so vector edits require a protocol-version/revision review.

Archive A recomputes the six immutable v1 Proposal/Vote vectors and every v2 certificate byte/root, validates the JSON Schema, deterministically replays the v2 FSM/lifecycle vectors, verifies WAL corruption behavior, and reconstructs every RS vector from all 35 four-of-seven subsets. This does not replace the required second production-language implementation.

Any implementation that disagrees with one vector is not permitted to sign production `dle.archive.tendermint.v1` objects.

## 11. Frozen v2 machine boundary and remaining release blockers

The first executable batch freezes the following rules. Implementations MUST take the exact values from the v2 corpus rather than transcribing this summary:

1. **Certificates and references.** Certificate kind values are `PrevoteQC=1`, `ArchiveCertificate=2`, `TimeoutCertificate=3`, and `CandidateRejectCertificate=4`. Each certificate has five canonical active-signer slots, bitmap bits `0..4`, 65-byte signatures, zero-filled unsigned signature slots, and a minimum popcount of four. Standbys never occupy certificate signer slots. The reference is `SHA-256(UTF8("dle.archive.certref.v2") || uint8(kind) || hash_tree_root(certificate))`.
2. **Signing roots.** Fixed-container roots use SSZ SHA-256 merkleization. The signing root remains `keccak256(UTF8(domainTag) || hash_tree_root(object))`; the v2 corpus freezes separate domain tags and golden roots for QC, AC, TC, and Reject.
3. **Coordinator.** The five active `Bytes32` member IDs are sorted by unsigned bytewise ascending order. The selection preimage is `UTF8("dle.archive.coordinator.v1")` followed by little-endian `archiveGroupId:uint64`, `chainNftId:uint256`, `tipHeight:uint64`, `attemptNonce:uint64`, `membershipRoot:Bytes32`, and `round:uint32`. Candidates are `SHA-256(preimage || counter:uint32le)`; the low 64 bits interpreted little-endian use rejection sampling below `floor(2^64/5)*5`, then modulo five.
4. **WAL.** A frame is `DLEW || version:uint16le || flags:uint16le || sequence:uint64le || payloadLength:uint32le || SHA-256(payload) || payload || SHA-256(header||payload)`. A safety-record payload includes the exact canonical sign bytes, root, 65-byte signature, proposal/lock/valid/QC/TC state, membership/key epochs, and committed height. `fsync` is the emit boundary. A byte-different record at the same `(domain,height,round,step)` is `ERR_WAL_DOUBLE_SIGN`; corrupt or truncated tails require non-voting recovery.
5. **Errors and reject reasons.** `errorEnums` and `rejectReasons` in the corpus are exhaustive for this version. Every reject reason requires a non-zero evidence hash.
6. **RS `(7,4)` and DA.** `dle.rs.v1` uses the checked-in systematic generator matrix over `GF(2^8)` with primitive polynomial `0x11d`. Input is framed as `uint64le(bodyLength)||body||zero-padding`. Domain-separated SHA-256 leaf/branch rules and the eighth pad leaf are fixed by the corpus. All 35 four-shard subsets MUST reconstruct the exact body.
7. **Executable semantics and 5+2 lifecycle.** FSM and lifecycle vectors are ordered data, not prose. State roots bind every safety field. The planned-exit vector replaces exactly one active slot with ordered `standby[0]`, increments both epochs, retains four active members, shifts `standby[1]`, and does not lower quorum.

The following production blockers remain:

1. freeze the single canonical EIP-712 wrapper used by L1 verification, including whether the secp256k1 signature signs that wrapper or the SSZ-derived root directly; no implementation may invent a private mapping or require two independently meaningful signatures;
2. reproduce the complete schema/corpus with a second independent production-language implementation and run cross-process differential tests;
3. add production networking, key custody/rotation, L1 checkpoint verification, signature recovery, and crash-injection integration around the deterministic core.

Until those blockers close, no archive signer may be enabled for production.
