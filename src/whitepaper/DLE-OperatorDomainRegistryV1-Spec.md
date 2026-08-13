# CoNET-DLE OperatorDomainRegistryV1 Specification

**Status:** Normative v1 identity/correlation specification
**Revision:** 2026-08-13
**Paired translation:** [`DLE-OperatorDomainRegistryV1-Spec.zh-CN.md`](./DLE-OperatorDomainRegistryV1-Spec.zh-CN.md)
**Applies to:** archive admission, 5-active + 2-standby formation, rotation, validator selection for hosted tips, challenge/adjudication, reward exposure, cooldown, and correlated-risk reporting.

This specification removes operator-independence judgment from discretionary governance prose. It defines what is mechanically enforced, what requires attested external evidence, how uncertainty is handled, and which deterministic result becomes effective on L1.

## 1. Security claim and explicit limit

Distinct EOAs, archive NFTs, hostnames, cloud accounts, or legal names do not prove independent control. `OperatorDomainRegistryV1` reduces hidden common control and correlated infrastructure exposure; it does not cryptographically prove that anonymous parties are different humans or companies.

Therefore:

- objective cryptographic/linkage rules execute automatically;
- non-cryptographic evidence is decided only by a versioned adjudication policy;
- missing, stale, disputed, or unverifiable mandatory evidence is `UNKNOWN`, never `INDEPENDENT`;
- governance cannot manually label two identities independent outside this state machine.

## 2. Canonical identifiers and records

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

`canonicalOperatorId` is a registry identity derived from a finalized decision, not from an EOA. Alias records map every known archive/validator/stake identity to exactly one canonical operator.

## 3. Three independent domains

| Domain | Required commitment/evidence | Direct protocol use |
| --- | --- | --- |
| **Identity/control** | credential/nullifier, stake controller, beneficial-control commitment, proven aliases | One canonical operator may occupy at most one archive active-or-standby seat across all live groups |
| **Infrastructure** | exact tenant/attestation root, ASN/provider, region/metro, facility/power, custody and software-supply domains | No exact tenant/root reuse inside one 5+2 group; each declared ASN/provider, region/metro, or power domain occupies at most two of seven seats |
| **Role** | archive NFTs and validator identities indexed by canonical operator | Hosting-group archive operators cannot validate that group's tips; one validator committee admits at most one seat per canonical operator |

Passing one domain never substitutes for another. Separate legal entities sharing an exact tenant fail the tenant rule; separate tenants under one proven beneficial controller fail the operator rule.

## 4. Status and state machine

```text
UNREGISTERED
  → PROVISIONAL
  → ACTIVE
  → CHALLENGED
  → ACTIVE | MERGED | SUSPENDED
  → COOLDOWN
  → ACTIVE | EXITED
```

- `PROVISIONAL`: evidence submitted but not final; no active/standby/validator seat.
- `ACTIVE`: all mandatory evidence is current and no blocking challenge exists.
- `CHALLENGED`: new assignments and rotations into a seat are frozen; existing consensus authority follows the current L1 membership root until a membership switch.
- `MERGED`: aliases are irreversibly mapped to one canonical operator for exposure, multiplicity, cooldown, and sanctions; a later split requires a new evidence/adjudication decision and never rewrites historical roots.
- `SUSPENDED`: evidence expired, contradictory, or adjudication unavailable; no new assignment.
- `COOLDOWN`: operator and all aliases are ineligible until the L1 deadline.

No registry decision directly rewrites an active consensus roster. Seat removal occurs through the normal atomic membership-switch protocol.

## 5. Deterministic admission decision

For a candidate set \(C\), `evaluateCandidateSet(policyVersion, evidenceRoot, C)` returns exactly one of:

```text
ELIGIBLE
INELIGIBLE(reasonCode, conflictIds[])
UNKNOWN(reasonCode, missingOrDisputedIds[])
```

Formation/rotation may proceed only on `ELIGIBLE`. `UNKNOWN` fails closed.

Evaluation order is fixed:

1. verify L1-final policy/evidence versions and validity windows;
2. resolve every identity to a canonical operator;
3. reject duplicate canonical operators or cooldown aliases;
4. reject exact tenant/attestation-root reuse;
5. enforce versioned infrastructure concentration caps;
6. enforce archive/validator role exclusion;
7. reject unresolved active challenges and conflicting evidence;
8. commit the sorted candidate leaves and decision inputs.

The implementation may not use RPC arrival order, local allowlists, reputation UI, or manual governance preference as a tie-break.

## 6. Attestors and evidence classes

The L1 policy freezes:

- `attestorSetId` and threshold;
- accepted evidence schemas and issuers;
- validity/refresh windows;
- conflict-of-interest exclusions;
- challenge bond, response period, decision period, and appeal period;
- objective merge rules and adjudicated merge rules;
- sanctions for negligent stale data versus intentional concealment.

Evidence classes:

1. **Objective linkage:** same credential/nullifier, same attestation key/root, same stake controller, mutually authenticated control proof, or another policy-defined cryptographic equality. Sufficient threshold-valid proof causes automatic merge.
2. **Attested structured fact:** cloud tenant, legal entity, beneficial controller, facility/power, custody provider, or supply-chain claim signed by approved independent attestors.
3. **Discretionary allegation:** narrative or unverifiable material. It cannot itself merge identities; it may only open a challenge and request structured evidence.

An attestor cannot attest its own operator, infrastructure, or legal-control domain. Threshold calculation excludes conflicted attestors.

## 7. Challenge and adjudication

```text
OPEN → RESPONSE → EVIDENCE_FROZEN → DECIDED → APPEALABLE → FINAL
```

`ChallengeV1` binds:

```text
challengeId, policyVersion, evidenceVersion,
challenger, accusedOperatorIds[],
claimType, evidenceCommitment,
openedAt, responseDeadline,
evidenceFreezeBlock, decisionDeadline,
bond, requestedRemedy
```

Rules:

- duplicate challenges use `challengeId`/evidence nullifiers and cannot reset deadlines;
- evidence is frozen at a finalized L1 block before adjudicators commit votes;
- adjudicator selection is deterministic from a future finalized beacon and a pre-frozen eligible set;
- votes bind the full evidence root and policy version;
- quorum/threshold are fixed by policy, not selected per case;
- timeout yields `UNKNOWN/SUSPENDED`, not exoneration;
- appeal requires a new evidence root or a proven procedure fault and uses a disjoint adjudicator set where possible;
- the final decision is replayable from L1 inputs and emits one monotonic `decisionId`.

## 8. Decision effects

A final merge decision atomically:

1. maps all aliases to one `canonicalOperatorId`;
2. aggregates archive, validator, stake, reward, exposure, and cooldown records;
3. freezes new assignment under every alias;
4. opens deterministic replacement for conflicting seats;
5. claws back undistributed rewards attributable to concealed multiplicity;
6. applies the policy-defined concealment slash;
7. records historical roots as tainted but does not rewrite finalized ACs.

If a live group becomes policy-invalid, it enters `DOMAIN_REMEDIATION`: existing finality continues only under its current membership root, new tip assignment freezes, and a bounded membership switch/re-home must start. Governance may not silently waive the violation.

## 9. Roots and version pinning

Every membership leaf binds:

```text
archiveNftId, signingKey,
canonicalOperatorId,
operatorRecordHash,
infrastructureClaimHash,
roleDomainHash,
operatorPolicyVersion,
evidenceVersion
```

`operatorDomainRoot` and `infrastructurePolicyRoot` are committed in group formation, membership updates, and every consensus vote/certificate through `membershipRoot`.

Policy upgrades:

- use delayed L1 activation;
- never change the interpretation of historical roots;
- affect eligibility only from their activation height;
- cannot make old and new policy versions simultaneously authoritative at one height;
- require re-evaluation before the next formation/rotation.

## 10. Conservative correlation accounting

Registry eligibility is not a claim of statistical independence. Risk reporting must group unknown/disputed evidence conservatively and publish exposure by:

- canonical operator;
- exact tenant/attestation root;
- provider/ASN;
- region/metro;
- facility/power;
- key custody;
- software image/supply chain;
- legal/beneficial-control domain;
- archive↔validator overlap.

Unknown fields count toward the most conservative applicable bucket until resolved. Dashboard labels never override L1 eligibility.

## 11. Mandatory test vectors and release gate

The implementation suite must include:

1. different EOA/NFT but same objective credential ⇒ merge;
2. different legal entities but same exact tenant ⇒ group rejection;
3. same operator using archive and hosted-tip validator identities ⇒ role rejection;
4. stale/missing attestation ⇒ `UNKNOWN`, not eligible;
5. conflicting attestors ⇒ challenge/suspension;
6. duplicate challenge/evidence nullifier ⇒ idempotent rejection;
7. challenge timeout ⇒ suspended, no exoneration;
8. appeal with unchanged evidence ⇒ rejected;
9. policy switch at activation height ⇒ no mixed-version root;
10. post-formation merge ⇒ assignment freeze + membership remediation, no AC rewrite;
11. conflicted attestor excluded from quorum;
12. deterministic replay under different RPC/event arrival orders ⇒ identical decision/root.

Production requires cross-implementation root agreement, adversarial challenge tests, and an audited upgrade/appeal path.

## 12. Forbidden implementation discretion

- No EOA/NFT uniqueness as independence proof.
- No `UNKNOWN → INDEPENDENT` fallback.
- No governance-only alias merge without evidence commitment, versioned policy, and replayable decision.
- No local node/operator allowlist overriding L1 state.
- No silent exception for bootstrap, standby, emergency rotation, or validator selection.
- No rewriting historical membership roots or finalized certificates after a later identity decision.
