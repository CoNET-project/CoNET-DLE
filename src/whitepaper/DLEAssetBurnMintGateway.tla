---------------------- MODULE DLEAssetBurnMintGateway ----------------------
EXTENDS Naturals, FiniteSets, TLC

(*
Bounded reference model for the AssetBurnMintGateway v1 accounting state
machine. Each modeled receipt/right carries one raw asset unit. The Solidity
property suite must generalize the same transitions to arbitrary uint amounts.
Receipt identities also model single-use burn/activation event nonces; right
identities model single-use exit claims. Adapter upgrade is modeled using the
conservative zero-outstanding-liability branch; EXIT_ONLY coexistence and
atomic reservation migration require separate Solidity-level properties. The
abstract adapter epoch represents the frozen TreasuryBridgeV3 proxy/policy,
TreasuryCanonicalERC20V3 implementation, and DLE authority-interface tuple;
Treasury operation-id replay and role wiring are checked by the Solidity suite.
*)

CONSTANTS Receipts, Rights, MintCapacity, MaxAC, MaxAdapterEpoch

ReceiptStates == {
  "NONE", "BURNED_PENDING", "ACTIVATED", "REFUNDED", "EXITED"
}
RightStates == {
  "NONE",
  "NORMAL_PENDING",
  "FORCE_CHALLENGE",
  "SUPERSEDED_BY_FORCE",
  "CONSUMED",
  "CANCELLED"
}

VARIABLES
  receiptStatus,
  deadlinePassed,
  rightStatus,
  rightReceipt,
  activationNonceUsed,
  exitClaimUsed,
  physicalBurned,
  pendingBurnLiability,
  l2CreditLiability,
  refundedPending,
  mintedExit,
  reservedReplacement,
  ingressPaused,
  transferPaused,
  tokenUserPaused,
  oracleHealthy,
  adapterEpoch,
  acState

vars == <<
  receiptStatus,
  deadlinePassed,
  rightStatus,
  rightReceipt,
  activationNonceUsed,
  exitClaimUsed,
  physicalBurned,
  pendingBurnLiability,
  l2CreditLiability,
  refundedPending,
  mintedExit,
  reservedReplacement,
  ingressPaused,
  transferPaused,
  tokenUserPaused,
  oracleHealthy,
  adapterEpoch,
  acState
>>

Init ==
  /\ receiptStatus = [r \in Receipts |-> "NONE"]
  /\ deadlinePassed = [r \in Receipts |-> FALSE]
  /\ rightStatus = [x \in Rights |-> "NONE"]
  /\ rightReceipt = [x \in Rights |-> {}]
  /\ activationNonceUsed = {}
  /\ exitClaimUsed = {}
  /\ physicalBurned = 0
  /\ pendingBurnLiability = 0
  /\ l2CreditLiability = 0
  /\ refundedPending = 0
  /\ mintedExit = 0
  /\ reservedReplacement = 0
  /\ ingressPaused = FALSE
  /\ transferPaused = FALSE
  /\ tokenUserPaused = FALSE
  /\ oracleHealthy = TRUE
  /\ adapterEpoch = 1
  /\ acState = [
       latest |-> 0,
       proof |-> [x \in Rights |-> 0],
       descends |-> [x \in Rights |-> TRUE]
     ]

Burn(r) ==
  /\ receiptStatus[r] = "NONE"
  /\ ~ingressPaused
  /\ ~tokenUserPaused
  /\ reservedReplacement + 1 <= MintCapacity
  /\ receiptStatus' = [receiptStatus EXCEPT ![r] = "BURNED_PENDING"]
  /\ physicalBurned' = physicalBurned + 1
  /\ pendingBurnLiability' = pendingBurnLiability + 1
  /\ reservedReplacement' = reservedReplacement + 1
  /\ UNCHANGED <<
       deadlinePassed, rightStatus, rightReceipt, activationNonceUsed,
       exitClaimUsed, l2CreditLiability, refundedPending, mintedExit,
       ingressPaused, transferPaused, tokenUserPaused, oracleHealthy,
       adapterEpoch, acState
     >>

PassDeadline(r) ==
  /\ receiptStatus[r] = "BURNED_PENDING"
  /\ deadlinePassed' = [deadlinePassed EXCEPT ![r] = TRUE]
  /\ UNCHANGED <<
       receiptStatus, rightStatus, rightReceipt, activationNonceUsed,
       exitClaimUsed, physicalBurned, pendingBurnLiability,
       l2CreditLiability, refundedPending, mintedExit, reservedReplacement,
       ingressPaused, transferPaused, tokenUserPaused, oracleHealthy,
       adapterEpoch, acState
     >>

Activate(r) ==
  /\ receiptStatus[r] = "BURNED_PENDING"
  /\ ~deadlinePassed[r]
  /\ ~ingressPaused
  /\ ~tokenUserPaused
  /\ oracleHealthy
  /\ receiptStatus' = [receiptStatus EXCEPT ![r] = "ACTIVATED"]
  /\ activationNonceUsed' = activationNonceUsed \cup {r}
  /\ pendingBurnLiability' = pendingBurnLiability - 1
  /\ l2CreditLiability' = l2CreditLiability + 1
  /\ UNCHANGED <<
       deadlinePassed, rightStatus, rightReceipt, exitClaimUsed,
       physicalBurned, refundedPending, mintedExit, reservedReplacement,
       ingressPaused, transferPaused, tokenUserPaused, oracleHealthy,
       adapterEpoch, acState
     >>

Refund(r) ==
  /\ receiptStatus[r] = "BURNED_PENDING"
  /\ deadlinePassed[r]
  \* Refund is deliberately independent of ingress/transfer/oracle pause.
  \* Admitted assets must provide a token-pause-exempt replacement path.
  /\ receiptStatus' = [receiptStatus EXCEPT ![r] = "REFUNDED"]
  /\ pendingBurnLiability' = pendingBurnLiability - 1
  /\ refundedPending' = refundedPending + 1
  /\ reservedReplacement' = reservedReplacement - 1
  /\ UNCHANGED <<
       deadlinePassed, rightStatus, rightReceipt, activationNonceUsed,
       exitClaimUsed, physicalBurned, l2CreditLiability, mintedExit,
       ingressPaused, transferPaused, tokenUserPaused, oracleHealthy,
       adapterEpoch, acState
     >>

RequestNormal(x, r) ==
  /\ rightStatus[x] = "NONE"
  /\ receiptStatus[r] = "ACTIVATED"
  /\ \A y \in Rights: rightReceipt[y] # {r}
  /\ rightStatus' = [rightStatus EXCEPT ![x] = "NORMAL_PENDING"]
  /\ rightReceipt' = [rightReceipt EXCEPT ![x] = {r}]
  /\ acState' = [
       acState EXCEPT
         !.proof[x] = acState.latest,
         !.descends[x] = TRUE
     ]
  /\ UNCHANGED <<
       receiptStatus, deadlinePassed, physicalBurned, pendingBurnLiability,
       activationNonceUsed, exitClaimUsed, l2CreditLiability,
       refundedPending, mintedExit, reservedReplacement, ingressPaused,
       transferPaused, tokenUserPaused, oracleHealthy, adapterEpoch
     >>

RequestForce(x, r) ==
  /\ rightStatus[x] = "NONE"
  /\ receiptStatus[r] = "ACTIVATED"
  /\ \A y \in Rights: rightReceipt[y] # {r}
  /\ rightStatus' = [rightStatus EXCEPT ![x] = "FORCE_CHALLENGE"]
  /\ rightReceipt' = [rightReceipt EXCEPT ![x] = {r}]
  /\ acState' = [
       acState EXCEPT
         !.proof[x] = acState.latest,
         !.descends[x] = TRUE
     ]
  /\ UNCHANGED <<
       receiptStatus, deadlinePassed, physicalBurned, pendingBurnLiability,
       activationNonceUsed, exitClaimUsed, l2CreditLiability,
       refundedPending, mintedExit, reservedReplacement, ingressPaused,
       transferPaused, tokenUserPaused, oracleHealthy, adapterEpoch
     >>

TakeOverTimedOutNormal(x) ==
  /\ rightStatus[x] = "NORMAL_PENDING"
  /\ rightStatus' = [rightStatus EXCEPT ![x] = "SUPERSEDED_BY_FORCE"]
  /\ UNCHANGED <<
       receiptStatus, deadlinePassed, rightReceipt, activationNonceUsed,
       exitClaimUsed, physicalBurned, pendingBurnLiability,
       l2CreditLiability, refundedPending, mintedExit, reservedReplacement,
       ingressPaused, transferPaused, tokenUserPaused, oracleHealthy,
       adapterEpoch, acState
     >>

AdvanceLatestAC ==
  /\ acState.latest < MaxAC
  /\ acState' = [acState EXCEPT !.latest = @ + 1]
  /\ UNCHANGED <<
       receiptStatus, deadlinePassed, rightStatus, rightReceipt,
       activationNonceUsed, exitClaimUsed, physicalBurned,
       pendingBurnLiability, l2CreditLiability, refundedPending, mintedExit,
       reservedReplacement, ingressPaused, transferPaused, tokenUserPaused,
       oracleHealthy, adapterEpoch
     >>

RefreshExitProof(x) ==
  /\ rightStatus[x] \in {
       "NORMAL_PENDING", "FORCE_CHALLENGE", "SUPERSEDED_BY_FORCE"
     }
  /\ acState' = [
       acState EXCEPT
         !.proof[x] = acState.latest,
         !.descends[x] = TRUE
     ]
  /\ UNCHANGED <<
       receiptStatus, deadlinePassed, rightStatus, rightReceipt,
       activationNonceUsed, exitClaimUsed, physicalBurned,
       pendingBurnLiability, l2CreditLiability, refundedPending, mintedExit,
       reservedReplacement, ingressPaused, transferPaused, tokenUserPaused,
       oracleHealthy, adapterEpoch
     >>

MarkProofNonDescendant(x) ==
  /\ rightStatus[x] \in {
       "NORMAL_PENDING", "FORCE_CHALLENGE", "SUPERSEDED_BY_FORCE"
     }
  /\ acState' = [acState EXCEPT !.descends[x] = FALSE]
  /\ UNCHANGED <<
       receiptStatus, deadlinePassed, rightStatus, rightReceipt,
       activationNonceUsed, exitClaimUsed, physicalBurned,
       pendingBurnLiability, l2CreditLiability, refundedPending, mintedExit,
       reservedReplacement, ingressPaused, transferPaused, tokenUserPaused,
       oracleHealthy, adapterEpoch
     >>

FinalizeNormal(x, r) ==
  /\ rightStatus[x] = "NORMAL_PENDING"
  /\ rightReceipt[x] = {r}
  /\ receiptStatus[r] = "ACTIVATED"
  /\ reservedReplacement >= 1
  /\ acState.proof[x] >= acState.latest
  /\ acState.descends[x]
  /\ rightStatus' = [rightStatus EXCEPT ![x] = "CONSUMED"]
  /\ receiptStatus' = [receiptStatus EXCEPT ![r] = "EXITED"]
  /\ exitClaimUsed' = exitClaimUsed \cup {x}
  /\ l2CreditLiability' = l2CreditLiability - 1
  /\ mintedExit' = mintedExit + 1
  /\ reservedReplacement' = reservedReplacement - 1
  /\ UNCHANGED <<
       deadlinePassed, rightReceipt, activationNonceUsed, physicalBurned,
       pendingBurnLiability, refundedPending, ingressPaused, transferPaused,
       tokenUserPaused, oracleHealthy, adapterEpoch, acState
     >>

FinalizeForce(x, r) ==
  /\ rightStatus[x] \in {"FORCE_CHALLENGE", "SUPERSEDED_BY_FORCE"}
  /\ rightReceipt[x] = {r}
  /\ receiptStatus[r] = "ACTIVATED"
  /\ reservedReplacement >= 1
  /\ acState.proof[x] >= acState.latest
  /\ acState.descends[x]
  \* Force exit remains enabled while oracle/ordinary transfer is paused.
  /\ rightStatus' = [rightStatus EXCEPT ![x] = "CONSUMED"]
  /\ receiptStatus' = [receiptStatus EXCEPT ![r] = "EXITED"]
  /\ exitClaimUsed' = exitClaimUsed \cup {x}
  /\ l2CreditLiability' = l2CreditLiability - 1
  /\ mintedExit' = mintedExit + 1
  /\ reservedReplacement' = reservedReplacement - 1
  /\ UNCHANGED <<
       deadlinePassed, rightReceipt, activationNonceUsed, physicalBurned,
       pendingBurnLiability, refundedPending, ingressPaused, transferPaused,
       tokenUserPaused, oracleHealthy, adapterEpoch, acState
     >>

ToggleIngressPause ==
  /\ ingressPaused' = ~ingressPaused
  /\ UNCHANGED <<
       receiptStatus, deadlinePassed, rightStatus, rightReceipt,
       activationNonceUsed, exitClaimUsed, physicalBurned,
       pendingBurnLiability, l2CreditLiability, refundedPending, mintedExit,
       reservedReplacement, transferPaused, tokenUserPaused, oracleHealthy,
       adapterEpoch, acState
     >>

ToggleTransferPause ==
  /\ transferPaused' = ~transferPaused
  /\ UNCHANGED <<
       receiptStatus, deadlinePassed, rightStatus, rightReceipt,
       activationNonceUsed, exitClaimUsed, physicalBurned,
       pendingBurnLiability, l2CreditLiability, refundedPending, mintedExit,
       reservedReplacement, ingressPaused, tokenUserPaused, oracleHealthy,
       adapterEpoch, acState
     >>

ToggleTokenUserPause ==
  /\ tokenUserPaused' = ~tokenUserPaused
  /\ UNCHANGED <<
       receiptStatus, deadlinePassed, rightStatus, rightReceipt,
       activationNonceUsed, exitClaimUsed, physicalBurned,
       pendingBurnLiability, l2CreditLiability, refundedPending, mintedExit,
       reservedReplacement, ingressPaused, transferPaused, oracleHealthy,
       adapterEpoch, acState
     >>

ToggleOracle ==
  /\ oracleHealthy' = ~oracleHealthy
  /\ UNCHANGED <<
       receiptStatus, deadlinePassed, rightStatus, rightReceipt,
       activationNonceUsed, exitClaimUsed, physicalBurned,
       pendingBurnLiability, l2CreditLiability, refundedPending, mintedExit,
       reservedReplacement, ingressPaused, transferPaused, tokenUserPaused,
       adapterEpoch, acState
     >>

UpgradeAdapterNoLiability ==
  /\ reservedReplacement = 0
  /\ adapterEpoch < MaxAdapterEpoch
  /\ adapterEpoch' = adapterEpoch + 1
  /\ UNCHANGED <<
       receiptStatus, deadlinePassed, rightStatus, rightReceipt,
       activationNonceUsed, exitClaimUsed, physicalBurned,
       pendingBurnLiability, l2CreditLiability, refundedPending, mintedExit,
       reservedReplacement, ingressPaused, transferPaused, tokenUserPaused,
       oracleHealthy, acState
     >>

Next ==
  \/ \E r \in Receipts: Burn(r)
  \/ \E r \in Receipts: PassDeadline(r)
  \/ \E r \in Receipts: Activate(r)
  \/ \E r \in Receipts: Refund(r)
  \/ \E x \in Rights, r \in Receipts: RequestNormal(x, r)
  \/ \E x \in Rights, r \in Receipts: RequestForce(x, r)
  \/ \E x \in Rights: TakeOverTimedOutNormal(x)
  \/ AdvanceLatestAC
  \/ \E x \in Rights: RefreshExitProof(x)
  \/ \E x \in Rights: MarkProofNonDescendant(x)
  \/ \E x \in Rights, r \in Receipts: FinalizeNormal(x, r)
  \/ \E x \in Rights, r \in Receipts: FinalizeForce(x, r)
  \/ ToggleIngressPause
  \/ ToggleTransferPause
  \/ ToggleTokenUserPause
  \/ ToggleOracle
  \/ UpgradeAdapterNoLiability

TypeOK ==
  /\ receiptStatus \in [Receipts -> ReceiptStates]
  /\ deadlinePassed \in [Receipts -> BOOLEAN]
  /\ rightStatus \in [Rights -> RightStates]
  /\ rightReceipt \in [Rights -> SUBSET Receipts]
  /\ activationNonceUsed \in SUBSET Receipts
  /\ exitClaimUsed \in SUBSET Rights
  /\ physicalBurned \in Nat
  /\ pendingBurnLiability \in Nat
  /\ l2CreditLiability \in Nat
  /\ refundedPending \in Nat
  /\ mintedExit \in Nat
  /\ reservedReplacement \in Nat
  /\ ingressPaused \in BOOLEAN
  /\ transferPaused \in BOOLEAN
  /\ tokenUserPaused \in BOOLEAN
  /\ oracleHealthy \in BOOLEAN
  /\ adapterEpoch \in Nat
  /\ acState.latest \in Nat
  /\ acState.proof \in [Rights -> Nat]
  /\ acState.descends \in [Rights -> BOOLEAN]

MinimumConservation ==
  l2CreditLiability + refundedPending + mintedExit <= physicalBurned

StrongConservation ==
  physicalBurned =
    pendingBurnLiability + l2CreditLiability + refundedPending + mintedExit

ReplacementReserved ==
  reservedReplacement = pendingBurnLiability + l2CreditLiability

CapacitySafe ==
  reservedReplacement <= MintCapacity

AccountingMatchesReceipts ==
  /\ physicalBurned =
       Cardinality({r \in Receipts: receiptStatus[r] # "NONE"})
  /\ pendingBurnLiability =
       Cardinality({r \in Receipts: receiptStatus[r] = "BURNED_PENDING"})
  /\ l2CreditLiability =
       Cardinality({r \in Receipts: receiptStatus[r] = "ACTIVATED"})
  /\ refundedPending =
       Cardinality({r \in Receipts: receiptStatus[r] = "REFUNDED"})
  /\ mintedExit =
       Cardinality({r \in Receipts: receiptStatus[r] = "EXITED"})

RightBindingSafe ==
  \A x \in Rights:
    IF rightStatus[x] = "NONE"
    THEN rightReceipt[x] = {}
    ELSE Cardinality(rightReceipt[x]) = 1

UniqueCreditClaim ==
  \A x, y \in Rights:
    x # y => rightReceipt[x] \cap rightReceipt[y] = {}

ReplayDomainsMatchTerminalState ==
  /\ activationNonceUsed =
       {r \in Receipts:
          receiptStatus[r] \in {"ACTIVATED", "EXITED"}}
  /\ exitClaimUsed = {x \in Rights: rightStatus[x] = "CONSUMED"}

EveryExitConsumesItsBoundCredit ==
  \A r \in Receipts:
    receiptStatus[r] = "EXITED" =>
      \E x \in Rights:
        /\ rightStatus[x] = "CONSUMED"
        /\ rightReceipt[x] = {r}

ActivationRefundRaceSafe ==
  \A r \in Receipts:
    receiptStatus[r] = "BURNED_PENDING" =>
      ~((ENABLED Activate(r)) /\ (ENABLED Refund(r)))

StaleOrForkedProofCannotFinalize ==
  \A x \in Rights:
    /\ rightStatus[x] \in {
         "NORMAL_PENDING", "FORCE_CHALLENGE", "SUPERSEDED_BY_FORCE"
       }
    /\ (acState.proof[x] < acState.latest \/ ~acState.descends[x])
    => ~(
         (\E r \in Receipts: ENABLED FinalizeNormal(x, r))
         \/ (\E r \in Receipts: ENABLED FinalizeForce(x, r))
       )

SafetyExitIgnoresOracleAndOrdinaryPauses ==
  \A x \in Rights:
    /\ rightStatus[x] \in {
         "NORMAL_PENDING", "FORCE_CHALLENGE", "SUPERSEDED_BY_FORCE"
       }
    /\ Cardinality(rightReceipt[x]) = 1
    /\ reservedReplacement >= 1
    /\ acState.proof[x] >= acState.latest
    /\ acState.descends[x]
    => (
         (\E r \in Receipts: ENABLED FinalizeNormal(x, r))
         \/ (\E r \in Receipts: ENABLED FinalizeForce(x, r))
       )

RefundEnabledAfterDeadline ==
  \A r \in Receipts:
    /\ receiptStatus[r] = "BURNED_PENDING"
    /\ deadlinePassed[r]
    => ENABLED Refund(r)

BurnBlockedAtCapacity ==
  reservedReplacement = MintCapacity =>
    \A r \in Receipts: ~ENABLED Burn(r)

Spec == Init /\ [][Next]_vars

=============================================================================
