# Decentralization Cluster Multi-Chain

## Parallel Atomic Distributed Ledger Expansion (CoNET-DLE)

**Author:** Peter Xie  
**First draft:** 2023  
**Revision:** 2026-08-11ah (doc consistency: markdown/math/HKDF; §3.1 \(Q_V=5/7\); §4.0 terminology hierarchy; §4.4 archive-shard BFT map; §13.1 50/50 fee illustration; probability tables in %)

**Paired translation (must stay in sync):** [`Decentralization Cluster multi-chain.zh-CN.md`](./Decentralization%20Cluster%20multi-chain.zh-CN.md)  
**Sync rule:** `.cursor/rules/conet-layer2-whitepaper-bilingual-sync.mdc`

---

## Abstract

**CoNET Distributed Ledger Expansion (CoNET-DLE)** is a clustered, lightweight **Layer-2-style ledger-expansion** system: **many parallel, event-based atomic chains** (architecture target: capacity grows with staking / archive shards, not with one shared tip), each block **proposed** by a **validator committee** drawn by the hosting **archive shard** (\(N_V=7\) drawn, **\(Q_V=5/7\)** signatures), then **finalized only** by that shard’s **Archive Certificate** (= **CommitQC** under a HotStuff-style two-phase quorum protocol, §5.2.1)—not by a single global tip, a single archive node, or a one-shot “collect \(Q_A\) signatures” race.

- **Parallelism:** concurrent chains scale with staking and archive-plane fission; more capacity → more maintainable tips—not a claim of unbounded free speed.
- **Atomic (per chain):** tip advance requires a **\(Q_V=5/7\)** validator attestation, then an **Archive Certificate** from the hosting shard (§6.5, §5.2.1).
- **Event-only blocks:** **no event ⇒ no block.** Empty-slot mining is forbidden.
- **L1 birth certificate:** creating a new chain **must** mint a **unique NFT** on CoNET L1; that NFT binds class (**asset**, **storage**, or **trade**), ownership, and **which archive cluster** hosts it via \(H(\mathrm{nftContract}\|\mathrm{tokenId}\|R_e)\bmod S_e\) (§5.2).
- **Asset cap stays live:** each asset event **revalues** the tip; if balance **> 100 USDC**, outbound / excess **requires new chain(s)** (§4.6).
- **Trade-class (atomic NFT-style sale):** users open a **trade** tip as an **L2 order / state coordinator** to list an existing **asset** or **storage** chain (quote ≤ **100 USDC**-equivalent; **no large orders**). Tip advances via the frozen **Trade FSM** (`Open→Locked→SettleReady→…`, §10.2). **Final atomic delivery** (pay seller **and** move subject L1 NFT ownership) runs in one CoNET **L1 Settlement Contract** call; the trade tip then **closes** (§4.7).
- **Storage-class creator economy / private copyright delivery:** same thesis as Beamio **`CopyrightContentModule`**: owner fragments + seals a private assembly index to authorized DePIN miners; tip/L1 holds only hashes; buyers pay **conet-GB**, bind buyer PGP; **first-completer** miners deliver buyer-bound ciphertext; short-lived access URLs + periodic storage fees; plaintext never on-chain (§4.8).
- **Copyright ZERO / version tree:** storage tips form a **lineage tree** (original + modifiers); each branch point is an **independent L1 NFT** listable via trade-class; the tip stores **social history** (likes, comments, citations) as a **Web of Trust** signal for auction valuation (§4.9).
- **Storage sales ledger:** each storage tip keeps an append-only **sales-revenue journal** and **references** the parallel **asset-class** tip txs that actually move value (§4.10).
- **Archive-plane fission + BFT finality:** as archive participants grow, the L2 archive plane **fissions** into **2 → 4 → 8 → …** parallel clusters; host shard is **`H(nftContract∥tokenId∥R_e) mod S_e`** (not grindable `tokenId mod S`), with epoch **MigrationCertificate** handoffs (§5.2); each shard finalizes tips only via **PrepareQC → CommitQC (= AC)** with \(f=\lfloor(N_A-1)/3\rfloor\), \(Q_A=\lfloor 2N_A/3\rfloor+1\), lock/justify rules, and `membershipRoot` (§5.2.1).
- **Fees (dual denomination):** **storage-class** fees scale with **content** and settle in **conet-GB**; **asset-class / trade-class** event fees are **USDC**-denominated (**0.01%** of transferred / listed value). Of each **0.01%** event fee: **50% → hosting archive shard**, **50% → \(Q_V\) accepting validators** (§13).

**Transport premise:** CoNET-DLE is loaded on **CoNET DePIN**. Control and data-plane gossip use **wallet addresses (EOA) as network identity**, not IP addresses. Messages are end-to-end encrypted (OpenPGP) and relayed through entry/mailbox nodes that **cannot read plaintext**.

**Natural privacy (product freeze):** privacy is **dual**—**communication privacy** (DePIN wallet-address gossip + OpenPGP) **and asset privacy**. Multi-address micro-fragmentation **raises on-chain clustering cost** and breaks the direct map **one address = whole portfolio**; it does **not** claim strong anonymity or that observers always fail (§4.5). On receive/transfer, CoNET freezes a **single canonical** wallet profile based on **ERC-5564** (stealth meta-address, ephemeral public key, view tag, announcement event, scan/spend keys, batch derivation, recover/scan)—**not** interchangeable BIP-47 / BIP-352 runtimes. BIP-47 / BIP-352 are **design references** only; BIP-352 is Bitcoin UTXO/Taproot-native and is **not** a CoNET L1/EVM drop-in. Stealth stays in the **wallet / client**; DLE tips / archive / validator committee do **not** run an address oracle (§4.5, §7.6).

**Custody security (qualified):** address fragmentation **alone** does **not** make custody safer. “No single private key controls the whole portfolio” holds only when fragment keys are under **independent key-domain and recovery-domain isolation**. If every fragment derives from one mnemonic, one device, one client DB, or one weak recovery password, seizing that seed or recombination database still takes **all** value. Product wallets SHOULD use a **hierarchical key vault** (online scan key; batched spend keys; hardware/threshold for high-value fragments; encrypted recovery map; per-shard derivation domains; per-device hourly merge/withdraw caps—§4.5, §12.9). **Higher recipient anonymity** is likewise a **client product** problem of *how* wallets use L2—not something DLE tip/archive/validator infrastructure can solve.

CoNET-DLE keeps blockchain-grade **immutability** while targeting continuous availability, flexible participation, and event-driven latency. Stake-based, group-local consensus removes the need for global PoW races. **As more miners join, more chains can be underwritten concurrently**; aggregate throughput can rise with independent archive shards—**not** “more miners ⇒ every tip gets monotonically faster.”

**Thesis on the blockchain trilemma (frozen):** CoNET-DLE **does not eliminate** the blockchain trilemma. It **changes its operating boundary** by replacing a shared global execution tip with many **operationally isolated**, **value-bounded (asset tips ≤ 100 USDC)**, event-driven state machines. Aggregate throughput **can** scale with independent archive shards, while security remains **conditional** on shard honesty, committee sampling, L1 settlement, data availability, and client-side key isolation (see §3.4).

This document is a design whitepaper for the **Decentralization Cluster / multi-chain** layer. Cryptography in §7 is restricted to **mature, production-proven primitives** (secp256k1 / EIP-191 for gossip, **EIP-712** for Archive Certificates / SettleReady / MembershipCheckpoint, OpenPGP, AES-GCM, SHA-256/Keccak-256, **CoNET L1 beacon finalized randomness** for production roulette seeds, optional **ECVRF** tickets after \(R_e\) is fixed, commit–reveal as **MVP-only**). It is complementary to CoNET DePIN / CoNET-SI and a CoNET **mainchain / registry**—not a replacement for a global PoS L1.

---

## 1. Introduction

As on-chain applications grow, more state must be recorded. Mainchain-centric consensus wastes compute when every participant races on one tip, and slow global block finality becomes the bottleneck. Many L1 and L2 designs still inherit a **single logical tip** (or a small set of shared tips), so they reintroduce the same congestion and fee pressure under load.

CoNET-DLE takes a different path: **shard by ledger**, not only by throughput tricks on one ledger. Each application or asset instance can own a **lightweight atomic chain** with its own issuer, witnesses, and validators—**many** such chains may run in parallel as staking and archive shards grow. Security and economic finality are reinforced by:

1. **Stake** of participants on CoNET.
2. **Random verifiable selection** (roulette over archive-node entropy) into **small** maintenance groups.
3. **\(Q_V=5/7\)** validator quorum for new-block proposals (or dissolve / promote standbys / reselect under §6.5).
4. **Archive node clusters** that store full state and perform quality checks / rollback.
5. **Mandatory CoNET L1 NFT** for every new chain: unique token id, **exactly one** of **asset / storage / trade** class, ownership, and (for asset class) **oracle-capped deposit ≤ 100 USDC-equivalent**—a **per-tip direct-loss ceiling**, **not** a claim that collusion motive → 0 (§12.2). **Trade-class** listings sell an existing asset or storage chain; **cross-layer atomic settle** is performed by the CoNET **L1 Settlement Contract**, not by tip-local rollback (§4.7).

Staking miners choose how many chains to underwrite based on their compute and network capacity. Lightweight validators need not store full history, so participation can be on-demand—reducing the centralizing pressure of capital-heavy PoS and ASIC PoW monopolies.

**Deployment substrate:** the L2 does not invent a new IP overlay. It is **loaded on CoNET DePIN**, so every waiting-pool advertise, task offer, block proposal, and vote travels as **wallet-addressed, OpenPGP-encrypted gossip** (entry A → mailbox B; listen via entry C ≠ B). Cryptographic details are developed in **§7**.

---

## 2. Problem Statement

| Problem | Why it matters |
| --- | --- |
| Slow new-block consensus | Global tip agreement does not scale with demand. |
| Waste of computer resources | Idle or competing work on empty / contested tips. |
| High gas / fee pressure | One market for blockspace prices out small payments. |
| 51% / capital concentration | PoW and PoS tend toward resource monopolies. |
| Scalability bottleneck | Single-chain or single-rollup ceilings. |
| Centralizing consensus | Large validators / pools dominate selection. |

**Design goal:** keep decentralization and immutability, but make **parallel per-ledger consensus** the unit of scale—so aggregate capacity can grow with participants and archive shards, **without** claiming the classical trilemma is dissolved (security stays conditional—§3.4).

---

## 3. Design Thesis

### 3.1 Parallel atomic ledgers

- **Parallelism (design target):** the network hosts **many** independent atomic chains; capacity scales with staking / archive-plane width, not with a shared global tip—**not** a marketing claim of “infinite free TPS.”
- **Atomic (per chain):** within one chain, tip advance requires a **\(Q_V=5/7\)** validator-committee attestation, then an **Archive Certificate** (= CommitQC) from the hosting archive shard (§6.5, §5.2.1)—**not** “100% agreement of every maintenance role.”
- **Bounded blast radius:** compromise or crisis on one chain does not halt unrelated chains; **asset** tips further bound **direct** cash blast (≤ 100 USDC).
- **Miner-scale growth:** each additional honest miner expands how many chains the network can underwrite **at the same time**; larger roulette pools can **lower** attacker share \(p\)—capture risk still needs \(P_{\mathrm{prop}}\) / \(P_{\mathrm{year}}\) (§12.3.1).

### 3.2 Event-based block production

If there is no event (transaction / state-change / storage write request), **no new block** is produced. **No event ⇒ no block.** This forbids empty-block overhead and matches payment / receipt / storage workflows. Effective **transactions-per-second bandwidth** is the sum of active event streams across parallel tips—not the throughput of one global slot clock.

### 3.3 Clustered maintenance groups (\(N_V=7\), \(Q_V=5/7\) per block)

A chain is not secured by “the entire network voting every slot,” but by a **two-layer** path: a **small, randomly drawn validator committee** for the **current block proposal**, then **archive-shard BFT** that issues an **Archive Certificate**—the only object that makes the tip final (§5.2.1, §6.5).

**Security root (product freeze):** the validator committee is the **proposal layer** (\(N_V=7\) drawn, deposit needs **\(Q_V=5\)** of **7** signatures); it does **not** alone constitute finality. Finality requires an **Archive Certificate (= CommitQC)** from the hosting shard’s HotStuff-style two-phase protocol (§5.2.1). No single archive node may accept, reject, roll back, or archive a tip unilaterally. **v1 does not use \(Q_V=5/5\)**—full-committee unanimity is rejected because one offline / timed-out / malicious signer can stall every round (§6.5).

**Canonical per-block path (product freeze):**

1. A **new event** appears on the chain (**no event ⇒ no block**).
2. The hosting **archive shard** (round coordinator + peers) draws **\(N_V=7\)** validators plus **\(S_{\mathrm{sb}}=2\)** standbys from the **on-demand miner waiting queue**.
3. The committee **votes**; on **≥ \(Q_V=5\)** accept signatures within \(T_{\mathrm{vote}}\), it **submits** the block / attestation set.
4. Archives **Mode A** replay the FSM on the DepositBundle; if **qualified**, they run **PrepareQC → CommitQC (= AC)** and **archive**; else **ArbitrationPool** → **RejectCommitQC** / reselect under the same lock rules (§6.3, §9).

Dishonest or timed-out members are replaced under §6.5 liveness rules; stake is at risk for equivocation / unjustified refuse. Many such committees run **in parallel** across chains, so confirmation latency is a **tiny committee** quorum plus a **small-shard** archive quorum—not a planet-wide slot.

### 3.4 Redefining the trilemma’s operating boundary (not eliminating it)

Classical blockchain design is often framed as an **impossible triangle**: at most two of **decentralization**, **security**, and **scalability**.

**Product freeze (canonical claim):**

> CoNET-DLE **does not eliminate** the blockchain trilemma. It **changes its operating boundary** by replacing a shared global execution tip with many **operationally isolated**, **value-bounded** (asset tips ≤ **100 USDC**), **event-driven** state machines. Aggregate throughput **can** scale with independent archive shards, while security remains **conditional** on shard honesty, committee sampling, L1 settlement, data availability, and client-side key isolation.

| Trilemma corner | Classical single-tip pain | CoNET-DLE response (conditional) |
| --- | --- | --- |
| **Scalability** | One tip’s TPS / gas market saturates | **Event-based** blocks + **small-group parallel consensus** across many tips + **archive-plane fission** (2/4/8…, §5.2) → **aggregate** bandwidth can grow with active ledgers and shards; **per-tip** latency still bounded by \(T_{\mathrm{vote}}\), reselections, and archive quorum—not “more miners ⇒ always faster” |
| **Security** | Scaling often weakens economic finality or trusts sequencers | Remains **conditional**: archive HotStuff-style **CommitQC/AC** (\(f=\lfloor(N_A-1)/3\rfloor\), \(Q_A=\lfloor 2N_A/3\rfloor+1\)); committee \(Q_V=5/7\) + \(P_{\mathrm{prop}}\) / \(P_{\mathrm{year}}\) (§12.3.1); \(E_C\le E_{\max}\) (§12.3.2); L1 settle / NFT; DA; asset-tip **direct** blast ≤**100 USDC** (not “collusion motive → 0”); client key-domain isolation (§4.5, §12.9) |
| **Decentralization** | Full-node / validator hardware & capital barriers concentrate power | **Role-split**, on-demand participants **need not sync all chain data**—still subject to stake, anti-grinding bonds, and honest-shard assumptions |

**Not claimed:** mathematical dissolution of the trilemma; unbounded free TPS; collusion motive → 0; observers cannot correlate; more miners ⇒ every transaction gets faster.

### 3.5 Relation to CoNET stack (conceptual)

```text
+-------------------------------------------------------------+
| CoNET mainchain / registry (identity, stake, NFT, AddressPGP)|
+-----------------------------+-------------------------------+
                              | anchors / fees / NFT / PGP registry
+-----------------------------v-------------------------------+
| CoNET-DLE L2 - Decentralization Cluster (this paper)         |
|  many asset / storage / trade chains x concurrent maintenance groups|
+-----------------------------+-------------------------------+
                              | encrypted gossip (wallet != IP)
+-----------------------------v-------------------------------+
| CoNET DePIN / CoNET-SI - wallet-address P2P + entry/mailbox |
|  OpenPGP ciphertext; A->B send; C->B listen; zero-trust hops|
+-------------------------------------------------------------+
```

**Privacy by construction:** L2 roles do not dial each other by IP. They address **wallet / PGP identities**; DePIN relays forward ciphertext. Entry and mailbox nodes learn routing key IDs, not business plaintext or stable client IPs. Separately, **asset holdings are multi-wallet fragments** recombined only on the client (§4.5, §7.6).

Canonical product line: each ledger is an **L1 NFT–bound** chain of class **asset**, **storage**, or **trade** (asset tips ≤ **100 USDC** oracle valuation; trade listings quote ≤ **100 USDC**, with **atomic delivery on L1 `settleTrade`**, §4.7), maintained by a randomly selected small group, with **event-driven** blocks only.

---

## 4. System Overview

### 4.0 Terminology hierarchy (normative vocabulary)

Use these layers **strictly**—do not treat them as synonyms:

| Layer | Name | Meaning |
| --- | --- | --- |
| L0 | **CoNET L1** | The PoS settlement / registry chain (NFT birth, `settleTrade`, MembershipCheckpoint, challenges, AssetVault). |
| L1 (DLE plane) | **Atomic chain / tip** | One L1-NFT-bound parallel ledger of class asset / storage / trade. “Chain” in DLE prose means this tip, **not** CoNET L1 unless marked “L1”. |
| L2 | **Micro-ledger** | Informal synonym for a tip’s event history under the class FSM—**not** a separate product. Prefer **tip**. |
| L3 | **Event FSM / state machine** | The frozen per-class transition table (§10). Tips have **no VM**; Mode A archives **replay** the FSM. |
| L4 | **Block / tip height** | One accepted event step on a tip (proposal → \(Q_V\) → AC). **No event ⇒ no block.** |
| L5 | **Archive shard** | The BFT committee that issues PrepareQC / CommitQC(=AC) for tips it hosts. |
| L6 | **Validator committee** | Per-block \(N_V=7\), \(Q_V=5/7\) **proposal** layer—**not** tip finality. |

### 4.1 Chain creation gate (mandatory L1 NFT)

Creating a new DLE chain is **not** a free L2-only act. The creator **must first** obtain a **unique NFT** on **CoNET L1**. That NFT is the chain’s sole public identity for:

| Bound by L1 NFT | Rule |
| --- | --- |
| **Uniqueness** | One NFT id ↔ one DLE chain; no anonymous genesis without L1 mint. |
| **Class (ternary)** | At mint / configure time the chain is fixed as **exactly one** of: **asset-class**, **storage-class**, or **trade-class**. |
| **Ownership / archive placement** | Owner and fee payer hooks bind to the NFT id; **archive shard** is \(i=H(\mathrm{nftContract}\|\mathrm{tokenId}\|R_e)\bmod S_e\) for the current archive-plane epoch (§5.2)—**not** raw `tokenId mod S`. **Canonical owner** of any DLE chain is **CoNET L1 `ownerOf(nftId)`**. |
| **Asset deposit (asset-class only)** | L1 assets are deposited as **ingress collateral / funding**; valuation uses the **L1 oracle**; total value **must not exceed 100 USDC-equivalent**. The **≤ 100 USDC** bound is **re-checked on every asset event** via oracle revaluation; over-cap outbound requires a **new chain** (§4.6). |
| **Trade subject (trade-class only)** | Genesis binds a **subject** asset- or storage-class NFT id to list for sale; **L1 Settlement Contract** atomically pays seller and transfers **that subject’s** L1 ownership (§4.7). |

**Micro-fragmentation as a loss bound (not an anti-collusion theorem):** capping each asset chain at **≤ 100 USDC** and encouraging many tiny parallel ledgers bounds **direct economic loss per successful asset-tip capture**—a first-class **loss ceiling**, not merely UX. It does **not** imply that collusion motive “tends to zero,” and it does **not** replace committee security, archive BFT, capture probabilities \(P_{\mathrm{prop}}\) / \(P_{\mathrm{year}}\) (§12.3.1), or **per-epoch committee cumulative exposure** \(E_C\le E_{\max}\) (§12.3.2). The same fragmentation is the substrate of **asset privacy**; **custody security** further requires **key-domain + recovery-domain isolation** (§4.5, §12.9). Runtime **revalue + spillover mint** (§4.6) keeps the oracle book-value cap honest after price moves.

### 4.2 Three classes of chains

| Class | Purpose | Ingress / fee rules |
| --- | --- | --- |
| **Asset-class chain** | Transferable value ledger bound to the L1 NFT | Deposit **L1 assets** as chain funding; **L1 oracle** values the deposit; **hard cap ≤ 100 USDC-equivalent**. On every **new event**, the transfer / balance is **revalued** (§4.6). From genesis onward, every **transfer event** pays **0.01%** of the transferred value in **USDC** (oracle-valued); of that fee **50% → hosting archive**, **50% → \(Q_V\) accepting validators** (§13). |
| **Storage-class chain** | Data / logs / **creator content** with paid access; **Copyright ZERO** version nodes; **sales books** | Owner may embed **fragmented encrypted content** + access policy (§4.8). Tips may fork into a **version tree** (§4.9). Tip records **social events** and an append-only **sales-revenue ledger** that links to parallel **asset-class** txs (§4.10). **Content-based fees and access** settle in **conet-GB** (not the USDC 0.01% rail); unpaid → **new blocks stop**. Buying **access** ≠ buying the NFT; selling a branch uses trade-class (§4.7). |
| **Trade-class chain** | Short-lived **L2 listing / match coordinator** for selling an existing **asset** or **storage** chain (NFT-style whole-ledger sale) | User-opened; binds **subjectNftId** at genesis; listing quote **≤ 100 USDC-equivalent**; **large orders forbidden**. Tip coordinates freeze / match / **SettleReady** AC; **atomic pay + NFT transfer** runs on CoNET **L1 Settlement Contract**, then **trade tip closes** (§4.7). Listing / settle **event fees** in **USDC** under the same **0.01% → 50% archive / 50% validators** split where the fee base is the quote / settle notional (§13). |

Class is chosen when the L1 NFT is created / configured and is **immutable** for that NFT. **No dual-class** chain: a tip cannot be asset and trade at once. Selling “more than one fragment” means **multiple atomic trade listings**, each ≤ 100 USDC—not one oversized order.

### 4.6 Asset-class event revaluation & spillover new chain

Product freeze for **asset-class** tips (keeps the ≤ **100 USDC** invariant live, not only at mint):

1. On every **new event** (especially a **transfer**), the chain **revalues** its balance / the proposed transfer with the **L1 oracle** (same oracle family as ingress).
2. If the revalued **chain balance ≤ 100 USDC-equivalent**, the transfer may proceed on **this** chain under normal §6.3 rules (including the **0.01%** fee in **USDC**, split **50% archive / 50% validators**—§13).
3. If the revalued **chain balance > 100 USDC-equivalent**, the **outbound portion** that would leave this tip (or the excess over the cap) **must not** stay as a single over-cap transfer on this chain: the owner / client **must create one or more new asset-class chains** (new L1 NFT + oracle-capped deposit ≤ 100 USDC each) and move that outbound / excess value onto those new tips.
4. Consensus and archive reject an asset transfer event that would finalize a tip with revalued balance **> 100 USDC** or that tries to send the over-cap slice without a matching **new-chain** birth certificate.

Oracle appreciation after mint is the typical trigger: ingress was ≤100 at genesis, but a later event’s revaluation can push the economic balance over the cap—hence **revalue on event + spillover mint**, not a one-time check.

**L1 AssetVault (product freeze — force-exit binding).** Asset-class ingress collateral is locked in a CoNET **L1 AssetVault** keyed by `assetNftId` (same NFT that binds the tip). Tip spendable balances are **claims** against that vault up to the oracle-capped proven amount under the latest good AC `tipStateRoot` (§5.2.1). Ordinary transfers move tip claims; **L1 unlock / force withdraw** is the only path that returns vault assets to an EOA. Mapping rule (normative):

```text
withdrawableL1(assetNftId) ≤ min(
  AssetVault.locked(assetNftId),
  provenTipBalance(assetNftId, lastGoodAC.tipStateRoot)
)
```

Spillover mints open **new** vaults for new NFTs; they do not silently enlarge an existing vault past the per-tip 100 USDC ceiling.

### 4.7 Trade-class: L2 coordinator + L1 Settlement Contract atomicity

Product freeze for **decentralized atomic sales** of whole ledgers (analogous to **NFT trading** of the chain’s birth certificate).

**Role split (normative):**

| Layer | Role |
| --- | --- |
| **Trade-class DLE tip** | **Off-chain / L2 order book & state coordinator**: listing parameters, freeze signals, match intent, `SettleReady` Archive Certificate |
| **CoNET L1 Settlement Contract** | **Sole provider of cross-layer atomicity**: pay seller **and** transfer `subjectNftId` in **one** L1 transaction—or neither |

**Why tip-local “atomic rollback” is not enough**

- A DLE tip **cannot reverse** an NFT transfer (or payment) that has already **finalized on L1**.
- Writing that buyer payment and `subjectNftId` transfer must succeed in the “same tip settlement event set,” then “roll back the tip,” does **not** create **cross-layer** atomicity: L1 state and tip state can diverge if either side commits alone.
- Therefore production **MUST** settle trades through an L1 contract; tip events alone are **insufficient**.

**L1 Settlement Contract (product freeze sketch)**

Call shape (ABI names illustrative; semantics frozen):

```text
settleTrade(
    tradeId,              // trade-class NFT / listing id
    subjectNftId,         // asset- or storage-class NFT for sale
    buyer,
    paymentProof,         // escrow pull / pull-authorization for quote asset
    dleArchiveCertificate // AC proving tip SettleReady for this tradeId + quote + buyer + nonce + deadline
)
```

In **one** CoNET L1 transaction the contract **MUST**:

1. Verify the **DLE Archive Certificate (= CommitQC)** under the rules below (tip identity, SettleReady typed payload, DA binding, `membershipRoot`, ≥ \(Q_A\) **EIP-712** commit signatures—§5.2.1).
2. Verify **quote**, **nonce**, **deadline**, and **buyer** against the AC-committed listing / match fields (and oracle ≤ **100 USDC** at listing time).
3. Transfer **escrowed payment** to the seller (or release seller’s claim atomically with step 4).
4. Transfer **`subjectNftId`** to `buyer` (from seller / freeze escrow that held the NFT).
5. Mark **`tradeId` settled** (or burned / closed on the L1 trade NFT registry).
6. **Reject re-execution** of the same `tradeId` / settle nonce (idempotent fail).

If any check fails, the **entire L1 call reverts**—no partial NFT move, no partial payment release.

**How L1 verifies the SettleReady AC (product freeze):**

| Rule | Normative requirement |
| --- | --- |
| **Signature scheme** | Commit signatures on the AC are **EIP-712** typed data (domain: `CoNET-DLE-Archive`, `chainId` = CoNET L1, `verifyingContract` = Settlement / MembershipCheckpoint registry). **EIP-191 text blobs are rejected** for settle / DA-binding ACs. |
| **Typed SettleReady payload** | AC (or its `blockHash` / event commitment) **MUST** bind at least: `tradeId`, `subjectNftId`, `seller`, `buyer`, `quoteAsset`, `quoteAmount`, `nonce`, `deadline`, `tipStateRoot`, `daRoot` (+ DA fields in §5.2.1), `membershipEpoch`, `membershipRoot`. |
| **Membership on L1** | Hosting shard publishes **`archiveMembershipRoot[membershipEpoch]`** to an L1 **MembershipCheckpoint** (via ≥ \(Q_A\) MembershipUpdateCertificate or bonded L1 forced update). `settleTrade` verifies AC signatures against **that checkpointed root**—not a tip-only gossip claim. |
| **Quorum economics** | L1 **MUST NOT** verify \(Q_A\) raw ECDSA recoveries on every settle when gas would dominate a ≤100 USDC quote. Preferred v1 path: L1 stores a **short AC checkpoint / inclusion proof** (e.g. Merkle / aggregate attestation already checked off-chain and bonded) that commits the typed SettleReady fields + `membershipRoot`; open bytecode may use multi-sig only for small \(N_A\) testnets. |
| **Stale roster** | An AC with `membershipEpoch` / `membershipRoot` **not** equal to the L1 checkpoint for that shard+epoch is **invalid**. After roster change, old members **cannot** settle with a pre-change AC. |
| **Post-roster / tip writeback** | Tip marks **Settled** only after observing the L1 settle tx. L1 reorg deeper than the Settlement finality assumption: tip must follow L1—never invent tip-only Settled. |

**DLE tip workflow (coordinator):**

1. **Subject:** an existing **asset-class** or **storage-class** chain identified by its **L1 NFT** (`subjectNftId`). The seller must be the current L1 owner of that subject.
2. **Open listing:** the seller **mints a trade-class** L1 NFT / DLE tip whose genesis binds `subjectNftId`, quote currency/amount (**oracle-valued ≤ 100 USDC-equivalent**), escrow / payment asset rules, and a settle **deadline**. **Atomic orders only—no large orders**.
3. **Listing freeze:** while the trade tip is **Open** / **Locked**, the subject NFT is **frozen against ordinary transfer** on L1 (registry / settlement escrow), and asset-class subjects reject outbound drains that would empty the tip before settle. Freeze is an L1 lock coordinated by the tip—not tip-only soft state.
4. **Match → SettleReady:** buyer locks / authorizes payment (typically into the **L1 settlement escrow** or an allowance the settle call can pull). The tip records match fields and archives a **`SettleReady`** event under normal \(Q_V\) + **AC** rules. That AC is the `dleArchiveCertificate` input to `settleTrade`.
5. **L1 settle (atomic delivery):** any permitted caller submits `settleTrade(...)`. **Only after** the L1 tx succeeds is canonical ownership **buyer = L1 `ownerOf(subjectNftId)`** and payment finalized. The tip then records **Settled** (with L1 tx hash) and **closes**. The **subject asset/storage tip continues** under the new owner (it is **not** closed).
6. **Failure / cancel / expire before L1 settle:** tip may **Cancelled** / **Expired → Closed** and signal L1 **unfreeze**; no claim that tip rollback undoes an already-final L1 transfer (there must not have been one). After a successful L1 settle, tip state **must** follow L1—never invent a tip-only “un-settle.”
7. **What is sold:** the **subject** NFT / ledger—not the trade-order shell. Transferring the trade NFT itself is not the product path for buying the listed chain.
8. **Portfolio sale:** selling many ≤100 USDC fragments requires **many** trade listings (one subject tip each), consistent with micro-fragmentation and the per-tip loss ceiling (§4.1, §4.5, §12.2).

**Lifecycle (trade tip — normative, §10.2):** `None → Open → Locked → SettleReady → Settled → Closed` (or `Cancelled` / `Expired → Closed` without L1 settle). **Matched** is **not** a separate tip state: match fields are written on the **`SettleReady`** event while in **`Locked`**. **Settled** is defined by **L1 settlement success**, not by tip vote alone. Full transition table, encodings, `tipStateRoot`, and error codes: **§10**.

### 4.8 Storage-class creator economy (fragmented content + GB access)

Product freeze for **creator-economy storage tips** (paid content access without transferring the storage NFT):

1. **Publish (owner):** at create / configure time the owner splits the work into **encrypted fragments**, builds an **assembly index** (fragment hashes + order + fragment keys / unwrap material), and **seals that index to authorized delivery miners**—not to the tip, not to archive, not to the validator committee. Fragments and the encrypted index are stored on **Beamio IPFS** (`keccak256(utf8(payload))` fragment hashes). The storage tip records **only public commitments**: `contentIndexHash`, `authorizedNodeKeyHash[]` (AddressPGP / Guardian node key ids), **access price in conet-GB**, access duration, and optional retention policy. Plaintext content **and plaintext index** **never** sit in tip state or in consensus votes.
2. **Private index handoff (how miners get the secret without tip exposure):**
   | Layer | Holds | Who can read |
   | --- | --- | --- |
   | **Storage tip** | `contentIndexHash` + authorized key-hash set + prices | Everyone (commitment only) |
   | **IPFS** | OpenPGP (or hybrid) **ciphertext of the assembly index** | Only miners whose PGP was a recipient |
   | **IPFS** | Encrypted content fragments | Useless without index unwrap material |
   | **Miner local** | Decrypted index + temporary plaintext during assembly | That authorized delivery miner only |
   | **Buyer package** | Ciphertext under **buyer PGP** | Buyer only |

   - **Encryption mode (product default):** **OpenPGP multi-recipient** — one index ciphertext package whose recipients are the owner-chosen authorized miner PGP keys (any one of them can decrypt). Optional alternative: **per-miner copies** (`nodeKeyHash → indexCipherHash` manifest) when the owner wants independent revoke/re-seal without re-encrypting a shared blob.
   - **Configure path:** owner client (1) builds plaintext index locally; (2) encrypts to authorized keys; (3) uploads ciphertext → obtains `contentIndexHash`; (4) submits a tip **Configured** event carrying **only** the hash + authorized set + price policy. Tip gossip / DePIN never carries the decryptable index as tip payload.
   - **Trust boundary:** authorized delivery miners **are** trusted to see plaintext while assembling (delivery custody). Tip consensus validators and archive peers verify **hashes and events only**—they have **no** index private key and **must not** require plaintext for quality-check. Owner mitigates miner leak risk by: small authorized set, stake / reputation selection, rotation (re-encrypt index to a new set + new `contentIndexHash`), watermarks, and revoke events that drop a `nodeKeyHash`.
   - **No “submit secret on tip” anti-pattern:** rejecting any program that puts raw index JSON, fragment AES keys, or unencrypted assembly instructions into tip blocks or public votes.
3. **Access rights:** the owner sets who may purchase (open / allowlist), the **conet-GB** price, and expiry. Changing price / policy is an event on the storage tip (subject to the frozen storage-class event transition table, §4.8 / §6.3). Re-sealing the index (new authorized set) is a **Configured** update with a new `contentIndexHash`.
4. **Purchase (visitor):** the buyer pays the owner-set **conet-GB** price, binds **buyer PGP** (`buyerPgpKeyHash` + AddressPGP-resolvable public key), and opens a purchase event. Payment and PGP binding are verified before delivery starts. **Access purchase does not transfer** storage-chain L1 ownership (contrast §4.7). The purchase event is **public metadata** (who bought, buyer key hash, deadline)—it does **not** re-transmit the private index.
5. **Delivery (authorized miners):** miners listen for purchase events (DePIN gossip / tip feed). A miner that holds a matching authorized key:
   - fetches the index ciphertext from IPFS via `contentIndexHash`;
   - decrypts the index with **its** PGP private key (off-tip);
   - fetches fragments from IPFS and **reassembles** the content locally;
   - **re-encrypts** the delivery package under the **buyer’s PGP**;
   - uploads the buyer-bound ciphertext to IPFS and records `buyerEncryptedContentHash` (plus buyer-bound index pointer as required by the tip program).
6. **First-completer:** the first valid miner completion locks the delivery record for that purchase; later completers must fail or no-op. Consensus / archive attest the purchase and completion events via the normal **validator-committee** path; plaintext must not appear in public votes.
7. **Buyer restore:** only the buyer, with their PGP private key, can decrypt the buyer package and use the **buyer-bound index** to restore the original content. Relays, archive peers, and unrelated miners see ciphertext / hashes only.
8. **Currency:** access price and related content-delivery fees are denominated in **conet-GB** (storage-class content rail—§13). Tip retention / unpaid halt rules from §4.2 still apply to storage maintenance fees.
9. **Expiry / retention:** after `accessExpiresAt` (and/or unpaid `storagePaidUntil`), miners must stop serving access URLs; expired purchases cannot reopen without a new pay event.
10. **Tip / module state (CopyrightContentModule-aligned):** storage-class tip state (and the Beamio catalog module when used as an L1-adjacent surface) keep **bounded** fields only—**no** unbounded on-tip arrays of buyers, comments, or URLs:

| Field | Meaning |
| --- | --- |
| `contentIndexHash` | IPFS hash of the **encrypted** assembly index (`keccak256(utf8(payload))` → `bytes32`) |
| `authorizedNodeKeyHash[nodeKeyHash]` | Owner-chosen delivery miner / Guardian PGP key hashes |
| `purchaseId` | Derived id (`tipNft` / card + buyer + nonce) for one access purchase |
| `buyerPgpKeyHash` | Buyer PGP bound at purchase (AddressPGP-resolvable) |
| `accessExpiresAt` | Owner-set access deadline for that purchase |
| `storagePaidUntil` | How long the completer node is paid to retain / serve |
| `completedByNodeKeyHash` | First-completer; `0` until locked |
| `buyerEncryptedContentHash` | IPFS hash of buyer-PGP ciphertext package |

11. **Normative events (same semantic names as CopyrightContentModule):**
    - `CopyrightContentConfigured` — index hash, authorized set, price / policy;
    - `CopyrightPurchaseOpened` — `purchaseId`, buyer, `buyerPgpKeyHash`, `accessExpiresAt`;
    - `CopyrightDeliveryCompleted` — `purchaseId`, `nodeKeyHash`, `buyerEncryptedContentHash`;
    - `CopyrightStorageFeeCharged` — periodic retention fee to the completer (DLE: **conet-GB**; Beamio catalog path may mirror with B-Unit indexer rows).
12. **Buyer-bound purchase integrity:** purchase must be signed by the buyer EOA/AA; signature binds at least `buyer + tipNftId + buyerPgpKeyHash + deadline + nonce` so a third party cannot swap the delivery PGP after payment.
13. **Short-lived access URLs:** after `Completed`, serving miners (or a thin proxy) issue **time-limited HMAC / signed URLs** that re-check chain/tip expiry and buyer authorization on each issue. **Never** expose a permanent naked `getFragment` URL as the product access path.
14. **Storage / retention fees (completer economics):** owner pays the **first-completer** (or active authorized set) **periodically** to keep serving; update `storagePaidUntil`. Prefer cycle renewals over perpetual prepay. Unpaid → stop URLs; proven non-serving nodes may be revoked from `authorizedNodeKeyHash`. Settlement of false “complete” claims SHOULD wait for buyer-accessible confirmation, a challenge window, or access heartbeats—not instant unconditional payout on first report alone.
15. **Privacy & copyright thesis (what this design achieves):**

| Goal | Mechanism |
| --- | --- |
| **Decentralized delivery** | Any authorized DePIN miner may race; first valid completer locks; no central CDN required |
| **Copyright control** | Owner sets price, authorized set, expiry; access ≠ NFT ownership; forks are new NFTs (§4.9) |
| **Content privacy (public observers)** | Tip/L1: hashes only; IPFS: ciphertext; relays: OpenPGP E2E; validator committee never sees plaintext |
| **Buyer privacy of payload** | Final package encrypted only to **buyer PGP** |
| **Teaser vs secret** | Public metadata / teaser stays outside delivery state; dynamic delivery hashes stay in tip/module—not rewritten into marketing metadata JSON |
| **DoS-safe tip** | Counts + hashes + mappings on-tip; comment bodies / URL lists off-tip (IPFS / indexer) |

    **Honest limit:** authorized delivery miners see plaintext during assembly (trusted custody set). Default public purchase events may still link **buyer address ↔ content id**; stronger unlinkability (blinded purchase) is a future option, not v1 consensus.

16. **Two surfaces, one thesis:**

| Surface | Role |
| --- | --- |
| **DLE storage-class tip FSM (§4.8)** | Native Copyright ZERO / creator economy on parallel atomic tips; fees in **conet-GB**; \(Q_V=5/7\) + archive finality; **no tip VM** (§10) |
| **Beamio `CopyrightContentModuleV1`** | Same state machine on BeamioUserCard / issued-NFT catalog paths (Cluster precheck + Master write); **does not** replace DLE tips—product bridge / L1-adjacent catalog delivery |

    Card + Module extension stays within Factory-stable boundaries; DLE tips remain isolated programs. Indexer may book access sales on the storage tip (§4.10) independently of catalog metadata.

**Lifecycle (content access):** `Configured → Purchased → Delivering → Completed` (or `Expired` when `accessExpiresAt` / unpaid `storagePaidUntil`).

**Risk → mitigation (normative):**

| Risk | Mitigation |
| --- | --- |
| Fake first-completer | Lock `completedByNodeKeyHash`; delay storage fee until challenge / heartbeat |
| Buyer PGP swap | Purchase signature binds `buyerPgpKeyHash` |
| Authorized miner leaks index | Small trusted set; rotate / per-miner seal; watermark; revoke |
| URL replay | Short-lived signed URL + expiry checks |
| Paid but not serving | Periodic `storagePaidUntil`; challenge; revoke |
| Tip bloat | No infinite on-tip buyer/URL arrays |
| Plaintext in logs / tip | Forbidden; only hashes on-chain |

**Separation of concerns:**

| Action | Moves |
| --- | --- |
| Pay **conet-GB** for access (§4.8) | Buyer-bound ciphertext package; **not** storage NFT owner |
| Trade-class sell storage tip (§4.7) | **L1 NFT ownership** of the whole storage ledger (any tree node)—via L1 `settleTrade`, not tip-local rollback |
| Fork / modify content (§4.9) | New storage NFT + tip; parent lineage preserved |
| Record sale / link asset tx (§4.10) | Storage **revenue journal** row + pointer to parallel **asset-class** tip event |

### 4.9 Copyright ZERO: version tree, social history & Web of Trust valuation

Product freeze mapping storage-class tips to a **Copyright ZERO**-style creative graph (versioned works + attributable social proof for markets):

1. **Version tree:** each storage tip is a **node** in a directed lineage. The **root** is the original creator’s tip / L1 NFT. A **modifier** (derivative, edit, remix, localization, etc.) **forks** by minting a **new storage-class L1 NFT + tip** that binds:
   - `parentNftId` (immediate parent);
   - optional `rootNftId` (tree root);
   - `lineageHash` / content delta or new `contentIndexHash` (§4.8);
   - `modifier` identity (EOA / AddressPGP).
   The parent tip is **not** overwritten; history is append-only. The tree may grow arbitrarily deep / wide under retention fee rules.
2. **Each branch point is an independent NFT:** every node (root or branch) has its **own** L1 NFT and may be listed via **trade-class** (§4.7) independently of siblings or parent. Buying a branch transfers **that node’s** ownership—not the whole tree—unless separate listings cover other nodes.
3. **Social / citation ledger on the tip:** storage programs accept attested events such as:
   - **like** / unlike (or one-way like with anti-spam rules);
   - **comment** (hash of comment body + optional IPFS fragment; signer-bound);
   - **citation / reference count** (another tip or external id references this node);
   - optional **share / view** counters if product-enabled.
   These are **first-class tip history**, not off-chain scrapes. Fees for social writes (if any) settle in **conet-GB**.
4. **Web of Trust (WoT) basis:** valuation inputs are not raw counts alone. Markets and indexers weight signals by **who** signed them—wallet reputation, AddressPGP identity, historical stake / activity, and graph edges among signers. Example: a **like** or **comment** from a high-trust public figure (illustratively “Musk”) is a stronger auction signal than an anonymous spam wallet. DLE records the **signed event**; **WoT scoring** may be computed by open indexers / auction venues on top of that immutable history—consensus does not invent a single global “price oracle” from likes.
5. **Auction / market use:** trade-class listings and external auction UIs SHOULD surface, for each subject storage NFT:
   - tree position (root / depth / parent);
   - social histogram (likes, comments, citations) with **signer identities**;
   - access-economy metrics if configured (§4.8 purchase count—careful of privacy);
   as **trust-weighted evidence** for fair discovery and bidding—not as guaranteed floor prices.
6. **Separation:**
   | Layer | Role |
   | --- | --- |
   | Content ciphertext + GB access (§4.8) | Who may **read** the work |
   | Version tree + branch NFT (§4.9) | Who **owns / forks** which edition |
   | Social / WoT history (§4.9) | Public **reputation graph** for valuation |
   | Sales-revenue journal (§4.10) | Books for what was sold and which **asset-class** txs paid |
   | Trade-class settle (§4.7) | **L1 `settleTrade`** atomic **ownership transfer** of a chosen node NFT |
7. **Integrity:** social and fork events are tip blocks under §6.3 (event-only, \(Q_V=5/7\) + archive). Spoofed “celebrity likes” fail without a valid EIP-191 / AddressPGP-bound signature from that wallet. Tip state stores counts + event hashes; unbounded comment bodies live in IPFS fragments, not infinite on-tip arrays.

**Lifecycle (tree node):** `Minted (root|fork) → Social/content events… → (optional) Listed via trade → Settled under new owner`; the node tip **continues** after ownership change.

### 4.10 Storage sales-revenue ledger & parallel asset-class txs

Product freeze: a storage tip is not only content + social history—it is also the **sales books** for that creative node. Economic settlement may run on **separate, parallel asset-class** tips (micro-fragmented ≤ **100 USDC**); the storage tip **records** the sale and **points at** those asset txs.

1. **Sales-revenue journal (on the storage tip):** append-only events such as:
   - `saleKind`: `accessPurchase` | `nodeNftTrade` | `royalty` | `other` (program-defined);
   - `amount` + `currency` (typically **conet-GB** for access; oracle-valued units for NFT trade proceeds as configured);
   - `buyer` / `payee` / `feeSplit` (owner, modifiers, protocol share);
   - `storageEventId` (this tip’s sale event id);
   - optional privacy-safe aggregates (running `grossSales`, `netToOwner`) without putting plaintext content on-tip.
2. **Parallel asset-class link (mandatory when value moves on an asset tip):** each revenue row that corresponds to a value transfer MUST reference the parallel asset ledger:
   - `assetNftId` — the asset-class L1 NFT / tip that executed the payment or proceeds transfer;
   - `assetTxId` / `assetEventHash` — that tip’s transfer (or settle-linked) event;
   - optional `tradeNftId` when the sale was mediated by a trade-class tip (§4.7).
   Archive / indexers SHOULD reject a storage “sale booked” event that claims an asset settlement without a matching finalized asset-tip event (same economic amount / parties within program rules).
3. **Dual-track model (no free cross-chain calls):**
   | Track | Chain class | Holds |
   | --- | --- | --- |
   | **Books** | **Storage-class** | What was sold, to whom, fee split, lineage node, links |
   | **Cash / value** | **Asset-class** (parallel tip(s)) | Actual ≤100 USDC (revalued) transfers / balances |
   Isolation stays: tips do **not** call each other; linkage is by **committed references** inside each tip’s events + archive cross-check. Multiple asset tips may fund one storage node over time (fragmented proceeds).
4. **Access purchase (conet-GB):** GB paid for content access (§4.8) still writes a storage revenue row. If the product also moves oracle-valued collateral on an asset tip (escrow, tip, royalty pool), that asset tx is linked in the same row.
5. **Node NFT trade:** when trade-class settles ownership of the storage NFT (§4.7), the **subject storage tip** records a `nodeNftTrade` revenue/ownership-sale journal entry pointing at the trade tip settle event and any **asset-class** payment tip(s) used for the buyer’s funds.
6. **Royalty on forks (optional program rule):** a child tip sale (§4.9) may emit a royalty row on the **parent** (or root) storage tip, again linking the child sale’s asset tx ids—so the tree’s books stay auditable without merging tips.
7. **Auction / WoT use:** markets MAY show cumulative linked revenue (gross / net) next to social WoT signals (§4.9)—still evidence, not a consensus floor price. Failed or unlinked “sales” must not inflate books.

**Lifecycle (sale row):** `SaleOpened → (optional Locked) → Booked` with `assetTxId` (+ delivery complete for access) or `Cancelled` / `Expired` without booking.

### 4.3 Chain properties

- **Ownership** is defined by the **L1 NFT** (`ownerOf`) plus local genesis rules; trade settle updates **subject** ownership on L1 (§4.7). Storage **access** sales update purchase / delivery records, not NFT owner (§4.8). **Forks** mint a new NFT under the modifier; parent ownership is unchanged (§4.9). **Sales books** live on the storage tip and **reference** parallel asset-class txs (§4.10).
- **Limited functionality (no tip VM):** genesis binds **exactly one class** (**asset** / **storage** / **trade**) and that class’s **frozen event schema** / transition table (§6.3, §10). Tips do **not** host a general-purpose VM or user-deployed programs. Chains do **not** freely message each other (isolation by design). Trade tips bind a subject id; cross-tip matching uses index / matcher tasks, not free cross-chain calls. Storage tips host content-index hashes, purchase/delivery events, **parent lineage**, **social event** records, and a **sales-revenue journal** with **asset-tip references** (§4.8–§4.10). Arbitrary application workflows compose tips + L1 at the **application layer**.
- **Security source:** stake + random **small-group** selection + **archive-shard BFT** (HotStuff-style PrepareQC→CommitQC=AC, §5.2.1) + **L1 NFT** binding; asset chains additionally inherit the **≤ 100 USDC** economic bound; trade listings inherit the **≤ 100 USDC** quote bound with **atomic delivery only via L1 `settleTrade`** (§4.7); storage content delivery relies on **PGP fragmentation + buyer re-encryption** so public tip observers never receive plaintext (§4.8); social valuation relies on **signed WoT history**, not forgeable counters (§4.9); revenue claims require **linkable AC-finalized asset-class events** (§4.10).
- **Fee denomination (frozen):** **storage-class** content / access / retention fees → **conet-GB**; **asset-class / trade-class** tip event fees → **USDC** at **0.01%**, split **50% hosting archive / 50% \(Q_V\) validators** (§13). Asset-class tips remain the parallel **value rails** under the oracle ≤100 USDC cap.

### 4.4 Role map

```mermaid
flowchart TB
  subgraph ArchiveShard["Hosting archive shard BFT"]
    Coord[ArchiveCoordinator round-robin]
    Prep[PrepareQC]
    AC[CommitQC equals AC]
    PoH[PoH local clocks]
    Pool[Participant waiting pool]
  end

  subgraph ChainGroup["Per-block proposal layer"]
    I[Issuer / Creator optional]
    W[Witnesses optional]
    V["Validators N_V=7 Q_V=5/7"]
  end

  User[User / Owner] -->|tx or ledger request| Pool
  Pool --> Roulette[Verifiable roulette]
  Roulette --> ChainGroup
  I --> W
  I --> V
  W -->|signed proposal| ArchiveShard
  V -->|DepositBundle Q_V| ArchiveShard
  Coord --> Prep
  Prep --> AC
  AC -->|tip finality Mode A| ChainGroup
  PoH --> Pool
```

### 4.5 Natural privacy + custody security (raise clustering cost; ERC-5564 canonical)

Classical public ledgers leak **who owns how much** because a user’s economic identity collapses onto **one** (or few) addresses—and that same collapse means **one private key** can spend everything. CoNET-DLE’s product answer is **natural privacy** without requiring baseline ZK shielding, and **higher asset security** from the same fragment set. The asset-privacy claim is **deliberately modest**:

> **Claim (frozen):** multi-address fragmentation **raises the cost of on-chain clustering** and **breaks the direct correspondence** “one address = the owner’s complete portfolio.” It does **not** assert strong anonymity, unlinkable global identities, or that “the observer fails.”

1. **Ingress fragmentation:** when an owner moves value into L2 (asset-class deposit / mint path), the economic unit is **already fragmented**—many **≤ 100 USDC** atomic chains and/or balances under **many distinct wallet addresses**.
2. **Client-only ownership view:** only the **owner’s client** holds the mapping that **recombines** those fragments into a single logical asset for the user. Public tip scanners no longer get a **single-address portfolio dump**; they face a **harder clustering problem**.
3. **Residual clustering channels (honest residual risk):** observers may still correlate fragments via, among others:
   - the **same L1 deposit / bridge source**;
   - **many NFTs minted in the same time window**;
   - **similar amounts**;
   - the **same gas payer**;
   - **oracle call timing**;
   - **same-device network timing** (client ↔ entry/mailbox);
   - **simultaneous spend** patterns;
   - **re-aggregation** after NFT / trade settlement;
   - **fee-payer** addresses (including DLE fee EOAs).

   Product wallets SHOULD harden against the easy channels (fresh stealth receives, avoid shared gas EOAs when possible, avoid naive consolidation). Hardening does **not** turn the design into a mixnet or ZK anonymity set.
4. **Communication privacy:** every L2 task, transfer instruction, and consensus message rides **CoNET DePIN** wallet-address gossip with OpenPGP E2E (§7)—relays never see plaintext amounts or intent.
5. **Transfer privacy (same dual stack):** a transfer simultaneously enjoys **comms privacy** and **asset privacy**. Value moves as **fragmented** events; the **recipient does not accept into a single wallet address** either—receipt is spread across addresses only the recipient client can reassemble.
6. **Canonical receive protocol = ERC-5564 (CoNET L1 / EVM):** product wallets freeze **one** stealth / receive-code profile. BIP-47, BIP-352, and ERC-5564 share an ECDH “design-reference family,” but they are **not** freely interchangeable runtimes. CoNET L1 is an **EVM account model**; therefore:

   | Decision | Freeze |
   | --- | --- |
   | **Canonical on CoNET** | **ERC-5564** (+ ERC-6538 meta-address registry where used) |
   | **BIP-47** | Design reference only (reusable payment-code lineage)—**not** the CoNET L1 runtime |
   | **BIP-352** | Design reference only; specified for **Bitcoin UTXO / Taproot inputs**; **cannot** be dropped onto EVM accounts; recipients must **scan blocks** for payments—**not** adopted as CoNET’s EVM profile |

   **CoNET ERC-5564 profile MUST freeze (wallet-layer normative):**

   | Element | Role |
   | --- | --- |
   | **Stealth meta-address** | Payee’s public receive code (scan + spend pubkeys) |
   | **Ephemeral public key** | Sender-generated; published with the payment |
   | **View tag** | Cheap filter so scanners skip most announcements |
   | **Announcement event** | On-chain (or L1-indexed) notice that a stealth payment occurred |
   | **Scan key / spend key** | Scan detects ownership; spend alone controls funds |
   | **Multi-address batch derivation** | Sender predicts **n** receive EOAs and pays each a **≤ 100 USDC**-class atomic fragment (§4.6) |
   | **Wallet recover + scan protocol** | From mnemonic / scan key, re-scan announcements and rebuild the fragment map |

   | Layer | Role |
   | --- | --- |
   | **Recipient** | Publishes one **ERC-5564 stealth meta-address** |
   | **Sender client** | Derives **n** stealth addresses, emits announcements, pays ≤100 USDC-class fragments |
   | **Recipient only** | Scans with the **scan key**, spends with the **spend key**, recombines in the client map |
   | **DLE tip / archive / validator committee** | See ordinary multi-address events + hashes; **do not** generate, assign, or “oracle” receive addresses |

   **Hard boundary:** CoNET-DLE **does not** add an on-chain address oracle, archive-assisted address factory, or validator-mediated key exchange. Stealth derivation and scanning stay in the **wallet / client**; DLE only **carries the fragmented result**.

   **Recipient anonymity is not an L2-infrastructure duty:** raising payee unlinkability beyond “one address ≠ whole portfolio” (stronger anonymity sets, timing/gas hygiene, receive UX) is a **client product design** problem—*how* wallets use DLE’s multi-address + ERC-5564 surface. Tips, archive shards, and validator committees **cannot** invent recipient anonymity for poorly designed clients.
7. **Custody security (qualified—many keys ≠ safer by default):** fragments SHOULD be keyed by **distinct private keys**, but that claim is **conditional**:

   > “No single private key controls the entire portfolio” is true **only if** those keys are **independently protected**. If all fragment keys are derived or recovered from **one mnemonic**, **one device**, **one client database**, or **one weak recovery password** (e.g. six-digit PIN), an attacker who obtains the master seed or the client recombination database still seizes **all** value.

   Distinguish three layers:

   | Layer | What it does | Alone sufficient for custody? |
   | --- | --- | --- |
   | **Address fragmentation** | Many EOAs / tips; raises clustering cost; breaks one-address portfolio dump | **No** |
   | **Key-domain isolation** | Spend material not co-located; distinct derivation domains; hardware / threshold for high-value slices | **Required** for the multi-key safety claim |
   | **Recovery-domain isolation** | Encrypted recovery map; separate recovery secrets; no single weak password unlocks every spend key | **Required** for the multi-key safety claim |

   **Hierarchical key vault (product SHOULD):**

   | Practice | Role |
   | --- | --- |
   | **Scan key online** | Detect stealth payments / rebuild view without exposing spend |
   | **Spend keys batch-derived** | Derive spend material in batches; do not keep the entire spend tree hot |
   | **Hardware or threshold for high-value fragments** | Cold / multi-party control for larger slices |
   | **Encrypted recovery map** | Recombination DB ciphertext at rest; unlock ≠ plaintext dump of all keys |
   | **Per-shard derivation domains** | Different DLE / archive shard contexts use distinct derivation domains |
   | **Per-device hourly merge/withdraw cap** | Bound how much value one compromised hot client can consolidate or send per hour |

   Address fragmentation remains complementary to the ≤100 USDC **per-tip loss ceiling** and \(E_C\le E_{\max}\) (§12.2–§12.3.2)—those bound **tip / committee** blast, not **client seed** blast.
8. **Outcome (honest):** the product **raises clustering cost** and removes **single-address portfolio equivalence** without claiming correlation is impossible; custody blast shrinks **only** under key-domain + recovery-domain isolation (and optional vault hardening)—not from address count alone (§7.6, §12.8–§12.9).

---

## 5. Roles

### 5.1 Pledge archive nodes

- Global **full nodes** for the DLE plane: store chains and complete state needed for quality checks.
- Participate in **per-shard BFT**: quality-check deposited blocks; **propose** accept or reject; **prepare-vote / commit-vote** toward CommitQC (= AC) or RejectCommitQC under lock/justify rules (§5.2.1).
- Peer networking among archive nodes is primarily for **archive discovery and archive consensus**; they do not freely accept arbitrary role-node gossip as peers.
- Expose **RPC** only to authorized participants and chain owners. Clients treat a tip as final **only** when they hold a verifiable **Archive Certificate**—not when a single archive RPC claims success.
- Run **Proof of History (PoH)** sequences **locally** as a verifiable sequencing clock / anti-rollback aid (see §7.9). **Canonical** waiting-pool and tip event order is **not** established by PoH alone—it requires **archive quorum certificates** (§5.2.1).

### 5.2 Archive node groups (clusters) — power-of-two fission

Archive nodes register on CoNET via **NFT**, each obtaining a unique token ID. As **archive participants increase**, the **entire L2 archive plane** does **not** stay one monolithic cluster: it **fissions** into **parallel cluster-like shards** so load and gossip bandwidth scale with participation.

**Canonical fission ladder (product freeze):** plane width \(S_e \in \{2,4,8,\ldots,2^k\}\) doubles when membership / load thresholds are met. Fission is allowed **only if** every resulting shard can still maintain active membership \(N_A \ge 4\) (§5.2.1).

#### 5.2.0 Placement: hash routing (rejects grindable `tokenId mod S`)

**Rejected (attackable):** \(i = \mathrm{tokenId} \bmod S\).

If `tokenId` is sequential or otherwise predictable, an attacker can **mint-grind** until the residue hits a chosen class, then:

1. concentrate chain NFTs onto one archive shard (hotspot / DoS);
2. aim tips at a shard the attacker already partially controls;
3. grind **archive NFTs** into a target shard’s membership set.

**Product freeze — epoch-salted placement:**

\[
i \;=\; H\!\bigl(\mathrm{nftContract}\,\|\,\mathrm{tokenId}\,\|\,R_e\bigr) \bmod S_e
\]

| Symbol | Meaning |
| --- | --- |
| \(H\) | Cryptographic hash (SHA-256 or Keccak-256; domain-separated tag `dle.archive.place.v1`) |
| \(\mathrm{nftContract}\) | CoNET L1 address of the chain-NFT / archive-NFT contract |
| \(\mathrm{tokenId}\) | That NFT’s id |
| \(S_e\) | Archive-plane width for **archive-plane epoch** \(e\) |
| \(R_e\) | Public **placement salt** for epoch \(e\): derived from **CoNET L1 beacon finalized randomness** in the same family as roulette (§7.8)—e.g. `H("dle.place.v1" ‖ L1BeaconFinalizedRandomness_e ‖ e)`—published **before** epoch \(e\) admits new placement decisions |

Within a fixed epoch \(e\), \(S_e\) and \(R_e\) are constant → placement is **deterministic and publicly recomputeable**. Every **chain NFT** and every **archive NFT** uses the same formula. The shard \(i\) is the **only** cluster authorized to host that chain’s waiting queue, draw **\(N_V=7\)** validators + standbys, quality-check, and issue Archive Certificates for that tip under epoch \(e\) (§6.3, §6.5, §5.2.1).

**Anti-grinding (product freeze):**

| Rule | Requirement |
| --- | --- |
| **No cheap archive grind** | Archive-NFT mint / activation requires a **non-trivial bond / stake** (and cooldown) on CoNET L1. An EOA **cannot** obtain shard-serving eligibility by low-cost repeated mint until a target \(i\) appears. Unbonded / cooldown archive NFTs **do not** count toward \(N_A\) and **cannot** sign ACs. |
| **Mint vs \(R_e\)** | Placement that uses already-public \(R_e\) must still face the bond / fee; optional stronger mode: mint commits `tokenId` in a window that binds to the **next** unpublished \(R_{e+1}\) (commit-then-reveal salt) so post-hoc residue shopping fails. |
| **Rate limits** | Per-EOA / per-block archive activation caps (governance parameters) further bound grind attempts. |
| **Chain NFTs** | Asset deposit / trade listing / storage setup fees already price minting; grinding many tips onto one shard remains **economically bounded** and still yields only random \(H(\ldots)\) buckets under fixed \(R_e\), not a chosen trailing residue. |

**Load balance & bandwidth:** fission yields **cluster-style parallel capacity**—independent waiting queues, **local** PoH clocks, and archive BFT per shard—so aggregate **event bandwidth** grows with \(S_e\), not with a single archive gossip mesh.

**Membership:** an archive node serves the shard \(i\) of its **activated** archive NFT under the current \((S_e,R_e)\). After fission, remapping is **not** “instant silent rewrite”: it requires the **epoch migration** protocol (§5.2.2).

**Economics:** smaller per-shard cohorts can raise per-node fee share; that pressure **aligns** with fission (more shards → more parallel tips underwritable).

### 5.2.1 Archive-shard BFT & Archive Certificate (product freeze)

The waiting pool, roulette draw, quality check, accept/reject, rollback, and archival **run on the hosting archive shard**—but the **security root is not a single archive operator**. Each shard is a classical partially synchronous BFT committee. **Quorum size alone is not a protocol:** without the lock / justify state machine below, collecting \(Q_A\) signatures does **not** constitute complete BFT.

**Product freeze:** Archive finality is a **HotStuff-style two-phase quorum certificate protocol** (Jolteon / two-chain HotStuff family) on the hosting shard. An **Archive Certificate (AC)** is a **CommitQC** (≥ \(Q_A\) commit votes) over a tip block. There is **no** globally observable “first \(Q_A\) wins”; uniqueness follows from **locks + QC chaining + no conflicting votes** at the same height/round role.

| Symbol | Definition |
| --- | --- |
| \(N_A\) | Active bonded archive members of the shard (count under current `membershipRoot`) |
| \(f\) | Byzantine bound: \(f=\big\lfloor(N_A-1)/3\big\rfloor\) (require \(f \ge 1\)) |
| \(Q_A\) | Quorum size: \(Q_A=\big\lfloor 2N_A/3\big\rfloor+1\) |
| **Product floor** | \(N_A \ge 4\) (hence \(f \ge 1\)). Below this floor the shard **must not** issue new ACs (read-only / migrate / L1 escape only). |

When \(N_A=3f+1\) exactly, \(Q_A=2f+1\) as in the classical formula. Active \(N_A\) **need not** stay forever exactly \(3f+1\); after join/leave/slash, recompute \(f\) and \(Q_A\) from the formulas. Quorum intersection still yields \(|Q_1\cap Q_2|\ge f+1\): under ≤\(f\) Byzantine members and honest nodes that never double-sign conflicting votes at the same role, two conflicting CommitQCs require ≥1 honest double-sign.

**Two layers:**

| Layer | Role | Quorum |
| --- | --- | --- |
| **Validator committee** | Propose tip block; deposit needs **\(Q_V=5\)** of **\(N_V=7\)** | **\(Q_V = 5/7\)** (§6.5)—**not** a full HotStuff on the tip |
| **Archive shard** | **Sole finality layer** — quality check + archival | **PrepareQC → CommitQC (= AC)** with \(Q_A\) |

“Simple majority alone,” “unanimous archive set,” “one-shot collect \(Q_A\) signatures without locks,” and “\(Q_V=5/5\) validator unanimity” are **not** the product rule.

**Membership (product freeze).** Every Proposal / QC / AC **must** bind:

| Field | Meaning |
| --- | --- |
| `membershipEpoch` | Shard roster version |
| `membershipRoot` | Commitment (Merkle / hash) to the active archive NFT + key set |

Only signatures from members in that root count toward \(Q_A\). Unbonded / cooldown archive NFTs **do not** count in \(N_A\) and **cannot** sign. Roster changes require a **MembershipUpdateCertificate** (≥ \(Q_A\) of the **old** set) and/or **L1-forced** update (slash / governance). Fission remapping still uses **MigrationCertificate** (§5.2.2). After slash, recompute \(f,Q_A\); if \(N_A<4\), stop new ACs.

**Messages (per `(chainNftId, height)`, with `decision ∈ {accept, reject}`):**

```text
ArchiveProposal = {
  chainNftId, height, blockHash, decision,
  selectionLogRef, daRoot, round, archiveShardId,
  membershipEpoch, membershipRoot,
  justifyQC          // highest PrepareQC or CommitQC justifying this round
}

Prepare vote  → aggregate ≥ QA prepare votes → PreparedQC
Commit vote   → aggregate ≥ QA commit votes  → CommitQC = AC
```

```text
AC = CommitQC = {
  chainNftId, height, blockHash, decision,
  selectionLogRef, daRoot, round, archiveShardId,
  membershipEpoch, membershipRoot,
  prepareQCRef,          // hash or embedded PreparedQC
  tipStateRoot,          // tip account / balance commitment after this height
  // Verifiable DA binding (normative — not a verbal promise):
  erasureCodingVersion,  // e.g. "dle.rs.v1"
  chunkCount,            // n
  recoveryThreshold,     // k
  chunkAssignmentRoot    // Merkle root: member → chunk indices for this height
} + ≥ QA distinct archive EIP-712 commit signatures
```

A commit vote / AC asserts: (1) the committee deposited a valid **\(Q_V=5/7\)** attestation set (for accept); (2) the signing archive **independently replayed** the class-fixed FSM transition for this tip (**Mode A**, §6.3)—**not** signature-only trust of the committee; (3) quality invariants hold (§4.6–§4.10, §6.3); (4) the signer **holds** the required erasure shares under the DA rules below (pre-sign download)—**signing alone is not DA**; (5) the vote obeyed **lock / justify** rules below.

**Lock / justify (minimum product rules):**

```text
lockedQC := highest QC the node has locked on (PreparedQC lock / CommitQC per HotStuff)

node may prepare-vote for proposal B  iff
  B extends lockedQC  OR  proposal.justifyQC.round > lockedQC.round

node must not prepare-vote two different blockHashes at the same (height, round)
node must not commit-vote two conflicting payloads at the same (height, round)
```

- **New round:** advance only with a **TimeoutQC (TC)** (≥ \(Q_A\) nil / timeout votes after \(T_{\mathrm{archiveRound}}\)) or a higher `justifyQC`. The new coordinator **must** carry the shard’s highest known PrepareQC / CommitQC as `justifyQC`.
- **Unlock:** only when `justifyQC.round > lockedQC.round`—never because “another proposal appeared.”
- **Canonical tip at a height:** the **highest-round AC (CommitQC)** that satisfies lock and parent-justify rules. **Not** “whoever aggregated \(Q_A\) first in wall-clock gossip.”
- **L1 escape:** \(T_{\mathrm{archiveRound}}\) / TC is **normal** round progress. Persistent absence of any AC for a live tip still uses bonded **`ArchiveCensorshipChallenge`** after \(T_{\mathrm{archive}}\) (below)—round timeout ≠ immediate L1 challenge.

**No sticky leader.** Each selection-log / epoch round deterministically orders archive NFT ids and picks a **coordinator** that may assemble roulette evidence and propose. Local PoH ticks may label proposals; **coordinator eligibility and canonical round identity** come from attested selection-log / QC fields—not from any single node’s PoH chain. The coordinator has **no** unilateral veto or finality power. Any member may broadcast a proposal that carries a valid `justifyQC`; acceptance is by the QC rules above—not by a race to aggregate raw signatures.

**Conflicting tips / dual certificates.** Under the honest-\(f\) assumption + lock rules, there is **at most one** valid AC per `(chainNftId, height)`. If two conflicting ACs both appear to satisfy the rules (equivocation / honest bug):

1. Double-signing (conflicting prepare or commit at the same height/round role) archive members are **slashed** and removed via membership update.
2. Residual fork choice is resolved on **CoNET L1** via a dispute / checkpoint contract: exactly one surviving tip; tips **without** an AC **never** count toward spendable balances.

**Network partition (safety over liveness).** Only a connected component that can form **PrepareQC and CommitQC** (≥ \(Q_A\) each) may finalize. A minority partition **cannot** finalize. If both sides have **< \(Q_A\)**, the tip **stalls** (liveness pause)—it does **not** fork into two finals. Clients ignore single-node RPC claims without a verifiable AC.

**Reject / rollback.** Dissolving a deposited tip and forcing reselection requires a **RejectCommitQC** (same two-phase protocol with `decision=reject`)—so one archive cannot censor by unilateral “reject.”

**Archive censorship (L1 escape hatch — no AC progress).** After timeout \(T_{\mathrm{archive}}\) with no new AC for a live chain (despite round TCs), the chain owner (or a challenger holding the latest **\(Q_V\)-valid** validator attestation plus witness evidence) may post a bonded **`ArchiveCensorshipChallenge`** on CoNET L1 with reason `NO_PROGRESS`. On success: suspend that shard’s custody, allow **deterministic re-home**, and/or escalate to **`forceWithdraw`** (§ below). Malicious challenges lose the bond. **Round TC ≠ censorship challenge.**

**Verifiable data availability (product freeze).** “Signing an AC” is a **cryptographic attestation of share custody**, not a verbal promise. Production **MUST** freeze encoding, thresholds, pre-sign duties, and an **UnavailableChallenge** game.

| Parameter | v1 freeze |
| --- | --- |
| **Encoding** | Systematic Reed–Solomon (or equivalent MDS code) over fixed chunk size; version tag `erasureCodingVersion` (initial: `dle.rs.v1`) |
| **\((n,k)\)** | **\((n,k)=(10,6)\)**: encode each block body into **10** chunks; **any 6** reconstruct the body. `chunkCount=10`, `recoveryThreshold=6` |
| **Relation to \(Q_A\)** | Placement **MUST** keep \(k \le N_A - f\) under the current `membershipRoot` so that an honest \(f\)-bound shard can still recover. If \(N_A\) shrinks below this, stop new ACs until membership / coding epoch upgrades |
| **`daRoot`** | Merkle / hash commitment to the ordered chunk set (or coded blob) for `(chainNftId, height)` |
| **`chunkAssignmentRoot`** | Commitment to deterministic map `archiveMember → chunkIndices[]` for this height (publicly recomputeable from `membershipRoot` + height + `daRoot`) |
| **Witnesses** | Keep **full** tip bodies (not only shares) for chains they serve |
| **Pre-sign download** | Before casting a **commit** vote, each signing archive **MUST** have downloaded and locally verified **≥ \(k\)** distinct chunks covering a reconstructible set for that `daRoot` (implementation MAY require the member’s **assigned** chunks plus enough peers to reach \(k\)). Commit without holding shares is **slashable equivocation / DA fraud** |

**UnavailableChallenge (has AC, missing data):**

```text
1. Challenger posts bonded UnavailableChallenge(chainNftId, height, daRoot, accusedMembers[])
   on CoNET L1 within T_daOpen after AC publication (or after failed local reconstruct).
2. L1 (or bonded referee) samples / lists required (member, chunkIndex) pairs from chunkAssignmentRoot.
3. Each accused member MUST open the named chunk within T_daResponse:
   prove chunk ∈ daRoot (Merkle / KZG open) AND chunk matches assignment.
4. Timeout / wrong open → slash that member’s archive bond; reassign chunk duty if needed.
5. If after the game fewer than k valid opens exist → FREEZE height:
   - tip spendable state reverts to previousAC.tipStateRoot (events at frozen height are non-spendable);
   - owner MAY forceWithdraw against previous good AC (§ below);
   - shard may be suspended / re-homed under ArchiveCensorshipChallenge reason UNAVAILABLE.
```

**Economic truth:** only tip states covered by an AC **with reconstructible DA** are spendable. Uncertified or frozen-height events are not final.

**Forced exit / `forceWithdraw` (executable protocol).** Intent “recover from previous AC state root” is **not** enough—unlock **MUST** hit the L1 AssetVault (§4.6):

```text
forceWithdraw(
    assetNftId,
    lastArchiveCertificate,   // last good AC (or previousAC if height frozen)
    accountStateProof,        // Merkle (or equivalent) proof of account balance under tipStateRoot
    nullifier                 // unique exit id; prevents double unlock + tip double-spend
)
```

| Rule | Normative requirement |
| --- | --- |
| **Where value lives** | Unlockable funds sit in **L1 AssetVault[`assetNftId`]** (ingress collateral). Tip balances are claims, not a second free float |
| **Proof** | `accountStateProof` proves `(owner, balance, …)` under `lastArchiveCertificate.tipStateRoot`. L1 pays ≤ `min(vault.locked, proven balance)` |
| **Nullifier** | On success, L1 stores `nullifier` / marks vault **Exited** (or reduced). Tip **MUST** treat any later spend of the exited claim as invalid; archives **MUST** reject events that spend exited balances |
| **Post-AC events** | Events **after** `lastArchiveCertificate.height` are **ignored** for this withdraw. Challengers may submit a **newer valid AC + DA** during the dispute window to raise the proven balance or cancel a fraudulent exit |
| **Dispute window** | \(T_{\mathrm{exit}}\) (engineering constant; same family as \(T_{\mathrm{archive}}\) / \(T_{\mathrm{daResponse}}\)). During \(T_{\mathrm{exit}}\), bonds may be slashed if a counter-AC proves the withdraw under-stated / double-spent |
| **NFT ownership** | `ownerOf(assetNftId)` stays on L1; forceWithdraw moves **vault assets**, not necessarily the NFT (product MAY burn/transfer NFT on full exit) |
| **Trade tips** | Incomplete trades use cancel/unfreeze (§4.7)—not this vault path—unless the **subject** asset tip itself is force-exiting |

#### 5.2.2 Epoch fission migration & MigrationCertificate

When the plane advances \(S_e \rightarrow S_{e+1}=2S_e\) (and publishes \(R_{e+1}\)), a large fraction of tips change host shard. **Silent remapping is forbidden.** Every fission must run an **epoch migration** that produces a **MigrationCertificate (MC)** co-signed by the **old** and **new** shards.

**MigrationCertificate (product freeze sketch):**

```text
MC = {
  e, e+1,
  S_e, S_{e+1},
  R_e, R_{e+1},
  fromShardId, toShardId,
  tipSetRoot,           // Merkle / DA root of tips (chainNftId, height, tipHead) migrating this edge
  historyCommit,        // commitment to archival history the old shard must still serve
  fromMembershipRoot, toMembershipRoot,
  fromMembershipEpoch, toMembershipEpoch,
  migrateDeadline
} + ≥ Q_A CommitQC-style signatures from fromShard
  + ≥ Q_A CommitQC-style signatures from toShard
```

| Phase | Rule |
| --- | --- |
| **Announce** | Governance / automated threshold emits fission intent: new \(S_{e+1}\), \(R_{e+1}\), and migration window \([t_0,t_1]\). Clients compute new \(i'\) for every NFT. |
| **Freeze / drain** | Tips scheduled to leave a shard: reject **new** block deposits that would race the handoff (or allow only “migrate-safe” closes). In-flight **archive** rounds must reach AC, **TimeoutQC-abort**, or **RejectCommitQC** under the **old** shard before handoff; in-flight validator rounds likewise finish or abort with reject. Incomplete **trade** tips stay on the tip’s current host until Settled/Cancelled/Expired under §4.7, then migrate; L1 `settleTrade` remains L1-authoritative. |
| **Dual-serve window** | Until MC is finalized for that edge, **old shard** remains authoritative for AC finality of pre-migration heights; **new shard** may warm-copy history and attest readiness. Clients **SHOULD** query both; conflict → prefer old-shard AC until MC. |
| **Data duty** | Old shard **must** provide tip bodies / DA shares referenced by `historyCommit`. Withholding → same family as **`ArchiveCensorshipChallenge`** / slash (§5.2.1)—migration does not excuse hiding history. |
| **MC finalize** | When both shards form CommitQC-equivalent quorums on the same MC payload (and optional L1 checkpoint of `MC.hash`), epoch \(e+1\) placement becomes sole authority for those tips. Old shard stops issuing new ACs for migrated tips. |
| **Post-migrate** | New shard alone draws validators and issues ACs under its `membershipRoot`. Tip `archiveShardId` in subsequent ACs must match \(i'\) under \((S_{e+1},R_{e+1})\). |

**Invariants:**

1. No tip may have **two conflicting live hosts** after MC finalize.
2. No tip may be left **orphaned** (old stopped, new never accepted) without L1 escape hatch.
3. Placement formula for epoch \(e+1\) uses \(R_{e+1}\)—**not** a residual rewrite of `tokenId mod S` that would re-enable grinding narratives.

### 5.3 Pledge witnesses

- Participate across the **full lifecycle** of a given chain.
- Store **all data** of that chain (chain-local full participants).
- Dishonesty → removal from the chain; stake / income at risk.
- Stake size limits how many chains a witness can underwrite concurrently.

### 5.4 On-demand validators (waiting queue)

- **Lightweight** miners: need not store full chain history.
- Advertise readiness into the **on-demand miner waiting queue** hosted / ordered by archive nodes (§8).
- May be drawn for a **single block** as one of **\(N_V=7\)** committee members (or **\(S_{\mathrm{sb}}=2\)** standbys), then leave.
- Enable on-demand decentralization without storage monopolies.

### 5.5 Issuer / creator (optional proposer role)

- For genesis or when a designated proposer is required: drawn by roulette among staking miners, or one of the drawn committee may act as block assembler per class rules.
- Assembles a candidate block from **typed tip events**, checking them against the class’s **frozen transition table** (no VM execution)—then the **validator committee** votes.
- After **≥ \(Q_V\)** votes, the submission is deposited to the **archive shard** for quality check and **Archive Certificate** aggregation—**not** finalized by the committee alone (§5.2.1).

---

## 6. Consensus Model

### 6.1 Per-chain consensus rule

- For each **event-driven** block: the maintenance committee draws **\(N_V=7\)** validators plus **\(S_{\mathrm{sb}}=2\)** standbys, by the hosting **archive shard**, from the **on-demand miner waiting queue** (§6.5).
- Tip **proposal** acceptance requires **≥ \(Q_V=5\)** accept signatures out of those **7** (**\(Q_V=5/7\)**). Tip **finality** requires a valid **CommitQC (= AC)** on the hosting shard (§5.2.1)—not a single archive node’s accept/reject, and not a lock-free one-shot signature race.
- **Rejected product rule:** \(Q_V=5/5\) (unanimous five). It maximizes safety against a single honest veto of an illegal block, but **any** offline / timeout / attack / malicious refuse stalls the round; griefers can re-enter the waiting pool and refuse forever unless §6.5 bounds apply.
- If proposal quorum or archive quorum check fails (timeout, refuse-to-sign, conflicting signatures, RejectCommitQC): apply **standby promotion → dissolve → cooldown → reselect** under §6.5, then archive reject/rollback under §9 when applicable.

### 6.2 Genesis block flow

1. User **mints / configures a unique CoNET L1 NFT** and selects **exactly one** class: **asset**, **storage**, or **trade**.
2. **Asset-class only:** deposit L1 assets; **L1 oracle** values them; reject if valuation **> 100 USDC-equivalent**.
3. **Trade-class only:** bind `subjectNftId` (existing asset or storage NFT owned by the seller); set atomic listing quote **≤ 100 USDC-equivalent**; reject oversized quotes (§4.7).
4. **Storage-class creator content (optional):** owner may attach `contentIndexHash`, authorized miner PGP key hashes, and **access price in conet-GB** (§4.8).
5. **Storage-class fork (optional):** if minting a branch, bind `parentNftId` / `rootNftId` / `lineageHash` for the Copyright ZERO version tree (§4.9).
6. User submits a **new ledger request** (referencing the NFT id + class + deposit / subject proof) to the request pool.
7. Roulette selects an **issuer** among staking miners; issuer assembles genesis from the **class-fixed event schema** (global definitions for this chain, including fee hooks per class—**USDC 0.01%** for asset/trade, **conet-GB** for storage—§13)—**no tip VM**.
8. Hosting **archive shard** draws **\(N_V=7\)** on-demand validators + **\(S_{\mathrm{sb}}=2\)** standbys from the waiting queue; optional issuer assembles genesis.
9. The committee votes; on **≥ \(Q_V=5\)** accept signatures, submit genesis attestations.
10. Archive shard **verifies** and, if qualified, forms **CommitQC (= AC)** and **archives** finalized genesis (§5.2.1).

### 6.3 New block flow (canonical)

**Archive verification mode (product freeze — Mode A).** Every archive member that signs Prepare/Commit for an AC **MUST independently replay** the class-fixed FSM state transition for that tip (same typed events + parent state as the validators). Archives **MUST NOT** issue CommitQC by verifying the **\(Q_V=5/7\)** signature set alone. **Mode B** (archive trust of committee + fraud proofs / sampling / challenge windows) is **out of v1**—it would require a separate challenge ABI, transition witnesses, and committee-fault slash paths (§15).

**Validator committee role under Mode A.** The \(N_V=7\) / \(Q_V=5\) committee is a **pre-execution / witness layer**, not the safety root: it runs the fixed FSM in parallel, checks events, deposits an independent attestation set, and raises the cost of attacking archives with a forged deposit. Because archives **fully re-execute**, the committee does **not** remove archive correctness work—it buys latency overlap, independent slashable evidence, and a first filter before HotStuff rounds. Clients **must not** treat a \(Q_V\) deposit as tip finality.

**Shard-local pipeline pools (product freeze).** Hosting-shard state for each tip height uses four named queues (names are normative; storage layout is engineering):

| Pool | Role |
| --- | --- |
| **RequestPool** | User / owner state-change requests for `chainNftId` (**no event ⇒ no block**). |
| **SelectionLog** | \(Q_A\)-attested waiting-pool snapshot + roulette result: `committee[7]` + `standby[2]` under public \(R_e\) (§7.8). The rotating **ArchiveCoordinator** assembles evidence; it **cannot** privately edit the seat list. |
| **ArchiveIngressPool** | Validator **DepositBundle** (typed events, parent tip identity, `selectionLogRef`, ≥ \(Q_V\) votes, `daRoot`) awaiting archive Mode A replay. Proposal layer only—**not** final. |
| **ArbitrationPool** | Deposits that fail Mode A replay or miss \(Q_V\) after standbys; maps to §6.5 dissolve → cooldown → reselect (\(R < R_{\max}\)). Not a second finality track. After \(R_{\max}\): **RejectCommitQC** / stalled / optional L1 escape. |

```text
user → RequestPool
  → ArchiveCoordinator (rotating) + SelectionLog roulette
  → validators execute FSM → DepositBundle → ArchiveIngressPool
  → every active archive: Mode A FSM replay
       ├─ pass → PrepareQC → CommitQC (= AC) → archive store
       └─ fail → ArbitrationPool → reselect (R < R_max) or RejectCommitQC
```

1. A **new event** enters the hosting shard **RequestPool**. **If there is no event, no block is produced.**
2. **Asset-class only — revalue:** run **L1 oracle** revaluation of chain balance / transfer (§4.6). If revalued balance **> 100 USDC**, require **spillover new chain(s)** for the outbound / excess portion before this tip may accept the transfer; otherwise reject.
3. **Trade-class only — listing invariants:** reject events that raise the quote above **100 USDC**, unfreeze the subject NFT without cancel/expire/L1 settle, mark **Settled** without a verified L1 `settleTrade` tx, or claim tip-only “atomic rollback” of L1 state (§4.7). After **Closed**, refuse all new blocks.
4. **Storage-class only — content access:** purchase events require **conet-GB** payment + **buyer PGP** binding; delivery-complete events require a valid authorized-miner first-completer proof (`buyerEncryptedContentHash`). Reject events that would put plaintext content into tip state (§4.8).
5. **Storage-class only — social / fork:** like / comment / citation events require a valid signer binding (EIP-191 / AddressPGP); fork genesis must reference an existing `parentNftId`. Reject unsigned “celebrity” attributions (§4.9).
6. **Storage-class only — sales books:** `SaleBooked` / revenue journal events that claim value movement MUST include `assetNftId` + `assetTxId` (or an explicit GB-only access sale with no asset rail); reject unlinked inflate-the-books rows (§4.10).
7. Rotating **ArchiveCoordinator** (deterministic per round — §5.2.1) pulls a cap-compliant request and appends a **SelectionLog** entry: verifiable roulette over the **on-demand miner waiting queue** (coordinator assembles evidence; peers attest — §5.2.1, §7.8). Seat assignment is publicly recomputeable from `poolRoot_e` + \(R_e\); the coordinator has **no** unilateral seat veto.
8. Archive shard **draws \(N_V=7\) validators + \(S_{\mathrm{sb}}=2\) standbys** for **this chain’s current block** (§6.5).
9. Candidate block is assembled from typed events against the class transition table (optional issuer among staking miners or committee assembler)—**no tip VM** (§10).
10. **Fee collection (dual denomination — §13):**
   - **Asset-class transfer:** **0.01%** of transferred value in **USDC**; of that fee **50% → hosting archive shard** (among AC signers), **50% → \(Q_V\) accepting validators** (equal among ≥5 accept signers on the archived tip).
   - **Storage-class write / retention / access purchase / social:** **content-based** fees in **conet-GB** (not the USDC 0.01% rail); unpaid retention → refuse new blocks; access price paid to owner (delivery miners may take a configured share).
   - **Trade-class listing / settle:** listing / settle hooks charge **USDC** on the quote / settle notional under the same **0.01% → 50/50 archive/validators** split where applicable; unpaid listing fees may halt further trade events.
11. The committee **votes**; on **≥ \(Q_V=5\)** accept signatures within \(T_{\mathrm{vote}}\), it **submits** a **DepositBundle** into the **ArchiveIngressPool** (**proposal / witness layer only**—not final).
12. **Every active archive (Mode A)** independently **replays** the fixed FSM transition and checks the vote set (≥ \(Q_V\)), block quality, `daRoot`, (asset-class) **≤ 100 USDC** post-revaluation invariant, (trade-class) **SettleReady** / close rules and **L1 `settleTrade` linkage** (no tip-only Settled), and (storage-class) purchase / delivery / social-signer / lineage / **sales↔asset-tx link** invariants (§4.8–§4.10). **Forbidden:** CommitQC from committee signatures alone without replay.
13. If **qualified**, archive members run **PrepareQC → CommitQC**; on a valid **AC (= CommitQC)** → **archive** (finalize and store). If **not** qualified → place the deposit in the **ArbitrationPool** and apply §6.5 dissolve / cooldown / reselect (\(R < R_{\max}\)); on exhaustion → **RejectCommitQC** / stalled / optional L1 escape (§5.2.1, §6.5, §9).

### 6.4 Timeout and succession

| Fault | Recovery (product freeze — detail in §6.5) |
| --- | --- |
| **Committee member timeout / silence** | Count as **non-vote** after \(T_{\mathrm{vote}}\); if still **≥ \(Q_V\)** accepts → continue; else **promote standbys**, then dissolve / reselect. |
| **Unjustified refuse-to-sign** (online but no ballot) | **Slash** that identity’s bonded stake; apply **cooldown**; promote standbys or reselect. |
| **Network fault** (no listen heartbeat / unreachable) | **Exclude without slash** (or light availability penalty only); may still reselect if \(Q_V\) missed. |
| **Archive incomplete / failed quality check** | Form **RejectCommitQC**; run rollback (§9); prior committee under **cooldown**. |
| **Archive shard partition / < \(Q_A\)** | Tip **stalls**; no conflicting finality (§5.2.1). |
| **Archive censorship past \(T_{\mathrm{archive}}\)** | Bonded L1 **`ArchiveCensorshipChallenge`** → re-home / L1 arbitration (§5.2.1). |
| **Reselect griefing past \(R_{\max}\)** | Stop validator redraws for that height; escalate to archive reject / L1 challenge path (§6.5). |

### 6.5 Validator-committee quorum & liveness (product freeze)

**Problem with \(Q_V=5/5\):** requiring all five signatures means one offline, timed-out, attacked, or malicious refuse blocks the tip. “Dissolve and reselect” alone is **not** enough—an attacker can rejoin the waiting pool and refuse forever. v1 therefore freezes a **\(7\)-draw / \(5\)-of-\(7\)** proposal layer, then archive confirmation via **PrepareQC → CommitQC (= AC)** (§5.2.1).

| Symbol | v1 freeze | Meaning |
| --- | --- | --- |
| \(N_V\) | **7** | Validators drawn as the **active committee** for this tip height |
| \(Q_V\) | **5** | Accept signatures required to deposit (**\(Q_V/N_V = 5/7\)**) |
| \(S_{\mathrm{sb}}\) | **2** | **Standby** validators drawn in the same roulette round (ordered) |
| \(T_{\mathrm{vote}}\) | **30 s** wall-clock (optional local PoH measurement) | **Maximum voting window** from committee publication to ballot close |
| \(C_{\mathrm{cool}}\) | **32** subsequent tip heights **or** **15 min**, whichever longer | **Per-identity reselection cooldown** after serving a failed / dissolved round for that chain |
| \(R_{\max}\) | **3** | **Max consecutive** dissolve→reselect cycles for the **same** `(chainNftId, height)` before escalation |
| \(B_{\mathrm{refuse}}\) | bonded stake fraction (contract) | **Slash** on **unjustified refuse** (see fault attribution) |

**Why \(5/7\) tolerates faults:** with \(N_V=7\), \(Q_V=5\), the tip can still deposit if **up to 2** drawn validators are offline, slow, or Byzantine (non-signing), while **5** honest acceptances still clear the proposal layer. Illegal blocks still fail if **≥ 3** honest members refuse to accept (they can keep the accept count below \(Q_V\)). Archive finality remains independent under §5.2.1.

**Standby committee mechanism.**

1. Roulette publishes ordered lists: `committee[7]` and `standby[2]` in one selection log entry.
2. If at \(T_{\mathrm{vote}}\) the accept count is **< \(Q_V\)**, the archive coordinator **promotes** standbys in order into empty / timed-out seats (**without** a full redraw) and opens a **short extension** \(T_{\mathrm{sb}} = 15\,\mathrm{s}\).
3. If after promotion still **< \(Q_V\)**, **dissolve** the active set, apply cooldowns, and if \(R < R_{\max}\) **reselect** a fresh \(N_V+S_{\mathrm{sb}}\) draw; else escalate.

**Fault attribution (network vs malice).**

| Evidence | Classification | Penalty |
| --- | --- | --- |
| Valid **accept** or **reject** ballot inside \(T_{\mathrm{vote}}\) | Honest participation | Fee share only if accept is on the archived tip |
| Identity **in** mailbox / gossip **listen pool** (heartbeat fresh) but **no** ballot by \(T_{\mathrm{vote}}\) | **Unjustified refuse** | **Slash** \(B_{\mathrm{refuse}}\); **cooldown** \(C_{\mathrm{cool}}\); remove from immediate redraw |
| Identity **not** in listen pool / no heartbeat for ≥ \(T_{\mathrm{vote}}\) | **Network / availability fault** | **No slash** (optional light availability score decay); still **cooldown** for that seat’s identity; seat eligible for standby promotion |
| Conflicting accept+reject / double-sign same height | **Equivocation** | Full slash + permanent exclude from this chain’s waiting pool until L1 clear |
| Ballot after \(T_{\mathrm{vote}}\) | Ignored | No slash solely for late ballot |

Archive members must record `selectionLogRef`, ballot bitmaps, and listen-heartbeat witnesses in the deposit package so disputes are auditable.

**Anti-griefing bounds.**

- An identity that was drawn (committee or standby) in a dissolved round for `(chain, height)` **cannot** be redrawn for that same height and must wait \(C_{\mathrm{cool}}\) before serving **any** new tip on that chain.
- After **\(R_{\max}=3\)** consecutive reselections without a \(Q_V\) deposit, the hosting shard **must not** continue roulette for that height: form a **RejectCommitQC** (if a deposit was attempted) or mark the event **stalled**, and allow owner / challenger **L1** escalation (same family as `ArchiveCensorshipChallenge`, with evidence of \(R_{\max}\) exhausted).
- Waiting-pool **re-entry** after unjustified refuse requires serving the slash + cooldown; spam join without stake is rejected at queue admission (§8).

**Security note.** \(Q_V=5/7\) is **weaker than unanimous 5/5** against “one honest veto of an illegal proposal,” but **stronger for liveness**. Under **Mode A** (§6.3), the committee is a **pre-execution / witness** filter: a malicious \(5/7\) deposit **cannot** finalize an illegal tip unless ≥ \(Q_A\) archives also fail (or skip) independent FSM replay. Safety of **finalized** tips still rests on **archive CommitQC / AC** Mode A checks and lock rules (§5.2.1)—validators alone never finalize.

---

## 7. Cryptography (Mature Primitives Only)

This chapter specifies the cryptographic plane of CoNET-DLE **as an L2 loaded on CoNET DePIN**. Every construction below is chosen because it is already standardized or battle-tested in production systems. Novel ZK/SNARK stacks are **out of scope** for the baseline.

### 7.1 Threat model and privacy goals

| Adversary | Assumed capability | Goal of crypto layer |
| --- | --- | --- |
| Curious entry / mailbox hop | Sees ciphertext, timing, recipient **PGP key id** | Cannot read L2 business plaintext |
| Network observer on one hop | Sees IP of that hop’s TCP peer | Cannot map that IP to the **logical** sender/receiver wallet across A≠B / C≠B paths |
| Colluding minority of a maintenance group | Holds some secp256k1 keys | Cannot forge a **\(Q_V=5/7\)** deposit without enough keys |
| Colluding ≤ \(f\) archives in a shard | Holds ≤ \(f\) archive keys | Cannot forge CommitQC / AC (need \(Q_A\)) (§5.2.1) |
| Adaptive stake attacker | Buys stake, joins waiting pool | Cannot bias production \(R_e\) by omitting archive VRF (seed is L1 beacon randomness + frozen `poolRoot_e`); MVP commit–reveal admits last-revealer abort bias (§7.8) |
| Offline storage attacker | Steals disk of one validator | Limited by per-task keys + no full-history requirement for validators |

**Non-goals (baseline):** perfect global traffic-analysis resistance against a world-wide passive adversary that correlates *all* entry nodes; content-hiding from parties who *must* see a block (witnesses of that chain). **Communication privacy** is **natural** from wallet-address gossip + E2E encryption (not mixnets). **Asset privacy** is **natural** from multi-wallet fragmentation that **raises clustering cost** (client-only recombination; ERC-5564 receive)—**not** strong anonymity and **not** baseline ZK (§4.5).

### 7.2 Primitive catalogue (implementation baseline)

| Layer | Primitive | Maturity anchor | Use in CoNET-DLE |
| --- | --- | --- | --- |
| Wallet identity | **secp256k1** ECDSA | Bitcoin / Ethereum | Node & user EOA |
| Auth signatures | **EIP-191** `personal_sign` | Ethereum wallets | Gossip commands, listen, task ACKs |
| Structured domain sigs (**required** for AC / settle) | **EIP-712** | Ethereum dApps | Archive CommitQC / AC, SettleReady settle payload, MembershipCheckpoint; gossip may remain EIP-191 |
| Directory | **AddressPGP** on-chain registry | CoNET production | Map EOA → user PGP + route key |
| Asymmetric message crypto | **OpenPGP** (RFC 4880 / **RFC 9580**) with **X25519** (+ Ed25519 where used) | OpenPGP ecosystem | Encrypt L2 envelopes to recipient |
| Symmetric AEAD | **AES-256-GCM** (NIST SP 800-38D) | TLS, age, modern apps | Optional bulk payload / session wrap |
| Session (listen path) | AES-256-CBC + explicit MAC *or* prefer GCM | Existing CoNET-SI listen | Long-lived listen channel key |
| Hashing | **SHA-256**, **Keccak-256** | NIST / Ethereum | Local PoH ticks, Ethereum digests, armor hashes |
| KDF | **HKDF-SHA256** (RFC 5869) | TLS 1.3, OpenPGP v6 | Derive task / fragment keys |
| Random beacon (**production**) | **CoNET L1 beacon finalized randomness** (+ frozen `poolRoot_e`) | CoNET PoS CL / RANDAO-class finalized beacon | Production roulette seed \(R_e\) (§7.8.1); **not** execution `block.hash` |
| Optional tickets (post-\(R_e\)) | **ECVRF** over fixed \(R_e\) | IETF ECVRF / Algorand-class VRFs | Stake-weighted role tickets only; **MUST NOT** rewrite \(R_e\) (§7.8.2) |
| Random beacon (**MVP only**) | **Commit–reveal** over secp256k1 | Classic distributed RNG | Bootstrap / testnets; **last-revealer bias** (§7.8.3) |
| Integrity of ciphertext | `keccak256(utf8(armor))` | CoNET fragment / ACK practice | Delivery dedup & mailbox ACK |

**Library guidance (non-normative):** `openpgp.js` / Sequoia / GPG for OpenPGP; `ethers.js` / libsecp256k1 for EIP-191; OpenSSL / BoringSSL / WebCrypto for AES-GCM; no custom ECC curves.

### 7.3 Identity: wallet address, not IP

1. Every L2 participant (user, issuer, witness, validator, archive operator process) is identified by an **EOA** `0x`-address derived from secp256k1.
2. The same EOA stakes on the mainchain and signs DePIN commands with **EIP-191**.
3. Each participant registers an **OpenPGP** certificate (encryption subkey = routing key id) in **AddressPGP**, bound to that EOA.
4. **IP addresses are transport accidents of a single hop**, never protocol identifiers. Clients **MUST NOT** require knowledge of peer IPs to join consensus.

```text
Logical identity:  EOA  ──registers──►  userPublicKeyArmored + routeKeyID
Gossip address:    encrypt(to = user PGP | route PGP)
Physical path:     client → entry A/C → mailbox B   (A,C ≠ B)
```

### 7.4 DePIN gossip crypto (send path S → A → B)

Aligned with CoNET DePIN zero-trust mailbox routing:

1. Sender builds an L2 envelope (JSON): `{ timestamp, text, from: EOA, signMessage }` where `signMessage = EIP-191(text)`.
2. `literal = base64(UTF8(JSON.stringify(envelope)))`.
3. OpenPGP-encrypt `literal` to the **recipient’s user PGP** (not to the mailbox route key for business payloads).
4. `POST { data: armoredCiphertext }` to one or more healthy **entry nodes A**, with **A ≠ B** (mailbox of recipient).
5. Entry **A** inspects only OpenPGP recipient key id → looks up mailbox **B** → forwards over node-to-node HTTP. **A does not decrypt.**
6. Mailbox **B** stores ciphertext; **B does not decrypt** business payloads. Only recipient R opens with user private key.

**L2 message types** carried in `text` (examples): waiting-pool advertise, task offer, block proposal digest, signature share, timeout complaint, storage-fee receipt. Application parsers unwrap nested JSON as needed.

### 7.5 DePIN listen crypto (R → C → B)

For long-lived participation (waiting pool / SSE push of tasks):

1. Participant encrypts a listen command to **mailbox B’s route PGP** (not user PGP):
   `{ command: 'mining', listenKind: 'dle' /* or product tag */, walletAddress, algorithm, Securitykey, timestamp }` signed EIP-191.
2. HTTP/SSE connects via healthy **entry C ≠ B**.
3. **B** decrypts listen command only (route key), binds `walletAddress` to the SSE, pushes later ciphertext.
4. Prefer **AES-256-GCM** for the session `Securitykey` channel; if compatibility requires AES-CBC, require an explicit HMAC-SHA256 over ciphertext (Encrypt-then-MAC). New deployments should standardize on GCM.

`listenKind` distinguishes DLE task streams from LayerMinus mining / chat, so eviction policies never cross pipes.

### 7.6 Why this yields “natural privacy” for the L2

Natural privacy is **two layers that always travel together** (§4.5):

**A. Communication privacy (DePIN transport)**

| Property | Mechanism |
| --- | --- |
| No IP identity | Peers addressed by EOA / PGP key id |
| Hidden sender ingress | Send via arbitrary entry **A**, not direct to B |
| Hidden receiver ingress | Listen via arbitrary entry **C**, not direct to B |
| Confidentiality | OpenPGP E2E; hops see only ciphertext |
| Authenticity | EIP-191 bind `from` to envelope `text` |
| Limited linkability of roles | Fresh task keys (§7.10); optional per-chain ephemeral PGP subkeys |
| Bounded metadata | Relays learn “cipher for key id K”, not payment amounts or block bodies |

**B. Asset privacy (raise clustering cost + ERC-5564 receive)**

| Property | Mechanism |
| --- | --- |
| Ingress already fragmented | On deposit into L2, value is split across **many wallet addresses** / ≤100 USDC atomic chains |
| Client-only portfolio map | Only the **client** recombines fragments into one logical holding |
| Transfer is dual-private | Same transfer uses encrypted DePIN paths **and** multi-address send |
| Recipient not a single address | Payee receives across **many** wallets; only the payee client reassembles |
| Canonical receive = ERC-5564 | Meta-address, ephemeral key, view tag, announcement, scan/spend keys, batch *n*, recover/scan (§4.5) |
| Atomic ≤100 USDC per stealth EOA | Sender pays each derived address a micro-fragment; DLE tips enforce the cap (§4.6) |
| Recipient-only spend keys | Sender can compute stealth addresses, **not** spend keys |
| Not L2 infrastructure | Tip / archive / validator committee do **not** run an address oracle |
| Breaks single-address equivalence | One EOA is **not** the user’s whole portfolio (clustering may still succeed via residual channels—§4.5) |
| Conditional multi-key custody | Distinct spend keys help **only** with key-domain + recovery-domain isolation; same mnemonic/device/DB/PIN ⇒ full portfolio still lost (§4.5, §12.9) |
| Hierarchical key vault (client) | Online scan key; batched spend; hardware/threshold high-value; encrypted recovery map; per-shard domains; hourly merge/withdraw caps (§4.5) |

Residual transport metadata (size, time, key id) and the **residual clustering channels** in §4.5 are accepted; mixnet-level padding / ZK shielding are optional hardening, **not** the baseline claim. Asset privacy does **not** claim strong anonymity if the client leaks its recombination map or if observers exploit shared deposit / gas / timing signals. **Higher recipient anonymity** is a **client product** choice when using L2—not a DLE tip/archive/validator feature. Custody gain is **not** “more addresses = safer”; it is **isolated spend/recovery domains** (plus optional vault hardening). **BIP-47 / BIP-352 are design references only**; CoNET’s EVM runtime is **ERC-5564**. DLE only **carries** the resulting fragmented tips.

### 7.7 Block and vote cryptography (consensus plane)

**Block digest**

```text
blockHash = keccak256(rlp_or_canonical_encode(header || txs || stateRoot))
```

Use a frozen canonical encoding (RLP or deterministic JSON + length prefixes). Prefer **Keccak-256** where Ethereum tooling is reused; **SHA-256** is acceptable if consistently used for PoH and digests—but **do not mix** digest functions for the same object.

**Per-member vote (validator / witness proposal layer)**

```text
vote = EIP-191( "CoNET-DLE/vote/v1" || chainId || chainNFT || height || blockHash || role || eoa )
```

Collect ECDSA signatures from the **validator committee** (and optional issuer / witness) roles. Completeness means **\(Q_V=5/7\)** on the proposal layer—**not** gathering every drawn seat, and **not** “100% of all roles.” Archive verifies:

1. `ecrecover` matches the roulette-selected set.
2. Accept count ≥ \(Q_V=5\) of \(N_V=7\) (standbys per §6.5).
3. `blockHash` matches recomputed digest from deposited body (or DA proof).

**Archive prepare / commit (finality layer):** votes that form PreparedQC / CommitQC (= AC) **MUST** be **EIP-712** over the AC typed fields in §5.2.1 (including DA binding + `membershipRoot`). L1 `settleTrade` / MembershipCheckpoint **reject** EIP-191-only ACs.

**No custom BLS threshold crypto in baseline**—threshold BLS is mature in some stacks but adds operational complexity; **explicit multi-signature collection** of secp256k1 signatures is enough and already ubiquitous.

### 7.8 Verifiable roulette cryptography

**Product freeze:** production roulette **MUST** derive \(R_e\) from **CoNET L1 beacon-chain finalized randomness** plus a **\(Q_A\)-attested** waiting-pool root `poolRoot_e`. **Commit–reveal is MVP / bootstrap only**—it is **not** the production randomness claim. The informal slogan “bias-free if at least one honest reveal” is **incomplete** (see §7.8.3 last-revealer bias). Concatenating **optional per-archive ECVRF outputs** into \(R_e\) is **rejected for v1** (see selective-omission bias below).

#### 7.8.1 Production: L1 beacon finalized randomness ∥ epoch ∥ shardId ∥ poolRoot

For fixed epoch \(e\), hosting `shardId`, and a **publicly agreed** CoNET consensus-layer entropy value that is **already finalized**:

\[
R_e \;=\; H\!\big(\texttt{"dle.roulette.v1"}\;\big\|\; \mathrm{L1BeaconFinalizedRandomness}_e\;\big\|\; e\;\big\|\; \mathrm{shardId}\;\big\|\; \mathrm{poolRoot}_e\big)
\]

where \(H\) is **Keccak-256** (or SHA-256; freeze one in the ABI) and concatenation is canonical length-prefixed.

**Entropy source (normative):**

| Allowed | Forbidden |
| --- | --- |
| CoNET **beacon / CL** **finalized randomness** (RANDAO or the chain’s equivalent finalized random beacon field for the bound epoch / slot) | Unpublished or non-final CL values |
| Same family as placement salt (§5.2.0) | Pure **execution-layer** `block.hash` as the production seed (proposer can still grind block contents within limited bounds) |

**Rejected design (do not ship):** \(R_e = H(\mathrm{L1Hash}\,\|\,e\,\|\,\mathrm{VRF}_1\,\|\,\cdots)\) where missing VRF outputs are **dropped from the concatenation**. Even if each \(\mathrm{VRF}_i=\mathsf{ECVRF}_{sk_i}(\ldots)\) is unforgeable and non-re-sampleable, a member that has already seen the L1 entropy and peers’ VRF outputs can still choose **publish vs withhold** their own output and thereby select among two different aggregates—a weaker **last-publisher / selective-omission bias**. v1 therefore **does not** mix optional archive VRF into \(R_e\). If a future revision re-introduces archive VRF mixing, it **MUST** freeze a `vrfContributorRoot` **before** the bound L1 beacon is known and require **all** listed contributors (or a pre-committed fallback)—**never** “omit missing values from the hash.” Stronger still: \(R_e=\mathrm{ThresholdVRF}_{t,N}(m_e)\) (§15).

**Normative steps:**

1. **Epoch binding:** \(e\) is a fixed integer schedule published in the **\(Q_A\)-attested** selection log (wall-clock / L1-slot aligned). Local PoH may annotate proposals; **canonical** \(e\) is the quorum-certified value. Draws for a tip height bind to exactly one \(e\).
2. **Freeze `poolRoot_e` first:** eligibility list \(\mathcal{W}_e\) is the set of on-demand miners whose **join commitments** are included in snapshot root `poolRoot_e`, attested by **≥ \(Q_A\)** archive signatures (or anchored to L1). The snapshot **MUST** be frozen **before** the bound \(\mathrm{L1BeaconFinalizedRandomness}_e\) is known (or bound to a **pre-declared future** CL slot / epoch). A single archive **MUST NOT** privately edit the pool after the freeze; **MUST NOT** re-open the pool after seeing \(R_e\).
3. **Read L1 beacon entropy:** take \(\mathrm{L1BeaconFinalizedRandomness}_e\) from CoNET CL **after** finality for the bound epoch/slot. Archives **MUST NOT** substitute execution `block.hash`, an unpublished beacon value, or a non-final head.
4. **Compute \(R_e\):** hash as above. **Any** participant with the domain tag, beacon randomness, \(e\), `shardId`, and `poolRoot_e` can **recompute** \(R_e\) and the selected set—no trust in a single archive RPC and **no** dependence on which archives published optional VRF proofs.
5. **Map to seats:** Fisher–Yates / modular indexing of \(\mathcal{W}_e\) under \(R_e\) yields the ordered **\(N_V=7\)** committee + **\(S_{\mathrm{sb}}=2\)** standbys (§6.5). Optional issuer slot uses the same \(R_e\) stream with a distinct domain tag.

**Properties:** unpredictability before CL finality of the bound beacon value; **no selective-omission channel** over optional archive VRF; publicly recomputeable; pool snapshot quorum-attested and pre-committed relative to the beacon.

#### 7.8.2 Optional ECVRF tickets (stake-weighted path — after \(R_e\))

When stake-weighted tickets are desired, eligible stakers may publish

`ticket = ECVRF_sk(R_e || roleDomain)` (subscript \(sk\) = signing secret).

Highest / hash-ordered **valid** tickets win roles. Verification uses standard ECVRF verify. Tickets gossip over DePIN ciphertext channels. This path **consumes** the already-fixed §7.8.1 seed; tickets **MUST NOT** be concatenated back into \(R_e\) and **MUST NOT** change the production seed.

#### 7.8.3 MVP only: commit–reveal (and why “one honest seed” is incomplete)

For early testnets / bootstrap when L1 beacon plumbing is unavailable, archives may run classic commit–reveal:

1. Each archive \(i\) samples \(s_i ← \{0,1\}^{256}\).
2. **Commit:** `C_i = keccak256(s_i || eoa_i || e || shardId)` with EIP-191 attestation.
3. After cutoff, **Reveal** \(s_i\); peers check the commitment.
4. Aggregate `R = keccak256(s_1 || … || s_n || e || chainSeed)` over **revealed** values only.
5. Map \(R\) to \(\mathcal{W}_e\) as in production.

**Last-revealer bias (mandatory caveat).** The claim “bias-resistant if at least one honest \(s_i\)” assumes all committed parties **reveal**. The **last revealer** can observe others’ reveals, recompute the would-be \(R\), and then:

- reveal their \(s_i\) if the resulting committee is favorable; or
- **withhold** the reveal (abort / force redraw) if unfavorable.

Slash / fee denial for non-reveal **raises the cost** of abort attacks but **does not remove** this cryptographic bias channel. Therefore commit–reveal is **MVP-only**, must be labeled as such in clients, and **MUST NOT** be advertised as production-unbiasable randomness. Production deployments **MUST** migrate to §7.8.1 (L1 beacon + `poolRoot_e`)—**not** to optional-VRF concatenation.

#### 7.8.4 Selection log

Archive shard appends `{ e, L1BeaconFinalizedRandomness, poolRoot_e, R_e, selected[] }` (or MVP `{ e, commits, reveals, R, selected[] }`) to a **selection chain** (hash-linked SHA-256/Keccak). Entries are gossiped as L2 messages and mirrored on archive storage. Tip genesis / block assembly consumes `selected[]` only after a **≥ \(Q_A\)** archive quorum attestation (same \(Q_A\) family as CommitQC / AC — §5.2.1)—**no tip VM**. Clients **SHOULD** recompute \(R_e\) locally when verifying a draw.

### 7.9 Proof of History (local sequencing clock — not shared order)

**Product freeze:**

> **PoH provides a verifiable local sequencing clock; canonical event ordering is determined by archive quorum certificates.**

Each archive node may maintain a **local** sequence:

```text
h_0 = IV
h_{t+1} = SHA-256(h_t)
```

and periodically publish `(t, h_t, eventDigest)` **checkpoints** as evidence of continuous local computation (verifiable delay / anti-rollback relative to that node’s IV). Peers can recompute a claimed interval on **that** chain.

**What a lone PoH chain does *not* prove** (and MUST NOT be claimed to prove):

| Claim | Why PoH alone fails |
| --- | --- |
| Event \(A\) was seen by **all** archives before event \(B\) | Other nodes may have different inputs or delivery order |
| Every archive used the **same** input set | Local hashes do not force identical mempools |
| No event was **censored** | An archive can omit events from its local chain |
| There are **no two competing orders** | Two archives can publish conflicting PoH-labeled sequences |

Therefore PoH is a **local metronome / anti-rollback clock**, not “the event-order agreement among archive nodes.” **Canonical** waiting-pool order, `poolRoot_e`, selection-log entries, tip height, and archival finality exist only when the relevant object carries an **archive quorum certificate** (**≥ \(Q_A\)**—same family as CommitQC / AC and selection-log attestations) (§5.2.1, §7.8.4, §8.1).

**Allowed uses of PoH:**

1. Local wall-clock substitute / rate limit for proposal pacing.
2. Binding a *proposal* to a local `(t, h_t)` so a signer cannot easily rewrite its own recent history.
3. Optional measurement aid for timeouts (\(T_{\mathrm{vote}}\), etc.)—**timeout enforcement and liveness still follow wall-clock / L1-aligned rules** unless a future ABI freezes otherwise.

**Forbidden framing:** describing PoH checkpoints, by themselves, as cross-archive consensus, shared FIFO, or the sole source of waiting-pool ranks.

### 7.10 Task keys and witness storage

| Material | Derivation | Lifetime |
| --- | --- | --- |
| Task session key | `HKDF-SHA256(master = ECDH_or_shared, info = "dle/task/" ‖ taskId)` | Single block task |
| Chain witness store key | Derived from witness stake key + `chainNFT` | Chain lifetime |
| Delivery ACK id | `keccak256(utf8(openpgp_armor))` | Until ACK |

Validators **SHOULD** wipe task keys after vote. Witnesses retain chain data encrypted at rest with OS keystore / age / OpenPGP symmetric pack—implementation choice, not protocol-mandated.

### 7.11 Anti-lazy verification (false proof sampling)

For storage / PoRep-style checks: replication nodes occasionally submit a **false proof** with a hidden seed. Verifiers who accept it are slashable when the seed is revealed. Construction uses only hashes and EIP-191 reveals—no exotic crypto.

### 7.12 Concrete message profile (normative sketch)

```text
L2Envelope {
  v: 1
  kind: "dle.task.offer" | "dle.block.propose" | "dle.vote" | "dle.roulette.commit" | …
  chainId: uint64          // CoNET L1 id, e.g. 224422
  chainNFT: bytes32
  from: address            // EOA
  ts: uint64               // unix seconds; reject |now-ts| > 600
  body: json               // kind-specific
  signMessage: hex         // EIP-191 over canonical(body fields)
}
→ UTF-8 JSON → base64 → OpenPGP encrypt(to = recipientUserPGP | routePGP)
→ POST /post on entry A or C
```

### 7.13 Implementation checklist

- [ ] Encrypt business L2 payloads to **user PGP**; listen commands to **route PGP**.
- [ ] HTTP entry **A/C ≠ mailbox B**; never treat direct-B as the product path.
- [ ] EIP-191 on every command; reject bad `ecrecover`.
- [ ] AES-GCM (or CBC+HMAC) for listen session keys; ban bare CBC.
- [ ] Production roulette = \(R_e = H(\texttt{"dle.roulette.v1"}\,\|\,\mathrm{L1BeaconFinalizedRandomness}_e\,\|\,e\,\|\,\mathrm{shardId}\,\|\,\mathrm{poolRoot}_e)\); `poolRoot_e` frozen before beacon known; commit–reveal only for MVP; no optional-VRF concatenation (§7.8).
- [ ] Block acceptance = full set of secp256k1 votes on `blockHash`.
- [ ] No private keys in logs; no plaintext mirroring on relays.

---

## 8. Verifiable Roulette and Waiting Pool (Operations)

Cryptographic details are normative in **§7.8–§7.9**. This section states operational behavior.

### 8.1 On-demand miner waiting queue

- Non-archive **on-demand miners** advertise readiness over **DePIN gossip** (and may keep an archive-facing REST/SSE wait handle) into the **waiting queue**.
- This queue is the **only** source from which archive nodes draw the **\(N_V=7\)** validators + **\(S_{\mathrm{sb}}=2\)** standbys for a chain’s current block when a **new event** arrives.
- If a participant already has a live waiting session, archive **terminates the previous** session and places the participant **last** in order (anti-hoarding of slots).
- **Canonical** ordering of awaiting participants is the order encoded in the **\(Q_A\)-attested** `poolRoot_e` / selection-log entry (§7.8.1, §7.9)—**not** “PoH timestamps agreed across archives.” Nodes may attach local PoH labels to join proposals for anti-rollback evidence.
- **Snapshot for a draw:** at epoch \(e\), archives freeze \(\mathcal{W}_e\) under `poolRoot_e` attested by **≥ \(Q_A\)** members **before** the bound \(\mathrm{L1BeaconFinalizedRandomness}_e\) is known (§7.8.1). Clients and validators recompute selection from that root + \(R_e\); **no** single archive’s local wait list or local PoH chain is authoritative.

### 8.2 Anonymous participation via CoNET DePIN

- Participant nodes reach CoNET-DLE through **wallet-address gossip** on CoNET DePIN / CoNET-SI—**without using IP as identity** (§7.3–§7.6).
- Waiting-pool and task messages are OpenPGP ciphertext; entry/mailbox hops remain zero-trust.

### 8.3 Creating a validator committee (per event / block)

1. Hosting **archive shard** observes a **new event** on a chain (or genesis request).
2. Shard freezes `poolRoot_e` (≥ \(Q_A\) attestation) **before** the bound beacon is known, then computes production seed
   \(R_e = H(\texttt{"dle.roulette.v1"}\,\|\,\mathrm{L1BeaconFinalizedRandomness}_e\,\|\,e\,\|\,\mathrm{shardId}\,\|\,\mathrm{poolRoot}_e)\) (§7.8.1). MVP testnets may temporarily use commit–reveal (§7.8.3) with the last-revealer caveat.
3. Roulette maps \(R_e\) over \(\mathcal{W}_e\) to **\(N_V=7\) validators + \(S_{\mathrm{sb}}=2\) standbys** for that chain’s **current block** (optional: also a proposer / issuer slot if required by the contract) (§6.5), **rejecting** draws that would violate committee cumulative exposure \(E_C\le E_{\max}\) (§12.3.2). **Any** party with the public inputs can recompute the same set.
4. After **≥ \(Q_A\)** archive attestation of the draw, selection is recorded on the **selection log**.
5. The committee votes; on **≥ \(Q_V=5\)** accept signatures within \(T_{\mathrm{vote}}\) (with standby promotion if needed), it **submits**; archive shard **quality-checks** then runs **PrepareQC → CommitQC (= AC)** and **archives** if qualified (§6.3, §5.2.1).
6. Selected miners leave the waiting list for this task; unused standbys that were never promoted return to their prior positions; dissolved identities enter **cooldown** \(C_{\mathrm{cool}}\).

### 8.4 Tragedy of the commons (PoRep / lazy verification)

See §7.11. Split mining payout between PoS verifiers and PoRep replication nodes; false-proof sampling slashes lazy verifiers.

---

## 9. Archive Quality Check and Rollback

Any archive member may **propose** rollback when the **\(Q_V\)** validator deposit or quality checks fail; **execution** requires a **RejectCommitQC** under the same lock/justify rules (§5.2.1)—not a unilateral archive decision.

1. Form a **RejectCommitQC** for the unqualified tip (or fail to reach accept AC within the round).
2. Dissolve the chain’s current maintenance group (apply §6.5 cooldowns / refuse slash).
3. Reselect a fresh random group if \(R < R_{\max}\) (**prior members under cooldown**).
4. Regenerate the block under the new group; if \(R_{\max}\) exhausted, escalate (§6.5).
5. Punish cheating:

   - Cheaters may be banned from archive participation; income and stake move to an **income / reward pool**.
   - Equivocating archive members (conflicting prepare/commit votes or ACs at the same height/round role) are **slashed** and removed from the shard roster.
   - Unjustified validator refuse-to-sign is slashed per §6.5; network-fault silence is not.
   - Honest reporters may be rewarded per contract rules.

**Finalization:** a deposited block is final **only** when a valid **Archive Certificate (= CommitQC)** from the hosting shard is available under §5.2.1 lock/justify rules. Incomplete PrepareQC/CommitQC → no finality (stall, TimeoutQC→new round, or RejectCommitQC + rollback). Clients and indexers **must not** treat a single archive RPC success as final.

---

## 10. No tip VM — class-fixed event state machines

**Product freeze:** Atomic tips do **not** host a general-purpose VM. Each tip is a **class-fixed event state machine** (**asset** / **storage** / **trade**). Tip validators and Mode A archives **replay** the same deterministic transition function (§6.3); they do **not** execute user-deployed programs.

| Layer | Role |
| --- | --- |
| **DLE tip** | Fixed event schemas + AC finality for the three classes; isolation by design (no free cross-tip calls). |
| **CoNET L1 EVM** | NFT birth / ownership, oracle valuation, `settleTrade`, registry / ERC-5564—**not** tip bytecode. |
| **Application layer** | Wallets, indexers, Beamio modules, and optional L1 business contracts **compose** tips + L1 into products. |

**Why no tip VM:** asset transfer, storage/copyright delivery, and trade coordination already cover the L2 value surface; a tip VM would add execution / metering / upgrade surface without proportional product gain, and would fight tip isolation.

**Why prose alone is not enough:** cancelling the tip VM removes arbitrary bytecode divergence, but Mode A still requires a **unique** \((\mathrm{parentState}, \mathrm{event}) \mapsto (\mathrm{nextState}, \mathrm{tipStateRoot})\) function. Natural-language FSM sketches allow third-party implementations to accept/reject different DepositBundles or compute different roots—i.e. **consensus forks**. Sections **§10.1–§10.4** freeze the normative metamodel and the **Trade** table; Asset / Storage use the same metamodel with class-specific tables (§10.3–§10.4).

### 10.1 FSM metamodel (normative for all classes)

Every class FSM **MUST** specify the following. Implementations that differ on any row are **non-interoperable**.

| Item | Normative rule |
| --- | --- |
| **States** | Finite explicit enum per class. No grey / implicit states. Terminal states are absorbing except documented reopen (none in v1). |
| **Events** | Finite typed set. One tip block advances **exactly one** accepted event (event-only blocks, §3.2). |
| **Transition table** | Total function on \((\mathrm{state}, \mathrm{eventType})\): either a unique row with preconditions → `nextState` + effects, or **reject** with a fixed error code. Missing rows = reject `ERR_FSM_NO_TRANSITION`. |
| **Preconditions** | Pure predicates over parent tip state + event fields + (when cited) L1 views / oracle answers. Failed precondition → reject; **no** partial tip write. |
| **Effects** | Split **tipEffects** (mutate tip leaves) vs **l1Effects** (`none` / signal / observe). Tip **MUST NOT** claim to reverse finalized L1 transfers. |
| **Event binary encoding** | Canonical bytes: `version:u8 ‖ classId:u8 ‖ eventType:u16 ‖ tipId:bytes32 ‖ nonce:u64 ‖ payload` with **big-endian** integers, **no** implicit JSON key order. `payload` fields are class-defined fixed order (SSZ-style offsets or length-prefixed bytes—**one** encoding family per release; open: exact SSZ vs RLP choice is §15 engineering, field **order and widths** below are frozen). |
| **`classId`** | `1=asset`, `2=storage`, `3=trade`. |
| **Replay domain** | EIP-712 / hash domain string `CoNET-DLE-TipFSM-v1` + `chainId` (CoNET L1) + `tipId` (= birth NFT id / tradeId as `bytes32`). Event signatures and AC bindings **MUST** include this domain. |
| **Nonce** | Per-tip `u64`, strictly increasing by **1** on each accepted event. Replay of equal/lower nonce → `ERR_FSM_NONCE`. Genesis initializes nonce `0`; first event uses `1`. |
| **Timestamp source** | Consensus-relevant time is **only**: (a) event field `deadline` / `expiresAt` as absolute unix **seconds** `u64`, and/or (b) L1 block timestamp of a **cited** L1 tx / oracle update when the transition requires L1 observation. **Forbidden** as consensus truth: validator wall-clock, local PoH alone, archive host clock. Soft UX clocks may display locally but **MUST NOT** alter accept/reject. |
| **Integer widths** | Addresses `bytes20`; ids `bytes32`; amounts **`u128`** in token native units; percentages / bps **`u32`**; enums **`u8`/`u16`**. No floating point in tip state. |
| **USDC / quote decimals** | Quote and fee amounts that are USDC-denominated use **6 decimals** (`1 USDC = 1_000_000`). If the payment token is conet-USDC or another allowlisted ERC-20, the event carries `quoteAsset` + `quoteAmount` in **that** token’s decimals; the **≤ 100 USDC** cap compares the **oracle USDC-6** value. |
| **Oracle round** | Any transition that depends on valuation **MUST** bind `oracleRoundId:u64`, `oracleAnswerUsdc6:u128`, `oracleUpdatedAt:u64` (or an equivalent oracle report hash) inside the event payload. Accept iff the report is from the allowlisted oracle and `answerUsdc6 ≤ 100_000_000` when the cap applies. |
| **`tipStateRoot`** | `Keccak256` Merkle root over sorted leaves `(path:bytes, value:bytes)`. Mandatory leaves include at least: `state`, `nonce`, class-specific account/object leaves, and (trade) listing/match fields. Empty optional leaves use fixed zero hash. Path encoding: ASCII path strings as in §10.2–§10.4. Parent AC’s `tipStateRoot` **MUST** equal the root after applying the event. |
| **Error codes** | Stable `u16` in `0x01xx` (metamodel), `0x11xx` (asset), `0x12xx` (storage), `0x13xx` (trade). Mode A reject **MUST** surface the same code the validators used. |

**Shared error codes (metamodel):**

| Code | Name | Meaning |
| --- | --- | --- |
| `0x0101` | `ERR_FSM_NO_TRANSITION` | No row for `(state, eventType)` |
| `0x0102` | `ERR_FSM_NONCE` | Nonce not parent+1 |
| `0x0103` | `ERR_FSM_DOMAIN` | Bad replay domain / classId / tipId |
| `0x0104` | `ERR_FSM_ENCODING` | Payload decode / width failure |
| `0x0105` | `ERR_FSM_ORACLE` | Missing/stale/over-cap oracle binding |
| `0x0106` | `ERR_FSM_AUTH` | Signer is not authorized for this event |
| `0x0107` | `ERR_FSM_L1_PRECONDITION` | Required L1 view failed (ownership, escrow, settle tx) |
| `0x0108` | `ERR_FSM_DEADLINE` | Deadline / expiry predicate failed |

### 10.2 Trade-class FSM (product freeze)

**States (`u8`):** `None=0`, `Open=1`, `Locked=2`, `SettleReady=3`, `Settled=4`, `Closed=5`.

**Events (`u16`):** `TradeOpened=0x1301`, `BuyerLocked=0x1302`, `SettleReady=0x1303`, `L1Settled=0x1304`, `Cancelled=0x1305`, `Expired=0x1306`.

**Transition table:**

| Current | Event | Preconditions (summary) | Next | Tip effects | L1 effects |
| --- | --- | --- | --- | --- | --- |
| `None` | `TradeOpened` | Signer = seller; `seller = ownerOf(subjectNftId)` on L1; oracle USDC-6 ≤ 100M with bound `oracleRoundId`; `deadline >` cited L1 time; genesis class=`trade` | `Open` | Init listing leaves: subject, seller, quoteAsset, quoteAmount, deadline, oracle*; nonce←1 | Freeze / escrow **subject NFT** (registry or Settlement) |
| `Open` | `BuyerLocked` | Signer authorized buyer path; payment authorization / escrow deposit valid for exact quote; nonce ok | `Locked` | Record `buyer`, `paymentAuthHash` / escrow ref | Lock **funds** (or pull-authorization) in Settlement escrow |
| `Locked` | `SettleReady` | `buyer` / quote / deadline still valid; match fields equal locked auth; nonce ok | `SettleReady` | Commit match + fields required by SettleReady AC (§4.7); expose `tipStateRoot` | **none** (AC is tip/archive plane) |
| `SettleReady` | `L1Settled` | Observe successful L1 `settleTrade` for this `tradeId`+nonce; receipt fields match AC payload | `Settled` then auto-`Closed` in same accept (or two-step with identical effects) | Record `l1TxHash`; mark closed | Already applied on L1 (NFT+payment); tip **follows** |
| `Open` or `Locked` | `Cancelled` | Signer = seller **or** buyer under frozen cancel rule; not past irreversible L1 settle | `Closed` | Clear match intent | Unlock subject NFT + funds |
| `Open` or `Locked` | `Expired` | Cited L1 time `>` `deadline`; no L1 settle | `Closed` | Mark expired | Unlock subject NFT + funds |
| `SettleReady` | `Cancelled` / `Expired` | Same as above **and** no L1 settle observed | `Closed` | Clear SettleReady | Unlock |
| `Settled` / `Closed` | * | — | — | reject `ERR_FSM_NO_TRANSITION` | — |

**Forbidden:** tip-only `Settled` without `L1Settled` observation; inventing `Matched` as a tip state; accepting `SettleReady` from `Open` without `BuyerLocked`.

**Trade payload field order (normative widths):**

| Event | Payload fields (in order) |
| --- | --- |
| `TradeOpened` | `subjectNftId:bytes32`, `seller:address`, `quoteAsset:address`, `quoteAmount:u128`, `deadline:u64`, `oracleRoundId:u64`, `oracleAnswerUsdc6:u128`, `oracleUpdatedAt:u64` |
| `BuyerLocked` | `buyer:address`, `paymentAuthHash:bytes32`, `escrowRef:bytes32` |
| `SettleReady` | `buyer:address`, `quoteAsset:address`, `quoteAmount:u128`, `deadline:u64`, `settleNonce:u64` (= tip nonce) |
| `L1Settled` | `l1TxHash:bytes32`, `l1BlockNumber:u64`, `l1BlockHash:bytes32` |
| `Cancelled` | `reasonCode:u16`, `initiator:address` |
| `Expired` | `citedL1BlockNumber:u64`, `citedL1Timestamp:u64` |

**Trade `tipStateRoot` paths (minimum):** `/state`, `/nonce`, `/subjectNftId`, `/seller`, `/buyer`, `/quoteAsset`, `/quoteAmount`, `/deadline`, `/oracleRoundId`, `/paymentAuthHash`, `/l1TxHash`.

**Trade error codes:** `0x1301 ERR_TRADE_NOT_OWNER`, `0x1302 ERR_TRADE_BAD_QUOTE`, `0x1303 ERR_TRADE_BAD_PAYMENT`, `0x1304 ERR_TRADE_AC_MISMATCH`, `0x1305 ERR_TRADE_L1_NOT_FOUND`, `0x1306 ERR_TRADE_ALREADY_SETTLED`.

### 10.3 Asset-class FSM (form freeze; table skeleton)

**States:** `Active`, `SpilloverPending`, `Exited` (plus ordinary holding under `Active`).  
**Core events (ids `0x11xx`):** `DepositAck`, `Transfer`, `FeePaid`, `Revalue`, `SpilloverOpen`, `ForceWithdrawn` (ties §4.6 / `forceWithdraw`).

Each accepted transfer/revalue **MUST** bind oracle round fields and enforce post-event oracle value **≤ 100 USDC-6** or require spillover new-chain events before outbound excess. Full leaf paths and every precondition row follow the §10.1 metamodel; engineering may extend the table without adding a tip VM. Open: exact fee-split leaf updates and spillover multi-event packaging (§15).

### 10.4 Storage-class FSM (form freeze; table skeleton)

**States:** `Configured`, `PurchaseOpen`, `Delivering`, `Completed`, `Expired` (content access); lineage/social/sales journal events are **append-only side journals** that **MUST NOT** mutate content-access state except via documented rows.  
**Core events (ids `0x12xx`):** `ContentConfigured`, `PurchaseOpened`, `DeliveryCompleted`, `StorageRenewed`, `AccessExpired`, plus journal events `ParentLinked`, `SocialSigned`, `SaleBooked` (§4.8–§4.10).

First-completer and buyer-PGP rules stay as tip preconditions (hash commitments only—no plaintext). Open: numeric challenge windows and sales↔asset finality timing (§15).

### 10.5 Mode A replay obligation (restated)

Given parent `(tipStateRoot₀, state₀, nonce₀)` and event bytes `E`:

1. Decode `E` under §10.1; verify domain, classId, tipId, nonce.
2. Look up transition row; evaluate preconditions (including L1/oracle as required).
3. Apply tipEffects → `(state₁, tipStateRoot₁)`.
4. Accept iff roots/state match the proposed block; else reject with the table’s error code.

Committee \(Q_V\) attestations **do not** replace this function (§6.3).

---

## 11. Features Summary

| Feature | Mechanism |
| --- | --- |
| Proof of Stake participation | Stake to become issuer, witness, validator; **\(N_V=7\)**, **\(Q_V=5/7\)** proposal quorum per block (§6.5). |
| Many parallel atomic chains | Concurrent tips scale with staking / archive shards; each chain is event-atomic (not “infinite free TPS”). |
| Archive draws 7 + 2 standbys | RequestPool → SelectionLog roulette → **7**+**2** → DepositBundle → **Mode A** archive FSM replay → **PrepareQC → CommitQC (= AC)** (§6.3, §6.5, §5.2.1). |
| Mode A archive verification | Every AC-signing archive **replays** the fixed FSM; committee is pre-exec/witness only; Mode B fraud proofs out of v1 (§6.3). |
| Archive-plane fission 2/4/8… | More archive nodes → \(S_e=2^k\); route by \(H(\mathrm{contract}\|\mathrm{tokenId}\|R_e)\bmod S_e\); fission via **MigrationCertificate** (§5.2). |
| Archive-shard BFT finality | HotStuff-style two-phase QC; \(f=\lfloor(N_A-1)/3\rfloor\), \(Q_A=\lfloor 2N_A/3\rfloor+1\); AC=CommitQC; locks + `membershipRoot`; no “first \(Q_A\) wins”; L1 escape hatch (§5.2.1). |
| Trilemma boundary (§3.4) | Does **not** eliminate the trilemma; many isolated, value-bounded tips; aggregate scale with archive shards; security **conditional**. |
| On-demand role participation | Role-split actors need not sync all data; join/exit consensus as capacity allows. |
| L1 NFT birth certificate | Unique CoNET L1 NFT before genesis; class = asset **or** storage **or** trade. |
| Asset cap + micro-fragmentation | Oracle ≤ **100 USDC** at mint **and** on each event; over-cap outbound → **new chain** (§4.6). |
| Trade-class atomic NFT sale | Tip = L2 coordinator; L1 `settleTrade` atomically pays + moves **subject NFT**; tip then **closes** (§4.7). |
| Storage / CopyrightContent delivery | Fragmented ciphertext; private index → authorized miner PGP; tip = hashes only; **conet-GB** access; first-completer → buyer PGP package; short-lived URLs + `storagePaidUntil` (§4.8). |
| Copyright ZERO version tree | Parent/child storage NFTs; each branch independently trade-listable; social likes/comments/citations as tip history; WoT-weighted auction signals (§4.9). |
| Storage sales ↔ asset txs | Storage tip keeps sales-revenue journal; value moves on parallel **asset-class** tips; rows link `assetNftId`/`assetTxId` (§4.10). |
| Dual fee rails (§13) | **Storage:** content / access / retention in **conet-GB**. **Asset/trade:** **0.01%** in **USDC**; of that fee **50% archive / 50% \(Q_V\) validators**. **0.01% alone** is not a full security budget. |
| No tip VM (§10) | Class-fixed FSMs + normative metamodel; Trade full transition table; Mode A deterministic replay; app-layer composes tips + L1; **no** user bytecode. |
| Event-driven blocks | **No event ⇒ no block**; empty tips are never mined. |
| Natural privacy (dual) | Comms: DePIN + OpenPGP (§7); assets: raise clustering cost + break one-address portfolio map; **not** strong anonymity (§4.5). |
| Receive-code predict-*n* (client) | **Canonical ERC-5564** (meta-address, ephemeral key, view tag, announcement, scan/spend, batch *n*, recover/scan); BIP-47/BIP-352 = references only; **not** tip/archive/validator-committee duty (§4.5). |
| Fragment custody security | Conditional: many EOAs ≠ safer; need **key-domain + recovery-domain** isolation + hierarchical vault SHOULD (§4.5, §12.9). |
| Recipient anonymity boundary | Stronger payee unlinkability = **client product** design using L2; **not** tip/archive/validator infra (§4.5). |
| Better decentralization | Lightweight validators; on-demand participation without full storage. |
| Concurrent execution | One staker can serve many chains under different role rules. |
| Aggregate scalability | Dynamic clustering by chain; more participants / shards → more maintainable tips (conditional on DA & honesty). |
| Safe and reliable | Random distinct miners; \(5/7\) quorum + standbys + \(R_{\max}\) anti-grief; archive CommitQC / AC finality. |
| Efficient resources | Work is scoped to active events and small groups. |
| Limited per-tip cash blast | Asset-tip **direct** oracle loss ≤ **100 USDC**; does **not** zero collusion motive (§12.2). |
| Capture probability quantified | Use \(P_{\mathrm{prop}}\) / \(P_{\mathrm{year}}\)—not \(p^{5}\) alone, not the cap alone (§12.3.1). |
| Committee exposure cap | Per epoch / round: \(E_C=\sum_j V_j\le E_{\max}\) over concurrent assignments to the same committee (§12.3.2). |

---

## 12. Security Threat Model

### 12.1 Byzantine disagreement inside a group

**Mitigation:** require **\(Q_V=5/7\)** (not \(5/5\)); on failure promote standbys then dissolve/reselect under §6.5; slash **equivocation** and **unjustified refuse**; bound consecutive reselections by \(R_{\max}\).

### 12.2 Limited value per asset chain (≤ 100 USDC) — what the cap does and does not do

Each asset-class chain is hard-capped at **≤ 100 USDC-equivalent** by the **L1 oracle** at deposit / mint **and again on every new event** (§4.6). If revaluation shows balance **> 100 USDC**, outbound / excess **must** move via **new chain(s)**—not by growing one tip past the cap.

**Accurate product conclusion (freeze):**

> The **100 USDC** ceiling constrains **direct economic loss on a single asset tip**. It does **not** replace committee security, archive security, or **cross-tip** risk control—and it does **not** imply that collusion motive “tends to zero.”

**Why the cap alone cannot eliminate collusion motive**

| Residual channel | Why ≤100 USDC per tip is insufficient |
| --- | --- |
| **Many tips, one committee** | A malicious \(Q_V\) set can be assigned (or re-drawn into) **many** tips in a window; losses **add** across tips unless \(E_C\) is capped (§12.3.2) |
| **Batch-synchronized transfers** | An attacker can stage many parallel micro-tips / events so a single corrupted draw window hits a **portfolio** of ≤100 USDC slices |
| **Off-book / NFT utility value** | Storage / identity / copyright NFTs may represent content or rights **worth far more than 100 USDC** even when a linked asset tip is capped |
| **Oracle under-valuation** | Manipulated or lagging oracles can make **book** value ≤100 while **true** transferable value is higher |
| **Trade-class attached rights** | Atomic listing quotes ≤100 USDC, but settle moves **subject NFT ownership**; attached rights / future cashflows may exceed the quote |
| **Non-theft attack payoffs** | Censorship, ransom, selective delay, or **privacy leakage** can pay more than stealing the tip’s book balance |

**Important:** a low **per-committee** capture probability is **not** the same as a low **annual** capture probability. Operators and clients **must** use §12.3.1; citing only “≤ 100 USDC” without \(P_{\mathrm{year}}\) **and** without \(E_C\le E_{\max}\) (§12.3.2) is incomplete security reasoning.

### 12.3 Collusion of creator + witnesses / validators

Mitigations stack:

1. **Random short-lived small groups** across a large staking set → small **single-shot** \(P_{\mathrm{prop}}\) when attacker waiting-pool share \(p\) is modest (§12.3.1).
2. **Per-tip loss ceiling:** each asset tip’s **direct** oracle loss ≤100 USDC—**not** a claim that total attacker EV → 0 (§12.2).
3. **Committee cumulative exposure** \(E_C\le E_{\max}\) so one draw cannot underwrite unbounded concurrent micro-tips (§12.3.2).
4. Failed collusion risks **stake slash**; honest members may be rewarded from fees / slash redistributions.
5. **Archive Certificate** still required for spendable finality—proposal-layer capture alone is not enough (§5.2.1, §12.3.1).

### 12.3.1 Committee capture probability (must quantify)

**Pedagogical baseline (rejected v0 \(Q_V=5/5\)).** If an attacker controls waiting-pool fraction \(p\) and draws are i.i.d. uniform, the probability that **all five** seats are adversarial is

\[
P_{\mathrm{capture}}^{(5/5)} = p^{5}.
\]

| Attacker pool share \(p\) (%) | \(P_{\mathrm{capture}}^{(5/5)}=p^{5}\) |
| ---: | ---: |
| 10 | \(10^{-5}\) |
| 20 | \(3.2\times 10^{-4}\) |
| 33 | \(\approx 3.9\times 10^{-3}\) |
| 50 | \(3.125\times 10^{-2}\) |

**v1 product freeze (\(N_V=7\), \(Q_V=5\)).** A malicious **proposal deposit** does **not** require all seven seats—only **≥ 5** accept signatures. Under the same i.i.d. model (\(K\sim\mathrm{Binomial}(7,p)\)):

\[
P_{\mathrm{prop}}
= \Pr[K \ge 5]
= \binom{7}{5} p^{5}(1-p)^{2}
+ \binom{7}{6} p^{6}(1-p)
+ p^{7}.
\]

| Attacker pool share \(p\) (%) | \(P_{\mathrm{prop}}=\Pr[K\ge 5]\) (approx.) |
| ---: | ---: |
| 10 | \(1.765\times 10^{-4}\) |
| 20 | \(4.672\times 10^{-3}\) |
| 33 | \(\approx 4.34\times 10^{-2}\) |
| 50 | \(2.266\times 10^{-1}\) |

So moving from \(5/5\) to \(5/7\) **raises** single-shot proposal-capture probability (the liveness trade-off of §6.5). Security arguments **must** use \(P_{\mathrm{prop}}\), not \(p^{5}\).

**Cumulative / annual risk.** If the network forms \(M\) independent committee draws in a window (e.g. a year), the probability of **at least one** proposal-layer capture is

\[
P_{\mathrm{year}}^{\mathrm{prop}}
= 1 - (1 - P_{\mathrm{prop}})^{M}
\approx 1 - e^{-M\,P_{\mathrm{prop}}}
\quad (P_{\mathrm{prop}}\ll 1).
\]

Expected captures in that window: \(\mathbb{E}[N_{\mathrm{cap}}] = M\,P_{\mathrm{prop}}\).

Illustrative \(M\) (order-of-magnitude; production must measure real draws):

| Draws / day | \(M\) / year | \(p=5\%\) | \(p=10\%\) | \(p=20\%\) |
| --- | ---: | ---: | ---: | ---: |
| \(10^{2}\) | \(\approx 3.65\times 10^{4}\) | \(\mathbb{E}\approx 0.22\), \(P_{\mathrm{year}}\approx 0.20\) | \(\mathbb{E}\approx 6.4\), \(P_{\mathrm{year}}\approx 1\) | \(\mathbb{E}\approx 1.7\times 10^{2}\), \(P_{\mathrm{year}}\approx 1\) |
| \(10^{3}\) | \(\approx 3.65\times 10^{5}\) | \(\mathbb{E}\approx 2.2\), \(P_{\mathrm{year}}\approx 0.89\) | \(\mathbb{E}\approx 64\), \(P_{\mathrm{year}}\approx 1\) | \(\mathbb{E}\gg 1\), \(P_{\mathrm{year}}\approx 1\) |
| \(10^{6}\) | \(\approx 3.65\times 10^{8}\) | \(\mathbb{E}\gg 1\), \(P_{\mathrm{year}}\approx 1\) | same | same |

**Conclusion:** with millions of committees per day, a “small” \(P_{\mathrm{prop}}\) still yields **near-certain** annual proposal captures unless \(p\) is kept **very** small (and/or \(M\) is rate-limited). **Therefore “each chain ≤ 100 USDC” is a per-tip direct-loss ceiling, not a substitute for \(P_{\mathrm{year}}\), archive BFT, or \(E_C\le E_{\max}\).**

**Loss accounting (product freeze) — cash book-value only.**

\[
\mathbb{E}[\text{annual proposal-capture book loss}]
\;\le\;
100\,\mathrm{USDC}\,\times\,\mathbb{E}[N_{\mathrm{cap}}]
\;=\;
100\,\mathrm{USDC}\,\times M\,P_{\mathrm{prop}},
\]

**before** slash redistributions, **before** noting that **spendable** theft also needs an **Archive Certificate** (§5.2.1), and **excluding** non-cash payoffs (censorship / ransom / privacy) and under-oracle NFT utility (§12.2). If archive Byzantine share is \(p_A\) on a floor shard \(N_A=4\), \(Q_A=3\), independently,

\[
P_{\mathrm{AC}} = \Pr[\mathrm{Binomial}(4,p_A)\ge 3],
\qquad
P_{\mathrm{tip}}^{\mathrm{final}} \approx P_{\mathrm{prop}}\cdot P_{\mathrm{AC}}
\]

(only as an **illustration**—real adversaries may correlate pools). Example at \(p=p_A=0.10\): \(P_{\mathrm{prop}}\approx 1.8\times 10^{-4}\), \(P_{\mathrm{AC}}=3.7\times 10^{-3}\), joint \(\approx 6.5\times 10^{-7}\) per tip—still must be folded into \(1-(1-P_{\mathrm{tip}})^{M}\).

**Operational obligations (product freeze).**

1. Publish and monitor waiting-pool attacker-share proxies (stake concentration, identity clustering).
2. Track \(M\) (committee draws / day) and compute \(P_{\mathrm{year}}\) under conservative \(p\).
3. Keep \(p\) down via Sybil-costly stake, cooldowns (§6.5), and queue admission—not by rhetoric alone.
4. Never claim “capture is negligible because \(p^{5}\) is tiny” or “because tips are ≤ 100 USDC” without stating \(M\), \(P_{\mathrm{year}}\), and the active \(E_{\max}\) policy (§12.3.2).
5. Never claim “collusion motive → 0” from the per-tip cap alone (§12.2).

### 12.3.2 Committee cumulative exposure \(E_C\le E_{\max}\) (product freeze)

The per-tip cap does **not** stop one malicious committee from underwriting **many** micro-tips in a short window. Production selection **MUST** enforce a **committee cumulative exposure** bound per **epoch** (or per selection-log round window—freeze one ABI schedule):

\[
E_C
\;=\;
\sum_{j\,\in\,\text{committee assignments}} V_j
\;\le\;
E_{\max}.
\]

| Symbol | Meaning |
| --- | --- |
| \(j\) | A tip / event assignment currently under that committee (or overlapping membership set) in the epoch |
| \(V_j\) | Oracle-valued **direct** exposure of assignment \(j\) (asset tip revalued balance; for trade listings use quote; storage-linked asset rails counted when the committee can move them) |
| \(E_C\) | Sum of those \(V_j\) for the committee in the epoch |
| \(E_{\max}\) | Protocol constant (governance-tunable); **must** satisfy \(E_{\max}\ge 100\,\mathrm{USDC}\) and **should** be \(\ll\) “unbounded multi-tip portfolio” |

**Normative rules:**

1. Roulette / assignment **MUST reject** (or queue) a new tip assignment that would make \(E_C>E_{\max}\) for the drawn committee.
2. Archives **MUST NOT** issue an AC for a tip whose concurrent committee exposure set violates \(E_C\le E_{\max}\) under the published epoch snapshot.
3. \(E_{\max}\) is a **cross-tip** control; it complements—not replaces—\(P_{\mathrm{year}}\) and archive \(Q_A\) finality.
4. Exact numeric \(E_{\max}\), whether exposure is per exact 7-tuple or per overlapping miner, and how storage-only tips contribute to \(V_j\), remain open parameters (§15)—the **inequality form** is frozen.

### 12.4 Signature / liveness faults

Handled by \(T_{\mathrm{vote}}\), standby promotion, fault attribution (network vs malice), cooldown \(C_{\mathrm{cool}}\), and \(R_{\max}\) escalation (§6.4, §6.5).

### 12.5 Double-spend and spam (asset chains)

Transfers verified by issuer + witnesses + validators. Detected collusion → slash CBDC/witness stake and reward honest validators. Mint/redeem through mainchain contracts controls spam; capped per-tip book value **limits direct cash upside of a single tip**, while \(E_C\le E_{\max}\) limits concurrent multi-tip cash upside (§12.2–§12.3.2).

### 12.6 Archive capture / equivocation / censorship

Archive plane **fissions** to \(S_e \in \{2,4,8,\ldots\}\) with hash placement \(H(\mathrm{contract}\|\mathrm{tokenId}\|R_e)\bmod S_e\) as membership grows (§5.2), so a capture must target the shard that hosts a given chain—not one global archive set. Grindable `tokenId mod S` is **rejected**.

**BFT assumption (product freeze):** each shard runs HotStuff-style **PrepareQC → CommitQC (= AC)** with \(f=\lfloor(N_A-1)/3\rfloor\), \(Q_A=\lfloor 2N_A/3\rfloor+1\), and lock/justify rules (§5.2.1). Safety holds if at most \(f\) members are Byzantine. Quorum intersection plus locks prevent two conflicting finalized tips for the same height under that bound; same-role equivocation is slashable and resolved on L1. Partition without \(Q_A\) yields **stall**, not dual finals (safety over liveness).

**Censorship:** a single archive (or minority) cannot unilaterally reject or withhold finality forever—reject needs \(Q_A\); sustained non-progress past \(T_{\mathrm{archive}}\) unlocks bonded L1 **`ArchiveCensorshipChallenge`** and re-home. **DA:** AC-bound `daRoot` + \((n,k)=(10,6)\) + pre-sign hold-≥\(k\) + **UnavailableChallenge**; spendable balances require an AC with **reconstructible DA**; failure escalates to **`forceWithdraw`** ↔ AssetVault. Cheating archive participants can be banned and have stake redirected. Long-term security still depends on the \(f\)-bound per shard and mainchain registry integrity.

### 12.7 Transport / privacy adversaries

Covered in §7.1 and §7.6. Relays that attempt plaintext decryption fail by construction (no session keys). Direct-to-mailbox clients are a **protocol violation**, not a supported mode—they would weaken ingress privacy.

### 12.8 Asset-linkage adversaries

Fragmentation **raises the cost** of inventing “Alice’s total balance” from a **single** payee EOA and breaks **one-address portfolio equivalence**—it does **not** make correlation fail by default. Observers may still cluster via shared L1 deposit sources, mint timing, similar amounts, shared gas / fee payers, oracle and device-network timing, simultaneous spends, and post-trade re-aggregation (§4.5). Compromising a user’s client (or leaked recombination / scan secrets) is out of scope for on-chain privacy—custody of the map is a **client security** problem.

### 12.9 Single-key seizure / phishing / shared recovery domain

On classical chains, stealing **one** hot-wallet key often empties the user’s economic life. Under DLE fragmentation, a key that controls **only one independently protected** fragment EOA can move at most that fragment’s ≤100 USDC slice (plus whatever the victim consolidated). That blast-radius claim **fails** if all fragments share one mnemonic, one device vault, one client recombination database, or one weak recovery password—then compromising that **recovery domain** still empties the portfolio (§4.5).

**Product obligation:** wallets SHOULD implement hierarchical key-vault practices (online scan key; batched spend derivation; hardware/threshold for high-value fragments; encrypted recovery map; per-shard derivation domains; per-device hourly merge/withdraw caps). Tip / archive / validator infrastructure does **not** enforce these client controls.

---

## 13. Economics (Design Outline)

### 13.1 Why **0.01% alone** is not a full security budget

Each asset tip is capped at **≤ 100 USDC**. At fee rate **0.01%**, the **maximum** tip-event fee on a full-cap transfer is:

\[
100\ \mathrm{USDC} \times 0.01\% = 0.01\ \mathrm{USDC}.
\]

Under the frozen **50% hosting archive / 50% \(Q_V\) validators** split (§13.3):

\[
\begin{aligned}
\text{archive half} &= 0.01 \times 50\% = 0.005\ \mathrm{USDC},\\
\text{validator half} &= 0.01 \times 50\% = 0.005\ \mathrm{USDC},\\
\text{per accepting validator (among 5)} &= 0.005 / 5 = 0.001\ \mathrm{USDC}.
\end{aligned}
\]

Do **not** illustrate “\(0.01/5=0.002\) USDC per validator”—that ignores the archive half. Even \(0.001\) USDC/validator is **before** paying: **network transport**, **oracle**, **L1 NFT mint**, **data retention**, **reselection / failed-draw costs**, and **conet-GB ↔ USDC** price volatility.

**Honest freeze:** the **0.01%** tip-event fee is a **product constant for asset/trade consensus payouts**, **not** a claim that it alone funds a sustainable end-to-end security budget. Sustainable economics **must** combine (i) the USDC 0.01% split below, (ii) **storage-class conet-GB content fees** (volume-scaled), (iii) separate L1 mint / oracle / challenge bonds where configured, and (iv) optional later governance of rates—not “0.01% covers everything.”

### 13.2 Fee denomination (product freeze)

| Chain class | Fee base | Currency |
| --- | --- | --- |
| **Storage-class** | **Content size / retention / access / social** as configured (§4.8–§4.9) | **conet-GB** (CoNET L1 `GBToken` ERC-20) |
| **Asset-class** | Each **transfer** event: **0.01%** of transferred (oracle-valued) amount | **USDC** |
| **Trade-class** | Listing / settle hooks on quote or settle notional: **0.01%** where the fee applies | **USDC** |

CNET stake remains the **qualification / slash** asset for roles; it is **not** the per-event fee unit.

### 13.3 Split of the **0.01%** (asset / trade)

Of every **USDC 0.01%** tip-event fee:

| Share | Recipient | Split rule |
| --- | --- | --- |
| **50%** | **Hosting archive shard** | Among members who form the **CommitQC / AC** (\(Q_A\) commit signers)—equal unless governance mandates weighted shares |
| **50%** | **\(Q_V\) accepting validators** | Equal among the ≥5 accept signers on the archived tip |

Standbys that never accept, reject-only voters, and non-signing archive members **do not** share that event’s fee. Storage-class **conet-GB** content / access streams are **separate** from this 50/50 USDC split (owner / delivery-miner shares per §4.8).

### 13.4 Flow table

| Flow | Intent |
| --- | --- |
| Stake CONET (CNET) | Qualify as archive / witness / validator / issuer; slash collateral. |
| L1 NFT mint + class | Birth certificate of every chain; binds **asset / storage / trade**; mint gas / protocol mint fee **separate** from tip 0.01%. |
| Asset ingress | Deposit L1 assets; **L1 oracle** valuation; **≤ 100 USDC-equivalent** hard cap. |
| Asset event revalue | Each asset **event** revalues balance; if **> 100 USDC**, outbound excess requires **new chain(s)** (§4.6). |
| Asset event fee | **0.01%** of transferred value in **USDC**; **50% archive / 50% \(Q_V\) validators** (§13.3). |
| Storage fees | Scale with **stored content**; paid in **conet-GB**; unpaid → halt new blocks. |
| Storage access purchase | Owner-priced **conet-GB** payment for buyer-bound delivery; does **not** transfer storage NFT (§4.8). |
| Delivery-node retention fee | Periodic **conet-GB** to first-completer / authorized set; advances `storagePaidUntil` (§4.8). |
| Storage social / fork | Signed like / comment / cite events; fork mints child storage NFT with `parentNftId`; WoT inputs for auctions (§4.9). |
| Storage sales journal | Book access / NFT / royalty sales on storage tip; link parallel **asset-class** payment txs (§4.10). |
| Trade listing / settle | Quote ≤ **100 USDC**; tip → **SettleReady** AC; **L1 `settleTrade`** atomizes payment + **subject NFT** transfer; tip then **close**; event fees in **USDC** under §13.3 (§4.7). |
| Mining / task rewards | Pay honest group members primarily from the **USDC 0.01%** stream (validators + archive) and **storage conet-GB** streams; fund slash redistributions. |
| Group size vs income | Fission to more \(2^k\) shards + smaller per-shard cohorts → higher per-node share of the **archive 50%** and **parallel bandwidth** (§5.2). |
| Mainchain governance | Supported deposit assets, listing rules; may revise rates. Defaults: **0.01%**, **100 USDC cap**, **50/50 archive/validators**, **storage = conet-GB / other = USDC**. |

---

## 14. Comparison Sketch

| Approach | Tip model | Typical bottleneck | CoNET-DLE contrast |
| --- | --- | --- | --- |
| Monolithic L1 | One global tip | Gas + block time | Many independent tips |
| Optimistic / ZK L2 | Shared rollup tip / batch market | Sequencer + L1 data cost | Parallel per-ledger groups + DePIN privacy transport |
| App-chains / subnets | One chain per app (heavy) | Validator set cost | Ultra-light, event-driven, value-capped chains |
| Side DB / centralized API | Off-chain mutability | Trust & availability | On-chain immutability with archive checks |
| IP-address P2P L2 | libp2p / TCP identity | IP metadata leakage | Wallet-address gossip; relays never see plaintext |

CoNET-DLE is closest in spirit to **“many tiny ledgers + random committees + archive finalizers”**, carried on **CoNET DePIN wallet-address gossip**, optimized for private, payment-friendly bounded state machines rather than general-purpose shared blockspace. Versus slogans that claim to **solve** the **trilemma**, DLE’s claim is to **redefine the operating boundary** with conditional security (§3.4).

---

## 15. Open Design Questions / Implementation Notes

These items are left explicit so engineering can freeze parameters without rewriting the thesis:

1. Exact **thresholds** that advance archive-plane width \(S_e\) along \(2 \to 4 \to 8 \to \cdots\) (membership / load), subject to post-fission \(N_A \ge 4\) per shard. Placement is product-frozen: \(i = H(\mathrm{nftContract}\|\mathrm{tokenId}\|R_e)\bmod S_e\) with anti-grinding bonds; fission requires **MigrationCertificate** dual-shard \(Q_A\) (§5.2)—**not** \(i=\mathrm{tokenId}\bmod S\). Open items: numerical bond sizes, optional commit-to-\(R_{e+1}\) mint windows, MC L1 checkpoint ABI. Validator proposal layer is product-frozen: **\(N_V=7\)**, **\(Q_V=5/7\)**, **\(S_{\mathrm{sb}}=2\)**, \(T_{\mathrm{vote}}=30\,\mathrm{s}\), \(C_{\mathrm{cool}}\), \(R_{\max}=3\) (§6.5)—not \(5/5\). **Archive verification Mode A** (every AC signer independently replays the fixed FSM; committee = pre-exec/witness only) and the **RequestPool → SelectionLog → ArchiveIngressPool → ArbitrationPool** pipeline are product-frozen (§6.3)—**Mode B** fraud-proof / sampling archives are **out of v1**. **Archive-shard BFT protocol family** is product-frozen as HotStuff-style **PrepareQC → CommitQC (= AC)** with \(f=\lfloor(N_A-1)/3\rfloor\), \(Q_A=\lfloor 2N_A/3\rfloor+1\), lock/justify, `membershipRoot`, no sticky leader, L1 escape hatch (§5.2.1)—**not** an open “which consensus family” question. Still open for engineering: numeric \(T_{\mathrm{archiveRound}}\), Prepare/Commit vote ABI encoding, membership Merkle leaf format, MembershipUpdateCertificate ABI, DepositBundle encoding. **Committee capture math** is product-frozen in form (§12.3.1): \(P_{\mathrm{prop}}=\Pr[\mathrm{Bin}(7,p)\ge 5]\), \(P_{\mathrm{year}}=1-(1-P_{\mathrm{prop}})^{M}\); open items are measured \(M\), conservative \(p\) estimators, and joint archive correlation—not whether annual risk may be ignored. **Per-tip 100 USDC** is a **direct-loss ceiling only** (§12.2)—not “collusion motive → 0.” **Committee cumulative exposure** form is frozen: \(E_C=\sum_j V_j\le E_{\max}\) (§12.3.2); open items are numeric \(E_{\max}\), epoch vs round window, and how storage-only tips enter \(V_j\).
2. Roulette randomness is product-frozen in form (§7.8): production \(R_e = H(\texttt{"dle.roulette.v1"}\,\|\,\mathrm{L1BeaconFinalizedRandomness}_e\,\|\,e\,\|\,\mathrm{shardId}\,\|\,\mathrm{poolRoot}_e)\) with **CoNET beacon / CL finalized randomness** (not execution `block.hash`) and \(Q_A\)-attested `poolRoot_e` frozen **before** that beacon is known; optional ECVRF tickets may consume \(R_e\) but **MUST NOT** rewrite it; concatenating optional archive VRF into \(R_e\) is **rejected** (selective-omission / last-publisher bias). Commit–reveal **MVP-only** (last-revealer bias acknowledged). Open items: exact CL randomness field / slot alignment ABI, `poolRoot` Merkle encoding, freeze-vs-beacon timing constants. Phase-2 candidates: \(\mathrm{ThresholdVRF}_{t,N}(m_e)\); if archive VRF mixing returns, require a pre-beacon `vrfContributorRoot` with no “drop missing outputs” aggregation.
3. Exact bonded fraction \(B_{\mathrm{refuse}}\) for unjustified refuse-to-sign, optional light availability-score decay for network-fault silence, and whether \(T_{\mathrm{vote}}\) / \(T_{\mathrm{sb}}\) remain wall-clock-only or also cite local PoH measurements (§6.5)—**without** treating PoH as shared order (§7.9).
4. PoH is product-frozen as a **local** sequencing clock only; canonical order = archive QC (§7.9). Open items: SHA-256 tick rate, checkpoint publish interval, how much local PoH evidence to attach to join proposals—not whether PoH alone orders the waiting pool.
5. Slash amounts, bounty shares, ban durations, and concrete \(T_{\mathrm{archive}}\) / bond sizes for **`ArchiveCensorshipChallenge`** (fee rate **0.01%**, **50/50 archive/validators**, asset cap **100 USDC**, and dual denomination **storage=conet-GB / asset·trade=USDC** are product-frozen defaults—see §13). Open: how the archive **50%** is weighted among AC signers vs whole shard; whether tip **USDC** is native Base USDC, conet-USDC, or an oracle unit; separate L1 mint / oracle / retention fee lines beyond 0.01%.
6. **Class FSM metamodel + Trade transition table** are product-frozen (§10): no tip VM; shared rules for event encoding widths, replay domain `CoNET-DLE-TipFSM-v1`, nonce, timestamp source, USDC-6, oracle round binding, `tipStateRoot` Merkle paths, and error codes; Trade states `None/Open/Locked/SettleReady/Settled/Closed` with events `TradeOpened…Expired` (§10.2). Asset / Storage tables are **form-frozen skeletons** (§10.3–§10.4). Open items: exact SSZ vs RLP container choice, DepositBundle byte layout, Asset/Storage full precondition rows, fee-split leaf updates, storage challenge / sales↔asset timing constants—**not** whether Mode A may skip deterministic replay.
7. Matcher / order-index discovery for open trade tips (off-tip index vs dedicated index role)—must not bypass atomic ≤100 USDC or L1 ownership rules (§4.7). **`settleTrade` AC verification** is product-frozen (§4.7): EIP-712 SettleReady fields, L1 `archiveMembershipRoot` checkpoint, stale-roster rejection, tip Settled only after L1 success. Open items: Settlement / MembershipCheckpoint **addresses**, payment-token allowlist, caller policy (anyone vs bonded relayer), and the exact **gas-efficient** AC checkpoint / aggregate format (vs raw multi-ECDSA on every settle).
8. Delivery-miner authorization set size, first-completer **challenge / heartbeat** before retention payout, signed-URL TTL, multi-recipient vs per-miner index ciphertext, and optional blinded-purchase privacy (§4.8 / CopyrightContentModule thesis).
9. Open **Web of Trust** scoring formulas for auction UIs (which identity graphs, decay, anti-sybil)—DLE freezes **signed history**, not a single global WoT oracle (§4.9).
10. Archive cross-check policy for storage `SaleBooked` ↔ asset-tip finality (timing windows, multi-asset fragment proceeds) (§4.10)—asset tip “final” means **AC present**.
11. `listenKind` string for DLE vs mining vs chat; session AEAD = AES-256-GCM only for new clients.
12. Canonical block encoding (RLP vs deterministic JSON) and single hash function choice for `blockHash` / AC fields.
13. Cross-version migration of archive state, selection logs, and AC checkpoints.
14. Clear separation between **historical Avalanche-subnet era mainchain sketches** and **later CoNET L1 / DePIN deployments**—DLE cluster logic remains the same thesis either way.
15. Wallet-layer **ERC-5564 CoNET profile** details (announcement contract / registry, default *n*, view-tag parameters, recover/scan UX) and how clients advertise the **stealth meta-address** (AddressPGP / off-tip QR)—must stay **off** tip/archive/validator-committee paths; do **not** leave BIP-47 / BIP-352 as alternate CoNET L1 runtimes (§4.5).
16. Hierarchical **key vault** parameters (batch size for spend derivation, hardware/threshold policy, recovery-map encryption, per-shard derivation domain IDs, default per-device hourly merge/withdraw caps) and UX for **key-domain / recovery-domain** isolation—client product only; not tip/archive/validator consensus (§4.5, §12.9).
17. **Verifiable DA + force exit** are product-frozen in form (§5.2.1, §4.6): Reed–Solomon-class coding **\((n,k)=(10,6)\)**, AC fields `daRoot` / `erasureCodingVersion` / `chunkCount` / `recoveryThreshold` / `chunkAssignmentRoot` / `tipStateRoot`, pre-sign hold-≥\(k\) duty, **UnavailableChallenge** open/response game, **`forceWithdraw(assetNftId, lastAC, accountStateProof, nullifier)`** against **L1 AssetVault**, tip nullifier / Exited marking, dispute window \(T_{\mathrm{exit}}\). Open items: numeric \(T_{\mathrm{daOpen}}\) / \(T_{\mathrm{daResponse}}\) / \(T_{\mathrm{exit}}\) / \(T_{\mathrm{archive}}\), bond sizes, chunk byte size, Merkle vs KZG open encoding, and AssetVault token allowlist—**not** whether signing alone counts as DA.

---

## 16. Conclusion

CoNET-DLE proposes **decentralization clusters** that maintain **many parallel, event-based atomic chains**: **no event ⇒ no block**; on each event the hosting **archive shard** (selected by \(i=H(\mathrm{nftContract}\|\mathrm{tokenId}\|R_e)\bmod S_e\), \(S_e \in \{2,4,8,\ldots\}\)—**not** grindable `tokenId mod S`) draws **\(N_V=7\)** on-demand validators + **\(S_{\mathrm{sb}}=2\)** standbys from its waiting queue, they form a **\(Q_V=5/7\)** attestation (proposal layer, §6.5), and that shard **finalizes only** with an **Archive Certificate (= CommitQC)** under a HotStuff-style two-phase quorum protocol—not a single archive node and not a one-shot signature race (§5.2.1). As archive participants grow, the archive plane **fissions** \(2 \to 4 \to 8 \to \cdots\) via epoch **MigrationCertificate** handoffs for cluster-like load balance and higher **aggregate** bandwidth, provided each shard keeps \(N_A \ge 4\) (§5.2). **L1 NFT** birth certificates force a ternary **asset / storage / trade** class. Asset chains deposit oracle-valued L1 collateral capped at **≤ 100 USDC**, **revalue on every event**, and if balance **> 100 USDC** require **new chain(s)** for outbound excess (§4.6); each transfer pays **0.01%** in **USDC**, split **50% hosting archive / 50% \(Q_V\) validators**—acknowledging that **0.01% alone** cannot fund the full security stack (§13). Storage chains charge by **content in conet-GB** and may host **creator content** under the same **CopyrightContentModule** thesis: fragmented ciphertext, private index to authorized miners, **conet-GB**-priced access, **first-completer** buyer-PGP delivery, short-lived URLs, and tip/L1 hashes only (§4.8). Under **Copyright ZERO**, storage tips form a **version tree** of original and modified editions—each node an independently tradeable L1 NFT—while **signed likes, comments, and citations** accumulate as a **Web of Trust** evidence base for auction valuation (§4.9). Each storage tip also keeps a **sales-revenue journal** that **links** to parallel **asset-class** tip transactions where value actually moves (§4.10). **Trade-class** tips are **L2 order / state coordinators** for listings ≤ **100 USDC**; **cross-layer atomic delivery** (pay + move **subject L1 NFT**) runs only in CoNET **L1 Settlement Contract** `settleTrade`; the trade tip then **closes**, while the subject ledger continues (§4.7). Micro-fragmentation **caps direct book loss per asset tip** at ≤100 USDC—it does **not** make collusion motive tend to zero; capture **frequency** still needs \(P_{\mathrm{prop}}\) / \(P_{\mathrm{year}}\), and concurrent multi-tip cash risk needs \(E_C\le E_{\max}\) (§12.2–§12.3.2). Role-split, on-demand participants lower the barrier that concentrates today’s networks. Tips are **class-fixed event state machines** with **no tip VM** and a **normative FSM metamodel** (Trade table frozen; Asset/Storage skeletons—§10); application workflows compose tips and L1 at the **application layer**. The paper’s answer to the **blockchain trilemma** is **not** that it is eliminated: CoNET-DLE **redefines the operating boundary**—many isolated, value-bounded, event-driven tips; aggregate throughput can scale with archive shards; security stays **conditional** on shard honesty, committee sampling, L1 settlement, DA, and client key isolation (§3.4). As an L2 **loaded on CoNET DePIN**, it inherits **wallet-address (non-IP) gossip** with OpenPGP end-to-end encryption and zero-trust entry/mailbox hops. **Natural privacy** is dual: that **communication** plane plus **asset** privacy that **raises on-chain clustering cost** and breaks **one-address = whole portfolio**—**not** strong anonymity (§4.5). Transfers keep the same dual stack. Multi-address receipt uses CoNET’s **canonical ERC-5564** wallet profile (meta-address, ephemeral key, view tag, announcement, scan/spend keys); BIP-47 / BIP-352 are **design references only**—**not** a DLE tip/archive/validator-committee address oracle (§4.5). Custody security rises only under **key-domain + recovery-domain isolation** (hierarchical vault SHOULD)—address fragmentation alone is not enough (§4.5, §7.6, §12.9). Stake and NFT security anchor on the CoNET mainchain registry. Production roulette binds to **L1 beacon finalized randomness + frozen `poolRoot_e`** so draws are publicly recomputeable and free of selective-omission / last-publisher bias from optional archive VRF; commit–reveal remains MVP-only (§7.8). Cryptography stays within mature primitives (§7) so the design is implementable without exotic proving systems.

---

## References

1. Original CoNET-DLE design note — Peter Xie, 2023 (this document lineage).
2. CoNET ecosystem commentary covering CoNET-SI, CoNETCash, and CoNET-DLE — Cointime / 0x237, *“CoNET：从基础设施层面出发，能否解决加密隐私问题？”* (2023).
3. **RFC 9580** — OpenPGP (obsoletes RFC 4880 / 6637); X25519 encryption profiles.
4. **EIP-191** — Signed Data Standard (`personal_sign`, gossip / validator proposal votes); **EIP-712** — typed structured data (**required** for AC / SettleReady / MembershipCheckpoint).
5. **NIST SP 800-38D** — AES-GCM; **RFC 5869** — HKDF; **FIPS 180-4** — SHA-256; Ethereum **Keccak-256**.
6. CoNET L1 **beacon / CL finalized randomness** (RANDAO-class) — **normative production** roulette entropy with frozen `poolRoot_e` (§7.8.1); IETF **ECVRF** reserved for optional post-\(R_e\) tickets (§7.8.2) and phase-2 threshold-VRF candidates (§15).
7. Solana — Proof of History as verifiable delay / local sequencing prior art; CoNET-DLE uses PoH only as a **local** clock—**canonical** event order is archive quorum certificates (§7.9).
8. Hardin, G. — *The Tragedy of the Commons* (incentive misalignment cited in §7.11 / §8.4).
9. CoNET Project — Layer Minus / DePIN / AddressPGP mailbox routing (wallet-address gossip, A/B/C zero-trust hops).
10. **BIP-47** — Reusable Payment Codes (design **reference** only for CoNET L1; not the canonical EVM runtime).
11. **BIP-352** — Silent Payments for Bitcoin UTXO/Taproot (design **reference** only; **not** an EVM drop-in; requires recipient block scan).
12. **ERC-5564** / **ERC-6538** — **CoNET L1 / EVM canonical** stealth addresses and stealth meta-address registry (wallet-layer freeze in §4.5).

---

## Appendix A — Glossary

| Term | Meaning |
| --- | --- |
| **CoNET-DLE** | Distributed Ledger Expansion; this cluster multi-chain L2 layer. |
| **Terminology hierarchy** | CoNET L1 → tip/atomic chain → (micro-ledger = tip history) → event FSM → block height → archive shard → validator committee (§4.0). |
| **Tip / atomic chain** | One L1-NFT-bound parallel ledger; default meaning of “chain” in DLE prose (§4.0). |
| **Micro-ledger** | Informal synonym for tip event history—not a separate product layer (§4.0). |
| **CoNET DePIN** | Wallet-address P2P substrate; L2 gossip transport (not IP identity). |
| **Entry A / Mailbox B / Entry C** | Send ingress / ciphertext mailbox / listen ingress; A,C ≠ B. |
| **AddressPGP** | On-chain registry binding EOA → user PGP + route key. |
| **Maintenance group** | Per block: **\(N_V=7\)** on-demand validators + **\(S_{\mathrm{sb}}=2\)** standbys; deposit needs **\(Q_V=5\)** (§6.5). |
| **\(N_V\) / \(Q_V\)** | Drawn committee size **7** / accept quorum **5** (product freeze §6.5). |
| **Standby \(S_{\mathrm{sb}}\)** | **2** ordered reserves promoted before full dissolve (§6.5). |
| **\(P_{\mathrm{prop}}\) / \(P_{\mathrm{year}}\)** | Proposal capture \(\Pr[\mathrm{Bin}(7,p)\ge 5]\); annual ≥1 capture \(1-(1-P_{\mathrm{prop}})^{M}\) (§12.3.1). |
| **\(E_C\) / \(E_{\max}\)** | Per-epoch committee cumulative exposure \(\sum_j V_j\le E_{\max}\); blocks one committee from underwriting unbounded micro-tips (§12.3.2). |
| **100 USDC per-tip ceiling** | Caps **direct** oracle loss on one asset tip; does **not** zero collusion motive or replace \(P_{\mathrm{year}}\) / archive BFT / \(E_{\max}\) (§12.2). |
| **On-demand miner waiting queue** | Queue of lightweight miners ready for single-block draw (§8.1). |
| **Archive node** | Full-state quality checker and waiting-pool host; one BFT member of a shard. |
| **Archive-plane fission** | L2 archive shards grow \(S_e=2,4,8,\ldots\); route by \(H(\mathrm{contract}\|\mathrm{tokenId}\|R_e)\bmod S_e\); remapping via **MigrationCertificate** (§5.2). |
| **Placement salt \(R_e\)** | Public epoch salt from **L1 beacon finalized randomness** for archive placement hash (§5.2.0, §7.8). |
| **L1BeaconFinalizedRandomness** | CoNET CL finalized random beacon field (RANDAO or equivalent) bound into production \(R_e\); **not** execution `block.hash` (§7.8.1). |
| **MigrationCertificate (MC)** | Dual-shard CommitQC-style certificate for \(S_e\to S_{e+1}\) tip handoff; binds membership roots; forbids silent remapping (§5.2.2). |
| **\(N_A\) / \(Q_A\) / \(f\)** | Active archive count \(N_A\); \(f=\lfloor(N_A-1)/3\rfloor\); \(Q_A=\lfloor 2N_A/3\rfloor+1\) (§5.2.1). |
| **membershipRoot / membershipEpoch** | Commitment to active archive set + roster version; required on Proposal/QC/AC (§5.2.1). |
| **PreparedQC** | ≥ \(Q_A\) prepare votes over an ArchiveProposal (§5.2.1). |
| **CommitQC / Archive Certificate (AC)** | Sole tip-finality object: CommitQC (≥ \(Q_A\) **EIP-712** commit votes) over tip + `daRoot` + DA fields + `tipStateRoot` + membership + prepareQCRef (§5.2.1). |
| **lockedQC / justifyQC** | Local lock and proposal justification for HotStuff-style unlock-by-higher-round (§5.2.1). |
| **TimeoutQC (TC)** | ≥ \(Q_A\) timeout/nil votes after \(T_{\mathrm{archiveRound}}\) to advance round (§5.2.1). |
| **RejectCommitQC** | Two-phase reject path with same lock rules; prevents unilateral archive censor (§5.2.1). |
| **Mode A (archive verification)** | Every AC-signing archive **independently replays** the fixed FSM; forbids CommitQC from \(Q_V\) signatures alone (§6.3). |
| **Mode B (out of v1)** | Archive trusts committee + fraud proofs / sampling; not product-frozen (§6.3, §15). |
| **RequestPool** | Per-shard queue of tip state-change requests; empty ⇒ no block (§6.3). |
| **SelectionLog** | \(Q_A\)-attested roulette seats (`committee[7]`+`standby[2]`); coordinator cannot privately edit (§6.3, §7.8). |
| **ArchiveIngressPool** | Validator DepositBundles awaiting Mode A replay; proposal layer only (§6.3). |
| **ArbitrationPool** | Failed / incomplete deposits → §6.5 reselect or RejectCommitQC; not a second finality track (§6.3). |
| **Archive coordinator** | Deterministic per-round proposer/assembler; **no** sticky leader / unilateral finality (§5.2.1, §6.3). |
| **ArchiveCensorshipChallenge** | Bonded L1 escape hatch: `NO_PROGRESS` after \(T_{\mathrm{archive}}\), or escalate after failed DA / UnavailableChallenge (§5.2.1). |
| **UnavailableChallenge** | L1 game: AC exists but chunks missing; accused members must open assigned shares or be slashed; < \(k\) opens → freeze height (§5.2.1). |
| **\((n,k)=(10,6)\)** | v1 erasure coding: 10 chunks, any 6 reconstruct; AC binds `chunkCount` / `recoveryThreshold` (§5.2.1). |
| **L1 AssetVault** | Holds asset-class ingress collateral per `assetNftId`; tip balances are claims; unlock via ordinary path or `forceWithdraw` (§4.6, §5.2.1). |
| **forceWithdraw** | L1 call unlocking vault funds with last good AC + `accountStateProof` + `nullifier`; prevents tip double-spend after exit (§5.2.1). |
| **Natural privacy** | Dual: DePIN **comms** privacy + **asset** privacy that **raises clustering cost** and breaks one-address portfolio equivalence—**not** strong anonymity (§4.5, §7.6). |
| **Stealth meta-address (ERC-5564)** | Payee’s public receive code on CoNET L1/EVM; sender derives *n* stealth EOAs (client layer) (§4.5). |
| **Forward-predict *n* wallets** | Sender client derives *n* receive addresses via the **ERC-5564** CoNET profile; pays ≤100 USDC atomic quotas each (§4.5). |
| **Address oracle (forbidden on DLE)** | Tip/archive/validator committee must **not** generate or assign receive addresses; stealth stays wallet-layer (§4.5). |
| **Clustering residual channels** | Shared L1 deposit, mint timing, amounts, gas/fee payer, oracle/device timing, simultaneous spend, re-aggregation (§4.5, §12.8). |
| **Address fragmentation** | Many EOAs / tips; raises clustering cost; **not** by itself custody isolation (§4.5). |
| **Key-domain isolation** | Spend material not co-located; distinct derivation / hardware / threshold domains (§4.5, §12.9). |
| **Recovery-domain isolation** | Encrypted recovery map; separate recovery secrets; no single weak PIN unlocks all spend keys (§4.5, §12.9). |
| **Hierarchical key vault** | Online scan key; batched spend; hardware/threshold high-value; encrypted recovery map; per-shard domains; hourly merge/withdraw caps (§4.5). |
| **Fragment custody** | Conditional multi-key safety under key-domain + recovery-domain isolation—not address count alone (§4.5, §12.9). |
| **Witness** | Chain-local full participant storing chain data. |
| **Validator** | Lightweight consensus participant. |
| **Verifiable roulette** | Publicly recomputeable committee draw: production \(R_e\) from L1 beacon finalized randomness + epoch + `shardId` + frozen `poolRoot_e`; commit–reveal MVP-only (§7.8). |
| **Selective-omission bias** | Optional archive VRF concatenation where missing outputs are dropped; a late party chooses publish vs withhold to pick among aggregates—rejected for v1 \(R_e\) (§7.8.1). |
| **Last-revealer bias** | Commit–reveal abort channel: last party sees others’ reveals then reveals or withholds; slash raises cost, does not remove bias (§7.8.3). |
| **Selection chain** | Log of agreed draws before tip genesis / block assembly; entries are canonical only with **≥ \(Q_A\)** attestation. |
| **No tip VM** | Product freeze: tips are class-fixed event FSMs; no general-purpose or user-deployed tip programs; compose at app layer + L1 (§10). |
| **Class event FSM** | Deterministic class-fixed transition function (§10 metamodel + tables); Mode A archives replay it; no tip bytecode (§6.3, §10). |
| **tipStateRoot** | Keccak Merkle root of tip FSM leaves after an accepted event; bound into SettleReady / DA ACs (§4.7, §5.2.1, §10.1). |
| **Proof of History (PoH)** | Verifiable **local** sequencing clock / anti-rollback aid (\(h_{t+1}=\mathrm{SHA256}(h_t)\)); **not** shared cross-archive order (§7.9). |
| **Canonical event order** | Determined by **archive quorum certificates** (AC / selection-log / `poolRoot_e`), not by any single PoH chain (§7.9). |
| **Asset-class chain** | Transferable ledger; L1 deposit ≤ **100 USDC** (oracle); revalue on each event; over-cap outbound → new chain (§4.6); **0.01%** fee in **USDC** (**50% archive / 50% validators**—§13). |
| **Spillover new chain** | When revalued asset balance **> 100 USDC**, outbound / excess must mint new asset tip(s) (§4.6). |
| **Storage-class chain** | Data/state / creator-content ledger; retention fees + optional **GB-priced access** (§4.8); Copyright ZERO tree node (§4.9); sales books (§4.10). |
| **Content access purchase** | Pay **conet-GB** for buyer-bound encrypted delivery; does not transfer storage NFT ownership (§4.8). |
| **Private index handoff** | Assembly index sealed to authorized miner PGP on IPFS; tip stores only `contentIndexHash` (§4.8). |
| **CopyrightContentModule thesis** | Same private-copyright delivery state machine on Beamio catalog / UserCard module; DLE tips are the native parallel-ledger surface (§4.8). |
| **First-completer** | First valid authorized miner to post `buyerEncryptedContentHash` locks delivery for that `purchaseId` (§4.8). |
| **storagePaidUntil** | Retention / serve deadline paid to delivery miners; unpaid → stop access URLs (§4.8). |
| **Buyer-bound index** | Assembly index / package decryptable only with the buyer’s PGP after miner re-encryption (§4.8). |
| **Copyright ZERO tree** | Lineage of storage NFTs: root creator + modifier forks; each node independently listable (§4.9). |
| **Web of Trust (WoT) signal** | Signed social/citation history weighted by signer identity for auction discovery—not a consensus price (§4.9). |
| **Sales-revenue journal** | Append-only storage-tip books for access / NFT / royalty sales; links `assetNftId`/`assetTxId` (§4.10). |
| **Parallel asset-class tx** | Value-rail tip event referenced by a storage sale row; still ≤ **100 USDC** revalued (§4.6, §4.10). |
| **Trade-class chain** | Short-lived **L2 listing / match coordinator** tip; binds subject asset/storage NFT; quote ≤ **100 USDC**; tip reaches **SettleReady**; **atomic** pay + NFT transfer only via CoNET **L1 Settlement Contract** `settleTrade`; then tip **close** (§4.7). |
| **L1 Settlement Contract** | CoNET L1 contract that executes `settleTrade` in **one** L1 transaction: verify DLE archive certificate + quote/nonce/deadline/buyer, transfer escrowed payment, transfer `subjectNftId`, mark `tradeId` settled, prevent re-exec. The only place cross-layer trade atomicity is realized (§4.7). |
| **SettleReady** | Trade-tip status after matched freeze + buyer intent are AC-archived; signals readiness for L1 `settleTrade`—**not** yet L1 ownership transfer (§4.7). |
| **Subject NFT** | The asset or storage L1 NFT being sold via a trade tip; ownership authority is L1 `ownerOf`. |
| **conet-GB** | **Storage-class** fee currency (content / access / retention): CoNET L1 `GBToken` ERC-20. Asset/trade tip-event fees are **USDC** (§13). |
| **Blockchain trilemma** | Classical trade-off among decentralization, security, and scalability; CoNET-DLE **redefines the operating boundary** and does **not** claim to eliminate it (§3.4). |
| **EIP-191 vote** | secp256k1 signature over canonical block/task digest. |

## Appendix B — End-to-End Sequence (New Asset Chain)

```text
User → mint unique CoNET L1 NFT (class = asset)
     → deposit L1 assets; L1 oracle valuation ≤ 100 USDC
     → host shard i = H(nftContract‖tokenId‖R_e) mod S_e  (S_e ∈ {2,4,8,…}; §5.2)
     → request pool on that archive cluster (NFT id + deposit proof)
     → that cluster’s archive draws N_V=7 + S_sb=2 from its on-demand waiting queue
     → 5 vote + submit genesis / first tip
     → PrepareQC → CommitQC / Archive Certificate (QA) → archive if qualified
     → (later) each new event → oracle revalue balance (§4.6)
     → if balance > 100 USDC → mint new chain(s) for outbound excess
     → same shard draws new 7+2 → Q_V=5/7 vote → archive (cap-compliant tip only)
     → transfer fee 0.01% in USDC: 50% archive shard / 50% to that block’s ≥5 accept validators (§13)
     → no event ⇒ no block; fail ⇒ standbys / dissolve + reselect (≤ R_max) (§6.5)
```

## Appendix C — End-to-End Sequence (New Storage Chain)

```text
User → mint unique CoNET L1 NFT (class = storage)
     → (optional creator content) fragment + encrypt content;
       encrypt assembly index to authorized miner PGPs;
       upload fragments/index to IPFS; set access price in conet-GB (§4.8)
     → host shard i = H(nftContract‖tokenId‖R_e) mod S_e  (S_e ∈ {2,4,8,…}; §5.2)
     → request pool on that archive cluster (NFT id + contentIndexHash)
     → that cluster draws 7+2 → Q_V=5/7 → archive
     → write / retain events → content-based fees in conet-GB
     → unpaid ⇒ halt new blocks; no event ⇒ no block
```

## Appendix D — End-to-End Sequence (Trade-Class Atomic Sale)

```text
Seller owns subject chain C (asset or storage L1 NFT #S)
     → mint unique CoNET L1 NFT (class = trade), bind subjectNftId = #S
     → set atomic quote ≤ 100 USDC (oracle); reject large orders
     → host shard i = H(nftContract‖tradeTokenId‖R_e) mod S_e
     → L1 freeze / escrow subject NFT while Open/Locked (§4.7)
     → archive draws 7+2 → Q_V=5/7 → open listing tip archived
     → buyer locks / authorizes payment in L1 settlement escrow
     → tip match → SettleReady event → Archive Certificate (AC)
     → caller: L1 Settlement.settleTrade(tradeId, #S, buyer, paymentProof, AC)
           → verify AC + quote/nonce/deadline/buyer
           → transfer payment to seller AND subject NFT → buyer (one L1 tx)
           → mark tradeId settled (no re-exec)
     → tip records Settled (L1 tx hash) → Closed; archive keeps proof
     → subject chain C continues under new owner
     → cancel/expire before L1 settle → tip Closed + L1 unfreeze #S
     → tip alone cannot undo an L1-finalized transfer (must not happen)
```

## Appendix E — End-to-End Sequence (Storage Content Access Purchase)

```text
Owner (client-local) → build assembly index + encrypt fragments
     → OpenPGP-encrypt index to authorized miner PGP keys (multi-recipient)
     → upload index ciphertext + fragments to IPFS → contentIndexHash
     → tip Configured (= CopyrightContentConfigured): ONLY hash + authorizedNodeKeyHash[] + GB price
       (plaintext index NEVER on tip / never in validator-committee votes) (§4.8)
Visitor → pay owner-set conet-GB + bind buyer PGP (sig binds buyerPgpKeyHash)
     → archive draws 7+2 → Q_V=5/7 → CopyrightPurchaseOpened archived (Purchased)
Authorized miner → listen purchase → confirm nodeKeyHash in authorized set
     → fetch index ciphertext by contentIndexHash → decrypt with miner PGP (off-tip)
     → fetch fragments → reassemble plaintext off-tip
     → re-encrypt package under buyer PGP → upload to IPFS
     → first-completer → CopyrightDeliveryCompleted + buyerEncryptedContentHash
Owner / tip → periodic CopyrightStorageFeeCharged → storagePaidUntil
Buyer → short-lived signed URL (checks expiry) → decrypt with buyer PGP
     → restore via buyer-bound index
     → accessExpiresAt or unpaid storagePaidUntil → stop serving; new pay to reopen
Note: does NOT transfer storage L1 NFT ownership (contrast Appendix D)
      Beamio CopyrightContentModuleV1 uses the same state machine on catalog paths
```

## Appendix F — End-to-End Sequence (Copyright ZERO Fork + Social + Auction Signal)

```text
Root storage NFT #R (creator tip) already live
Modifier → mint storage NFT #B with parentNftId=#R, new contentIndexHash (§4.9)
     → archive draws 7+2 → Q_V=5/7 → fork genesis archived
Visitor V (high-trust wallet) → like + comment on #B (EIP-191 / AddressPGP)
     → tip records signed social events (immutable history)
Indexer / auction UI → WoT-weight V’s signals higher than sybil wallets
Seller → open trade-class tip listing subjectNftId=#B (≤100 USDC atomic)
Buyer → settle → L1 ownerOf(#B)=buyer; #R unchanged; #B tip continues
Market still shows #B’s tree position + social/WoT histogram for discovery
```

## Appendix G — End-to-End Sequence (Storage Sale Books ↔ Asset Tip)

```text
Storage tip #S (creator content) listed / access priced
Buyer pays on parallel asset-class tip #A (≤100 USDC rail) → asset event TxA finalized
     → (and/or) pays conet-GB for access on #S
Storage tip #S → SaleBooked row: saleKind, amount, parties, assetNftId=#A, assetTxId=TxA
Archive / indexer cross-check: TxA exists & matches → books accepted
Optional: trade settle of #S ownership → another journal row + trade tip id + payment asset tip(s)
Fork child #B sale may emit royalty row on #S linking #B’s asset TxB (§4.9–§4.10)
```
