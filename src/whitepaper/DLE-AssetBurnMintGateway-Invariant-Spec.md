# CoNET-DLE AssetBurnMintGateway Invariant Specification

**Status:** Normative v1 safety specification
**Revision:** 2026-08-13
**Paired translation:** [`DLE-AssetBurnMintGateway-Invariant-Spec.zh-CN.md`](./DLE-AssetBurnMintGateway-Invariant-Spec.zh-CN.md)
**Applies to:** the canonical CoNET L1 `AssetBurnMintGateway` proxy, the Treasury V3 DLE authority interface, every admitted Treasury V3 canonical ERC-20, asset-tip backing allocation, normal exit, and challenged force exit.

This document is the normative source for burn/mint conservation and failure behavior. The bilingual CoNET-DLE whitepaper keeps the product summary; implementations MUST conform to this specification and its executable model.

## 1. Accounting domain

All quantities use the admitted asset's exact raw integer units. Oracle-valued USDC amounts govern admission and tip sizing only; they never participate in principal conservation.

For each asset \(a\):

- `physicalBurned[a]`: cumulative units proven physically burned by the canonical `TreasuryBridgeV3` authority rail for DLE.
- `pendingBurnLiability[a]`: units in `BURNED_PENDING`.
- `l2CreditLiability[a]`: current activated L2 principal liability across every tip, including spendable balances, frozen normal-exit amounts, and challenged force-exit amounts until the corresponding L1 mint is finalized.
- `refundedPending[a]`: cumulative units reminted only from an unactivated pending burn.
- `mintedExit[a]`: cumulative units reminted by finalized normal and force exits.
- `reservedReplacement[a]`: Treasury-policy-isolated replacement entitlement that cross-chain operations, other Treasury clients, and external minters cannot consume.

The required minimum invariant is:

\[
\mathrm{l2CreditLiability}(a)
+\mathrm{refundedPending}(a)
+\mathrm{mintedExit}(a)
\le \mathrm{physicalBurned}(a).
\]

The stronger v1 conservation equation is:

\[
\boxed{
\mathrm{physicalBurned}(a)=
\mathrm{pendingBurnLiability}(a)
+\mathrm{l2CreditLiability}(a)
+\mathrm{refundedPending}(a)
+\mathrm{mintedExit}(a)
}
\]

and the outstanding replacement obligation is:

\[
\mathrm{reservedReplacement}(a)=
\mathrm{pendingBurnLiability}(a)+\mathrm{l2CreditLiability}(a).
\]

The gateway MUST reject a burn unless Treasury V3 atomically reserves an exclusive replacement entitlement for the exact amount. A generic token `cap - totalSupply` observation is insufficient because another bridge route or minter could consume that headroom.

### 1.1 Treasury V3 canonical-asset boundary

DLE v1 principal is restricted to a CoNET-L1 `TreasuryCanonicalERC20V3` proxy issued or registered through the canonical `TreasuryBridgeV3` asset path. A token is not eligible merely because it exposes functions named `burnFrom` and `mint`.

The cited admission version MUST bind and verify:

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

For developer FX, ordinary ingress additionally requires the token to be registered by `DeveloperFxIssuer` and `isForwardAllowed(token) == true`. Canonical conet-USDC follows the same DLE accounting and oracle rules but does not inherit developer-FX stake semantics unless its Treasury profile explicitly says so.

The responsibility split is normative:

1. `TreasuryBridgeV3` is the sole token-level DLE burn/remint authority and the owner of the globally single-use treasury operation domain.
2. `AssetBurnMintGateway` verifies DLE oracle/AC/exit conditions and owns receipt, right, and conservation accounting; it calls Treasury V3 and MUST NOT hold an unconstrained independent mint path.
3. A foreign-chain asset first completes a separate route in the decentralized CoNET treasury infrastructure. Depending on deployment, that route is a `TreasuryBridgeV3` operation or the distinct CREATE2 `ConetTreasury` / `ConetTreasuryPeer` rail. DLE burns/remints only the resulting CoNET token after Treasury V3 recognizes it as canonical and the admission registry activates its exact proxy/version.
4. A DLE exit yields the CoNET canonical token. Moving it onward to Base or another chain is a separate operation on the configured treasury route and cannot reuse the DLE receipt, exit right, nonce, operation id, or fee.

The current Treasury V3 implementation primitives—canonical token roles, managed mint/burn, miner-governed bridge policies, sorted quorum attestations, and `operationExecuted` replay protection—are necessary but not sufficient. `AssetBurnMintGateway` and the DLE-specific Treasury interface are target protocol components, not aliases for the deployed `TreasuryBridgeV3` contract. Production requires a verified DLE-specific Treasury interface that restricts the caller to the canonical gateway, reserves replacement capacity at burn time, exposes cumulative supply facts, and preserves refund/safety-exit mint across ordinary pause or oracle failure.

## 2. Tip and adapter-epoch accounting

`l2CreditByTip[assetNftId][adapterEpoch]` is the canonical per-tip liability, where `adapterEpoch` identifies the frozen Treasury proxy/policy/token-implementation/DLE-interface tuple. For every asset:

\[
\sum_{t,e:\,\mathrm{asset}(t)=a}
\mathrm{l2CreditByTip}(t,e)
=\mathrm{l2CreditLiability}(a).
\]

An internal spillover or split MUST NOT change asset-global credit. It is completed through an L1-final `BackingReallocationV1` that atomically debits source tip/epoch lots and credits target tip/epoch lots before the target may spend:

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

The amounts must be positive, their sum must equal the source debit, every target must bind the same asset and adapter epoch, and `allocationNonce` is single-use. The previous `burnedInByAssetNftId` wording is not a sufficient backing model because a new spillover tip has no second physical L1 burn. Implementations MUST use current allocated credit liability, not historical burn origin, as the per-tip exit bound.

V1 forbids mixed adapter epochs inside one tip. A split preserves the source epoch. New ingress under a new adapter epoch uses a new tip, or a separately specified all-or-nothing migration.

## 3. Receipt state machine

```text
NONE
  -- burn exact amount + reserve replacement --> BURNED_PENDING

BURNED_PENDING
  -- valid genesis AC, before deadline,
     oracle/admission healthy --> ACTIVATED

BURNED_PENDING
  -- at-or-after deadline --> REFUNDED
```

Terminal branches are exclusive:

- `activateBurnIngress` requires `block.timestamp < burnActivationDeadline`.
- `refundBurnIngress` requires `block.timestamp >= burnActivationDeadline`.
- Both require `status == BURNED_PENDING` and set terminal state before an external mint call.
- At the exact deadline, only refund is valid. Transaction ordering in one block therefore cannot make both branches valid.
- A late genesis AC cannot reactivate a refunded receipt.
- An activated receipt can never use the pending-refund path.

State deltas are:

```text
burn:       physicalBurned += amount; pendingBurnLiability += amount
activate:   pendingBurnLiability -= amount; l2CreditLiability += amount
refund:     pendingBurnLiability -= amount; refundedPending += amount
exit mint:  l2CreditLiability -= amount; mintedExit += amount
reallocate: source tip credit -= amount; target tip credit += amount
```

Every transition preserves the strong conservation equation. All Treasury V3 calls are protected by reentrancy guards. Accounting and nullifier state are written before mint, and the complete transaction reverts if the Treasury mint fails.

## 4. Genesis failure and activation

A burn whose genesis never finalizes remains non-spendable. After the deadline, anyone may trigger exact refund to the original burner; no caller may redirect it. The refund path:

1. verifies the receipt and terminal boundary;
2. marks `REFUNDED`, consumes the burn id, and moves pending accounting to `refundedPending`;
3. consumes the receipt's Treasury-reserved replacement entitlement and a distinct single-use `treasuryOperationId`;
4. invokes the receipt-bound Treasury policy/adapter epoch to mint the exact canonical amount to `from`;
5. reverts atomically if any step or mint fails.

An AC is insufficient to create credit by itself. Spendable credit exists only after the finalized L1 `BurnIngressActivated` event has been consumed gaplessly by the tip FSM.

## 5. Shared normal/force exit-right state

Normal and force exit MUST NOT use independent replay domains over the same balance. Both use:

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

Rules:

1. A normal request atomically removes the amount from spendable balance and sets `NORMAL_PENDING`.
2. A force request may claim only credit not already reserved by a normal request.
3. After a specified normal-exit timeout, a force request may take over that exact `exitRightId`; it atomically marks the normal request `SUPERSEDED_BY_FORCE`. It does not create a second right.
4. Normal and force finalizers both require an unconsumed right, mark it `CONSUMED`, decrement `l2CreditByTip`/`l2CreditLiability`, increment `mintedExit`, and advance `mintSequence` before mint.
5. A second transaction for the same right, claim id, exit nonce, or mint sequence reverts or returns an idempotent no-op without minting.
6. Distinct stale proofs cannot overdraw: every mint is additionally bounded by current per-tip credit and asset-global `l2CreditLiability`.

## 6. AC freshness and dynamic membership

Every exit proof binds `archiveGroupId`, `membershipEpoch`, `membershipRoot`, `keyEpoch`, `tipHeight`, `parentArchiveCertificateHash`, and L1 context.

- The gateway maintains monotonic `latestKnownAC[assetNftId]`.
- A normal exit certificate must equal or descend from the latest known AC and preserve the exact pending debit.
- A force-exit challenge may replace the submitted proof with a strictly newer descendant AC.
- A superseded branch, a non-descendant higher height, a mixed-membership QC, or an AC below the freshness floor is rejected.
- Membership changes follow the Tendermint vector specification. Old-root signatures cannot authorize an activation-height-or-later exit.

Oracle freshness is not AC freshness. Principal exit is denominated in exact asset units and MUST NOT depend on an oracle quote.

## 7. Treasury/adapter upgrade and mint-cap safety

Each pending receipt and each tip liability binds:

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

An upgrade is allowed only when one of these is true:

1. the old epoch has zero `pendingBurnLiability + l2CreditLiability`; or
2. the old Treasury policy/token implementation/DLE adapter remains immutable `EXIT_ONLY` until its liability reaches zero; or
3. an atomic migration transfers the exact Treasury-reserved replacement entitlement to the new epoch and proves equivalent exact-mint authority.

Governance cannot reinterpret old receipts under a new Treasury/token/adapter tuple, lower reserved capacity below outstanding liability, revoke the old exit path, or reuse an epoch. New burns pause during upgrade. Treasury proxy, policy version, canonical token proxy/implementation, DLE adapter code hash, and epoch are checked on every activation, refund, reallocation, and exit.

An asset is ineligible if:

- another Treasury route or external minter can consume DLE replacement quota;
- a third party can permanently revoke the frozen Treasury safety-mint path;
- a global token or Treasury pause can block refunds/final exits without a protocol-controlled, timelocked, pause-exempt safety path;
- mint semantics are fee-bearing, rebasing, callback-ambiguous, or not exact.

## 8. Pause, oracle breaker, and failed mint behavior

Pause controls are asymmetric:

- `INGRESS_PAUSED` blocks new burns and activation.
- `TRANSFER_PAUSED` blocks ordinary L2 transfer/reallocation.
- neither state blocks a pending refund, full normal exit, challenged force exit, or already-finalized mint retry;
- no governance pause function may erase a claim or consume its nonce without exact mint.

When the oracle circuit breaker is open:

- new burn, activation, ordinary transfer, and value-based spillover stop;
- exact-unit full normal exit remains valid;
- force exit remains valid and uses `emergencyReserveUsdc6`;
- a partial normal exit that would require a value-floor check is redirected to full exit or force exit, never confiscated.

If Treasury mint execution temporarily fails, the transaction reverts and the right remains unconsumed. A retry uses the same id and amount. No alternate Treasury policy, token implementation, adapter, recipient, or amount may be substituted without an explicit adapter-epoch migration.

## 9. Replay and nonce domains

- `burnNonce` is monotonic per `(asset, burner)`; `burnId` is contract-derived and single-use.
- `treasuryOperationId` is derived over `{treasuryProxy, gateway, canonicalToken, action, burnId|exitRightId, amount, recipient, treasuryPolicyVersion}` and is globally single-use across the Treasury V3 DLE domain.
- `allocationNonce` is monotonic per source tip.
- L2 `eventNonce` is monotonic per `(assetNftId, owner, eventDomain)` and is committed in the state root.
- `exitNonce` is monotonic per `(assetNftId, owner)` but does not replace `exitRightId`.
- `claimId` and force-exit nullifier are deterministic aliases of one `exitRightId`.
- `mintSequence` is strictly increasing per tip and observed gaplessly by the L2 FSM.
- Exact duplicate submissions are idempotent/rejected; conflicting duplicates produce evidence and never select “last write wins.”

## 10. Mandatory formal-verification release gate

Production deployment is forbidden until all of the following pass:

1. **TLA+/TLC state model:** `DLEAssetBurnMintGateway.tla` checks conservation, receipt-level accounting, activation/refund boundary, unique credit-to-exit-right binding, activation/claim replay domains, normal/force competition, stale ACs, pause/oracle safety-exit liveness, capacity exhaustion, and the conservative zero-liability adapter-upgrade branch over bounded concurrent traces. Its abstract adapter epoch represents the frozen Treasury proxy/policy/token-implementation/DLE-interface tuple. `EXIT_ONLY` coexistence, treasury-operation replay, and atomic reservation migration remain mandatory Solidity-level properties.
2. **Solidity property prover:** Certora, Halmos, or an equivalent prover checks the strong conservation equation after every public/external transition and proves one-mint-per-right.
3. **Stateful fuzzing:** Foundry/Echidna handlers interleave Treasury burn, activation, refund, normal exit, force challenge/finalize, reallocation, pause, oracle breaker, Treasury/token/adapter upgrade, duplicate treasury operations, and malicious token callbacks.
4. **Treasury DLE conformance:** exact supply delta, globally single-use operation ids, gateway-only authority, exclusive replacement reservation, pause-exempt refund/exit, developer-FX qualification, and proxy/policy/token/code-hash/epoch binding are tested against success, revert, reentrancy, short mint, over-mint, stale policy, duplicate operation, and callback mocks.
5. **Differential accounting:** event-derived ledgers, contract storage, and the reference model must agree after every generated trace.

**Bounded reference-model result (2026-08-13).** TLC 2026-08-11 (rev `0894c34`) completed the checked-in configuration with two receipts, two exit rights, mint capacity two, `MaxAC=2`, and `MaxAdapterEpoch=2`: **612,105 generated states, 73,184 distinct states, depth 18, zero remaining states, and no invariant violation**. This closes the bounded specification check only; it does not prove arbitrary `uint256` amounts, Solidity storage/layout, real adapters, or cryptographic proof verification.

The mandatory scenario corpus includes:

- genesis never finalizes, then refund;
- activation and refund submitted in the deadline block;
- normal exit versus force exit and force takeover of a timed-out normal right;
- stale/non-descendant AC and old/new membership-root conflict;
- Treasury proxy/policy/token-implementation/DLE-adapter upgrade with live pending and activated liability;
- exhausted or externally consumed mint capacity and attempted cross-route reservation theft;
- ingress/transfer pause while refund and exit remain live;
- oracle breaker while full normal and force exit remain live;
- duplicate burn receipt, treasury operation id, event nonce, allocation nonce, exit nonce, claim id, and mint sequence;
- Treasury mint revert and retry with unchanged right and policy tuple.

Any counterexample is a release blocker. Governance may pause new ingress after a counterexample; it may not waive conservation or safety-exit properties for existing liabilities.
