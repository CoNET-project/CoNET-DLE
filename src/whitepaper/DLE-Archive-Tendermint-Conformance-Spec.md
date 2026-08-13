# CoNET-DLE Archive Tendermint Conformance Specification

**Status:** Normative draft; Proposal/Vote SSZ vectors frozen, P0 interoperability closure incomplete
**Revision:** 2026-08-13
**Paired translation:** [`DLE-Archive-Tendermint-Conformance-Spec.zh-CN.md`](./DLE-Archive-Tendermint-Conformance-Spec.zh-CN.md)
**Normative vectors:** [`DLE-Archive-Tendermint-Vectors-v1.json`](./DLE-Archive-Tendermint-Vectors-v1.json)
**Corpus digest:** [`DLE-Archive-Tendermint-Vectors-v1.sha256`](./DLE-Archive-Tendermint-Vectors-v1.sha256)

This specification freezes the byte-level and state-transition behavior that the whitepaper summarizes. A compatible archive implementation MUST pass the complete vector corpus before it may vote on a production membership root.

## 1. Scope and non-negotiable baseline

- Active roster: exactly five archive voters, Byzantine bound \(f=1\), quorum \(Q_A=4/5\), plus two non-voting ready standbys.
- Finality: Tendermint-style `Proposal → PrevoteQC → PrecommitQC (= ArchiveCertificate)`.
- Archive coordinator references an immutable validator-produced candidate; archives never produce or mutate blocks.
- Consensus sign bytes are canonical SSZ. Protobuf is transport-only.
- Each vote binds `membershipEpoch`, `membershipRoot`, and `keyEpoch`.
- Every safety transition is durably written to the WAL before network transmission.

## 2. Canonical vector artifact

`DLE-Archive-Tendermint-Vectors-v1.json` is normative and contains:

1. exact SSZ bytes, SSZ `hash_tree_root`, and signing root for:
   - proposal without a valid round;
   - proposal carrying a valid-round QC;
   - non-nil prevote;
   - nil prevote;
   - non-nil precommit bound to a PrevoteQC;
   - nil precommit;
2. lock/valid-round state transitions;
3. WAL crash/restart outcomes;
4. membership activation/rejection cases;
5. `CandidateRejectCertificate` versus accept-vote conflicts.

Implementations MUST consume the JSON artifact as test input. Re-keying it into implementation-native fixtures is allowed only if CI first verifies byte-for-byte equality with the checked-in artifact.

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

The six published SSZ vectors were independently recomputed from the declared fixed containers on 2026-08-13; their canonical serialization, SHA-256 SSZ roots, and Keccak signing roots match the checked-in values. The JSON also parses all 22 state-machine vectors. This validation does not replace deterministic semantic replay or the required second production-language implementation.

Any implementation that disagrees with one vector is not permitted to sign production `dle.archive.tendermint.v1` objects.

## 11. Remaining P0 closure blockers

The existing corpus is necessary but not sufficient for a production signer. The following are normative release blockers and MUST NOT be left to implementation discretion:

1. **One final signature story.** Freeze whether the secp256k1 signature directly targets the SSZ-derived `signingRoot` or targets one canonical EIP-712 wrapper that commits to it. The current whitepaper also requires EIP-712 for votes used by L1 AC verification; no implementation may invent a private SSZ↔EIP-712 mapping or require two independently meaningful signatures.
2. **Certificate containers.** Publish fixed-width canonical SSZ containers and golden vectors for `PrevoteQC`, `PrecommitQC/ArchiveCertificate`, `TimeoutQC`, and `CandidateRejectCertificate`, including signer ordering, bitmap/list representation, unused slots, duplicate rejection, child-object roots, and signature bytes.
3. **Certificate references.** Define `H(QC)` and `prevoteQCRef` byte-exactly, including the domain tag and whether the reference commits to the complete certificate, its SSZ root, or another digest. Placeholder values such as repeated `0xab` are structural fixtures only.
4. **Coordinator selection.** Freeze the deterministic coordinator formula for `(archiveGroupId, chainNftId, tipHeight, attemptNonce, membershipRoot, round)`, the canonical roster order, integer endianness, and modulo/rejection behavior.
5. **WAL framing.** Freeze a byte-level WAL record/frame format, sequence/checksum rules, atomic durability boundary, and corrupt-tail recovery behavior. Prose crash outcomes alone are not cross-language replay vectors.
6. **Executable semantic vectors.** Replace free-form `initial` / `expected` strings with versioned machine-readable states, ordered inputs, expected outputs, rejection codes, and final state roots; retain the prose only as commentary.
7. **Reject reasons.** Freeze the `CandidateRejectCertificate.reasonCode` enum and its evidence requirements.

Until these artifacts and their corpus digest are checked in and independently reproduced by two production languages, this specification remains P0-incomplete and no archive signer may be enabled for production.
