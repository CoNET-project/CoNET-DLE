# Decentralization Cluster Multi-Chain

## Parallel Atomic Distributed Ledger Expansion (CoNET-DLE)

**Author:** Peter Xie  
**First draft:** 2023  
**Revision:** 2026-08-11ab (product freeze: no tip VM—class-fixed event FSMs; app-layer composition — §10)

**Paired translation (must stay in sync):** [`Decentralization Cluster multi-chain.zh-CN.md`](./Decentralization%20Cluster%20multi-chain.zh-CN.md)  
**Sync rule:** `.cursor/rules/conet-layer2-whitepaper-bilingual-sync.mdc`

---

## Abstract

**CoNET Distributed Ledger Expansion (CoNET-DLE)** is a clustered, lightweight **Layer-2-style ledger-expansion** system: **many parallel, event-based atomic chains** (architecture target: capacity grows with staking / archive shards, not with one shared tip), each block **proposed** by a **validator committee** drawn by the hosting **archive shard** (\(N_V=7\) drawn, **\(Q_V=5/7\)** signatures), then **finalized only** by that shard’s **Archive Certificate** (\(N_A=3f+1\), \(Q_A=2f+1\))—not by a single global tip or a single archive node.

- **Parallelism:** concurrent chains scale with staking and archive-plane fission; more capacity → more maintainable tips—not a claim of unbounded free speed.
- **Atomic (per chain):** tip advance requires a **\(Q_V=5/7\)** validator attestation, then an **Archive Certificate** from the hosting shard (§6.5, §5.2.1).
- **Event-only blocks:** **no event ⇒ no block.** Empty-slot mining is forbidden.
- **L1 birth certificate:** creating a new chain **must** mint a **unique NFT** on CoNET L1; that NFT binds class (**asset**, **storage**, or **trade**), ownership, and **which archive cluster** hosts it via \(H(\mathrm{nftContract}\|\mathrm{tokenId}\|R_e)\bmod S_e\) (§5.2).
- **Asset cap stays live:** each asset event **revalues** the tip; if balance **> 100 USDC**, outbound / excess **requires new chain(s)** (§4.6).
- **Trade-class (atomic NFT-style sale):** users open a **trade** tip as an **L2 order / state coordinator** to list an existing **asset** or **storage** chain (quote ≤ **100 USDC**-equivalent; **no large orders**). **Final atomic delivery** (pay seller **and** move subject L1 NFT ownership) runs in one CoNET **L1 Settlement Contract** call; the trade tip then **closes** (§4.7).
- **Storage-class creator economy / private copyright delivery:** same thesis as Beamio **`CopyrightContentModule`**: owner fragments + seals a private assembly index to authorized DePIN miners; tip/L1 holds only hashes; buyers pay **conet-GB**, bind buyer PGP; **first-completer** miners deliver buyer-bound ciphertext; short-lived access URLs + periodic storage fees; plaintext never on-chain (§4.8).
- **Copyright ZERO / version tree:** storage tips form a **lineage tree** (original + modifiers); each branch point is an **independent L1 NFT** listable via trade-class; the tip stores **social history** (likes, comments, citations) as a **Web of Trust** signal for auction valuation (§4.9).
- **Storage sales ledger:** each storage tip keeps an append-only **sales-revenue journal** and **references** the parallel **asset-class** tip txs that actually move value (§4.10).
- **Archive-plane fission + BFT finality:** as archive participants grow, the L2 archive plane **fissions** into **2 → 4 → 8 → …** parallel clusters; host shard is **`H(nftContract∥tokenId∥R_e) mod S_e`** (not grindable `tokenId mod S`), with epoch **MigrationCertificate** handoffs (§5.2); each shard finalizes tips only with **\(Q_A=2f+1\)** signatures among **\(N_A=3f+1\)** members (§5.2.1).
- **Fees (dual denomination):** **storage-class** fees scale with **content** and settle in **conet-GB**; **asset-class / trade-class** event fees are **USDC**-denominated (**0.01%** of transferred / listed value). Of each **0.01%** event fee: **50% → hosting archive shard**, **50% → \(Q_V\) accepting validators** (§13).

**Transport premise:** CoNET-DLE is loaded on **CoNET DePIN**. Control and data-plane gossip use **wallet addresses (EOA) as network identity**, not IP addresses. Messages are end-to-end encrypted (OpenPGP) and relayed through entry/mailbox nodes that **cannot read plaintext**.

**Natural privacy (product freeze):** privacy is **dual**—**communication privacy** (DePIN wallet-address gossip + OpenPGP) **and asset privacy**. Multi-address micro-fragmentation **raises on-chain clustering cost** and breaks the direct map **one address = whole portfolio**; it does **not** claim strong anonymity or that observers always fail (§4.5). On receive/transfer, CoNET freezes a **single canonical** wallet profile based on **ERC-5564** (stealth meta-address, ephemeral public key, view tag, announcement event, scan/spend keys, batch derivation, recover/scan)—**not** interchangeable BIP-47 / BIP-352 runtimes. BIP-47 / BIP-352 are **design references** only; BIP-352 is Bitcoin UTXO/Taproot-native and is **not** a CoNET L1/EVM drop-in. Stealth stays in the **wallet / client**; DLE tips / archive / validator committee do **not** run an address oracle (§4.5, §7.6).

**Custody security (qualified):** address fragmentation **alone** does **not** make custody safer. “No single private key controls the whole portfolio” holds only when fragment keys are under **independent key-domain and recovery-domain isolation**. If every fragment derives from one mnemonic, one device, one client DB, or one weak recovery password, seizing that seed or recombination database still takes **all** value. Product wallets SHOULD use a **hierarchical key vault** (online scan key; batched spend keys; hardware/threshold for high-value fragments; encrypted recovery map; per-shard derivation domains; per-device hourly merge/withdraw caps—§4.5, §12.9). **Higher recipient anonymity** is likewise a **client product** problem of *how* wallets use L2—not something DLE tip/archive/validator infrastructure can solve.

CoNET-DLE keeps blockchain-grade **immutability** while targeting continuous availability, flexible participation, and event-driven latency. Stake-based, group-local consensus removes the need for global PoW races. **As more miners join, more chains can be underwritten concurrently**; aggregate throughput can rise with independent archive shards—**not** “more miners ⇒ every tip gets monotonically faster.”

**Thesis on the blockchain trilemma (frozen):** CoNET-DLE **does not eliminate** the blockchain trilemma. It **changes its operating boundary** by replacing a shared global execution tip with many **operationally isolated**, **value-bounded (asset tips ≤ 100 USDC)**, event-driven state machines. Aggregate throughput **can** scale with independent archive shards, while security remains **conditional** on shard honesty, committee sampling, L1 settlement, data availability, and client-side key isolation (see §3.4).

This document is a design whitepaper for the **Decentralization Cluster / multi-chain** layer. Cryptography in §7 is restricted to **mature, production-proven primitives** (secp256k1 / EIP-191, OpenPGP, AES-GCM, SHA-256/Keccak-256, **ECVRF** for production roulette, commit–reveal as **MVP-only**). It is complementary to CoNET DePIN / CoNET-SI and a CoNET **mainchain / registry**—not a replacement for a global PoS L1.

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
- **Atomic (per chain):** within one chain, a new block requires full agreement of the selected **small** maintenance group (issuer / creator, witnesses, validators as defined by that chain’s contract).
- **Bounded blast radius:** compromise or crisis on one chain does not halt unrelated chains; **asset** tips further bound **direct** cash blast (≤ 100 USDC).
- **Miner-scale growth:** each additional honest miner expands how many chains the network can underwrite **at the same time**; larger roulette pools can **lower** attacker share \(p\)—capture risk still needs \(P_{\mathrm{prop}}\) / \(P_{\mathrm{year}}\) (§12.3.1).

### 3.2 Event-based block production

If there is no event (transaction / state-change / storage write request), **no new block** is produced. **No event ⇒ no block.** This forbids empty-block overhead and matches payment / receipt / storage workflows. Effective **transactions-per-second bandwidth** is the sum of active event streams across parallel tips—not the throughput of one global slot clock.

### 3.3 Clustered maintenance groups (\(N_V=7\), \(Q_V=5/7\) per block)

A chain is not secured by “the entire network voting every slot,” but by a **two-layer** path: a **small, randomly drawn validator committee** for the **current block proposal**, then **archive-shard BFT** that issues an **Archive Certificate**—the only object that makes the tip final (§5.2.1, §6.5).

**Security root (product freeze):** the validator committee is the **proposal layer** (\(N_V=7\) drawn, deposit needs **\(Q_V=5\)** of **7** signatures); it does **not** alone constitute finality. Finality requires an **Archive Certificate** with **\(Q_A = 2f+1\)** distinct archive signatures from a shard of size **\(N_A = 3f+1\)**. No single archive node may accept, reject, roll back, or archive a tip unilaterally. **v1 does not use \(Q_V=5/5\)**—full-committee unanimity is rejected because one offline / timed-out / malicious signer can stall every round (§6.5).

**Canonical per-block path (product freeze):**

1. A **new event** appears on the chain (**no event ⇒ no block**).
2. The hosting **archive shard** (round coordinator + peers) draws **\(N_V=7\)** validators plus **\(S_{\mathrm{sb}}=2\)** standbys from the **on-demand miner waiting queue**.
3. The committee **votes**; on **≥ \(Q_V=5\)** accept signatures within \(T_{\mathrm{vote}}\), it **submits** the block / attestation set.
4. Archive members quality-check the deposit; if **qualified**, they collect **≥ \(Q_A\)** signatures into an **Archive Certificate** and **archive**; else reject / reselect under the same quorum rules (§6.3, §9).

Dishonest or timed-out members are replaced under §6.5 liveness rules; stake is at risk for equivocation / unjustified refuse. Many such committees run **in parallel** across chains, so confirmation latency is a **tiny committee** quorum plus a **small-shard** archive quorum—not a planet-wide slot.

### 3.4 Redefining the trilemma’s operating boundary (not eliminating it)

Classical blockchain design is often framed as an **impossible triangle**: at most two of **decentralization**, **security**, and **scalability**.

**Product freeze (canonical claim):**

> CoNET-DLE **does not eliminate** the blockchain trilemma. It **changes its operating boundary** by replacing a shared global execution tip with many **operationally isolated**, **value-bounded** (asset tips ≤ **100 USDC**), **event-driven** state machines. Aggregate throughput **can** scale with independent archive shards, while security remains **conditional** on shard honesty, committee sampling, L1 settlement, data availability, and client-side key isolation.

| Trilemma corner | Classical single-tip pain | CoNET-DLE response (conditional) |
| --- | --- | --- |
| **Scalability** | One tip’s TPS / gas market saturates | **Event-based** blocks + **small-group parallel consensus** across many tips + **archive-plane fission** (2/4/8…, §5.2) → **aggregate** bandwidth can grow with active ledgers and shards; **per-tip** latency still bounded by \(T_{\mathrm{vote}}\), reselections, and archive quorum—not “more miners ⇒ always faster” |
| **Security** | Scaling often weakens economic finality or trusts sequencers | Remains **conditional**: archive shard \(N_A=3f+1\) / \(Q_A=2f+1\); committee \(Q_V=5/7\) + \(P_{\mathrm{prop}}\) / \(P_{\mathrm{year}}\) (§12.3.1); \(E_C\le E_{\max}\) (§12.3.2); L1 settle / NFT; DA; asset-tip **direct** blast ≤**100 USDC** (not “collusion motive → 0”); client key-domain isolation (§4.5, §12.9) |
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

1. Verify the **DLE Archive Certificate** (tip identity, `daRoot` / settle payload hash, ≥ \(Q_A\) archive signatures—§5.2.1).
2. Verify **quote**, **nonce**, **deadline**, and **buyer** against the AC-committed listing / match fields (and oracle ≤ **100 USDC** at listing time).
3. Transfer **escrowed payment** to the seller (or release seller’s claim atomically with step 4).
4. Transfer **`subjectNftId`** to `buyer` (from seller / freeze escrow that held the NFT).
5. Mark **`tradeId` settled** (or burned / closed on the L1 trade NFT registry).
6. **Reject re-execution** of the same `tradeId` / settle nonce (idempotent fail).

If any check fails, the **entire L1 call reverts**—no partial NFT move, no partial payment release.

**DLE tip workflow (coordinator):**

1. **Subject:** an existing **asset-class** or **storage-class** chain identified by its **L1 NFT** (`subjectNftId`). The seller must be the current L1 owner of that subject.
2. **Open listing:** the seller **mints a trade-class** L1 NFT / DLE tip whose genesis binds `subjectNftId`, quote currency/amount (**oracle-valued ≤ 100 USDC-equivalent**), escrow / payment asset rules, and a settle **deadline**. **Atomic orders only—no large orders**.
3. **Listing freeze:** while the trade tip is **Open** / **Locked**, the subject NFT is **frozen against ordinary transfer** on L1 (registry / settlement escrow), and asset-class subjects reject outbound drains that would empty the tip before settle. Freeze is an L1 lock coordinated by the tip—not tip-only soft state.
4. **Match → SettleReady:** buyer locks / authorizes payment (typically into the **L1 settlement escrow** or an allowance the settle call can pull). The tip records match fields and archives a **`SettleReady`** event under normal \(Q_V\) + **AC** rules. That AC is the `dleArchiveCertificate` input to `settleTrade`.
5. **L1 settle (atomic delivery):** any permitted caller submits `settleTrade(...)`. **Only after** the L1 tx succeeds is canonical ownership **buyer = L1 `ownerOf(subjectNftId)`** and payment finalized. The tip then records **Settled** (with L1 tx hash) and **closes**. The **subject asset/storage tip continues** under the new owner (it is **not** closed).
6. **Failure / cancel / expire before L1 settle:** tip may **Cancelled** / **Expired → Closed** and signal L1 **unfreeze**; no claim that tip rollback undoes an already-final L1 transfer (there must not have been one). After a successful L1 settle, tip state **must** follow L1—never invent a tip-only “un-settle.”
7. **What is sold:** the **subject** NFT / ledger—not the trade-order shell. Transferring the trade NFT itself is not the product path for buying the listed chain.
8. **Portfolio sale:** selling many ≤100 USDC fragments requires **many** trade listings (one subject tip each), consistent with micro-fragmentation and the per-tip loss ceiling (§4.1, §4.5, §12.2).

**Lifecycle (trade tip):** `Open → Locked → Matched → SettleReady → Settled → Closed` (or `Cancelled` / `Expired → Closed` without L1 settle). **Settled** is defined by **L1 settlement success**, not by tip vote alone.

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
- **Security source:** stake + random **small-group** selection + **archive-shard BFT** (Archive Certificate, \(N_A=3f+1\), \(Q_A=2f+1\), §5.2.1) + **L1 NFT** binding; asset chains additionally inherit the **≤ 100 USDC** economic bound; trade listings inherit the **≤ 100 USDC** quote bound with **atomic delivery only via L1 `settleTrade`** (§4.7); storage content delivery relies on **PGP fragmentation + buyer re-encryption** so public tip observers never receive plaintext (§4.8); social valuation relies on **signed WoT history**, not forgeable counters (§4.9); revenue claims require **linkable AC-finalized asset-class events** (§4.10).
- **Fee denomination (frozen):** **storage-class** content / access / retention fees → **conet-GB**; **asset-class / trade-class** tip event fees → **USDC** at **0.01%**, split **50% hosting archive / 50% \(Q_V\) validators** (§13). Asset-class tips remain the parallel **value rails** under the oracle ≤100 USDC cap.

### 4.4 Role map

```mermaid
flowchart TB
  subgraph ArchiveCluster["Archive node cluster"]
    A1[Archive nodes]
    PoH[PoH local clocks]
    Pool[Participant waiting pool]
  end

  subgraph ChainGroup["Per-chain maintenance group"]
    I[Issuer / Creator]
    W[Witnesses]
    V[Validators]
  end

  User[User / Owner] -->|tx or ledger request| Pool
  Pool --> Roulette[Verifiable roulette]
  Roulette --> ChainGroup
  I --> W
  I --> V
  W -->|signed block| ArchiveCluster
  V -->|signed block| ArchiveCluster
  A1 -->|accept / reject / rollback| ChainGroup
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
- Participate in **per-shard BFT**: quality-check deposited blocks; **propose** accept or reject; **sign** Archive Certificates or reject certificates when the shard reaches **\(Q_A\)** (§5.2.1).
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
| \(R_e\) | Public **placement salt** for epoch \(e\): derived from a **CoNET L1 finalized** entropy source in the same family as roulette (§7.8)—e.g. `H("dle.place" ‖ L1FinalizedBlockHash_e ‖ e)`—published **before** epoch \(e\) admits new placement decisions |

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

The waiting pool, roulette draw, quality check, accept/reject, rollback, and archival **run on the hosting archive shard**—but the **security root is not a single archive operator**. Each shard is a classical partially synchronous BFT committee. Without a quorum certificate, no tip is final.

| Symbol | Definition |
| --- | --- |
| \(f\) | Byzantine archive-member bound for that shard (\(f \ge 1\)) |
| \(N_A\) | Active archive members of the shard; **must** satisfy \(N_A = 3f+1\) |
| \(Q_A\) | Finality quorum; **must** satisfy \(Q_A = 2f+1\) |
| **Product floor** | \(N_A \ge 4\) (hence \(f \ge 1\)). A shard below this floor **must not** issue new Archive Certificates (read-only / migrate only). |

**Two layers:**

| Layer | Role | Quorum |
| --- | --- | --- |
| **Validator committee** | Propose tip block; deposit needs **\(Q_V=5\)** of **\(N_V=7\)** | **\(Q_V = 5/7\)** (§6.5) |
| **Archive shard** | **Sole finality layer** — quality check + archival | **\(Q_A = 2f+1\)** of \(N_A = 3f+1\) |

Any archive member may **propose** accept or reject. **No** member may archive, reject-with-finality, or roll back a tip **without** a certificate carrying **≥ \(Q_A\)** distinct archive signatures. “Simple majority alone,” “unanimous archive set,” and “\(Q_V=5/5\) validator unanimity” are **not** the product rule.

**Archive Certificate (AC)** — the only tip-finality object:

```text
AC = {
  chainNftId, height, blockHash,
  selectionLogRef, daRoot, round, archiveShardId
} + ≥ QA distinct archive EIP-191 / secp256k1 signatures
```

Signing an AC asserts: (1) the committee deposited a valid **\(Q_V=5/7\)** attestation set; (2) quality invariants hold (§4.6–§4.10, §6.3); (3) the signer can serve the block body (or its erasure share) under `daRoot`.

**No sticky leader.** Each **quorum-certified** selection-log / epoch round deterministically orders archive NFT ids in the shard and picks a **coordinator** that may assemble roulette evidence and aggregate AC signatures. Local PoH ticks may label proposals, but **coordinator eligibility and canonical round identity** come from the **\(Q_A\)-attested** selection log (or AC fields)—not from any single node’s PoH chain. The coordinator has **no** unilateral veto or finality power. Any member may broadcast an equivalent AC candidate; the first valid set that reaches \(Q_A\) wins.

**Conflicting tips / dual certificates.** Under the honest-\(f\) assumption, quorum intersection implies **at most one** valid AC per `(chainNftId, height)`. If two conflicting ACs appear (equivocation):

1. Double-signing archive members are **slashed** and removed from the shard roster.
2. Fork choice is resolved on **CoNET L1** via a dispute / checkpoint contract: exactly one surviving tip; tips **without** an AC **never** count toward spendable balances.

**Network partition (safety over liveness).** Only a connected component that holds **≥ \(Q_A\)** may issue an AC. A minority partition **cannot** finalize. If both sides have **< \(Q_A\)**, the tip **stalls** (liveness pause)—it does **not** fork into two finals. Clients ignore single-node RPC claims without a verifiable AC.

**Reject / rollback certificates.** Dissolving a deposited tip and forcing reselection requires a **reject certificate** (or equivalent) with **≥ \(Q_A\)** signatures—so one archive cannot censor by unilateral “reject.”

**Archive censorship / forced exit (L1 escape hatch).** After timeout \(T_{\mathrm{archive}}\) with no new AC for a live chain, the chain owner (or a challenger holding the latest **\(Q_V\)-valid** validator attestation plus witness DA proof) may post a bonded **`ArchiveCensorshipChallenge`** on CoNET L1. On success: suspend that shard’s custody of the chain, allow **deterministic re-home** under published rules, and/or L1-arbitrated finalize/close. Malicious challenges lose the bond.

**Data availability & asset recovery.**

- Every AC **must** include `daRoot`. Shard members keep **\(Q_A\)-recoverable** redundancy of block bodies; **witnesses** keep chain-local full copies.
- **Economic truth:** only tip states covered by an AC are spendable. Uncertified events are not final.
- If an AC exists but bodies are missing: restore via witnesses / erasure shares. If restore fails: L1 challenge freezes that height and recovers proven assets from the **previous AC state root**. **L1 NFT ownership** always remains on CoNET L1 `ownerOf`.

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
  migrateDeadline
} + ≥ Q_A signatures from fromShard  +  ≥ Q_A signatures from toShard
```

| Phase | Rule |
| --- | --- |
| **Announce** | Governance / automated threshold emits fission intent: new \(S_{e+1}\), \(R_{e+1}\), and migration window \([t_0,t_1]\). Clients compute new \(i'\) for every NFT. |
| **Freeze / drain** | Tips scheduled to leave a shard: reject **new** block deposits that would race the handoff (or allow only “migrate-safe” closes). In-flight validator rounds must finish under the **old** shard or abort with reject certificate before handoff. Incomplete **trade** tips stay on the tip’s current host until Settled/Cancelled/Expired under §4.7, then migrate; L1 `settleTrade` remains L1-authoritative. |
| **Dual-serve window** | Until MC is finalized for that edge, **old shard** remains authoritative for AC finality of pre-migration heights; **new shard** may warm-copy history and attest readiness. Clients **SHOULD** query both; conflict → prefer old-shard AC until MC. |
| **Data duty** | Old shard **must** provide tip bodies / DA shares referenced by `historyCommit`. Withholding → same family as **`ArchiveCensorshipChallenge`** / slash (§5.2.1)—migration does not excuse hiding history. |
| **MC finalize** | When both shards reach \(Q_A\) on the same MC payload (and optional L1 checkpoint of `MC.hash`), epoch \(e+1\) placement becomes sole authority for those tips. Old shard stops issuing new ACs for migrated tips. |
| **Post-migrate** | New shard alone draws validators and issues ACs. Tip `archiveShardId` in subsequent ACs must match \(i'\) under \((S_{e+1},R_{e+1})\). |

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
- Tip **proposal** acceptance requires **≥ \(Q_V=5\)** accept signatures out of those **7** (**\(Q_V=5/7\)**). Tip **finality** requires an **Archive Certificate** with **≥ \(Q_A = 2f+1\)** archive signatures from a shard of size **\(N_A = 3f+1\)** (§5.2.1)—not a single archive node’s accept/reject.
- **Rejected product rule:** \(Q_V=5/5\) (unanimous five). It maximizes safety against a single honest veto of an illegal block, but **any** offline / timeout / attack / malicious refuse stalls the round; griefers can re-enter the waiting pool and refuse forever unless §6.5 bounds apply.
- If proposal quorum or archive quorum check fails (timeout, refuse-to-sign, conflicting signatures, reject certificate): apply **standby promotion → dissolve → cooldown → reselect** under §6.5, then archive reject/rollback under §9 when applicable.

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
10. Archive shard **verifies** and, if qualified, issues an **Archive Certificate** (\(Q_A=2f+1\)) and **archives** finalized genesis (§5.2.1).

### 6.3 New block flow (canonical)

1. A **new event** is committed on the chain. **If there is no event, no block is produced.**
2. **Asset-class only — revalue:** run **L1 oracle** revaluation of chain balance / transfer (§4.6). If revalued balance **> 100 USDC**, require **spillover new chain(s)** for the outbound / excess portion before this tip may accept the transfer; otherwise reject.
3. **Trade-class only — listing invariants:** reject events that raise the quote above **100 USDC**, unfreeze the subject NFT without cancel/expire/L1 settle, mark **Settled** without a verified L1 `settleTrade` tx, or claim tip-only “atomic rollback” of L1 state (§4.7). After **Closed**, refuse all new blocks.
4. **Storage-class only — content access:** purchase events require **conet-GB** payment + **buyer PGP** binding; delivery-complete events require a valid authorized-miner first-completer proof (`buyerEncryptedContentHash`). Reject events that would put plaintext content into tip state (§4.8).
5. **Storage-class only — social / fork:** like / comment / citation events require a valid signer binding (EIP-191 / AddressPGP); fork genesis must reference an existing `parentNftId`. Reject unsigned “celebrity” attributions (§4.9).
6. **Storage-class only — sales books:** `SaleBooked` / revenue journal events that claim value movement MUST include `assetNftId` + `assetTxId` (or an explicit GB-only access sale with no asset rail); reject unlinked inflate-the-books rows (§4.10).
7. Hosting **archive shard** detects / accepts the (cap-compliant) event and runs verifiable roulette over the **on-demand miner waiting queue** (coordinator assembles evidence; peers attest — §5.2.1, §7.8).
8. Archive shard **draws \(N_V=7\) validators + \(S_{\mathrm{sb}}=2\) standbys** for **this chain’s current block** (§6.5).
9. Candidate block is assembled from typed events against the class transition table (optional issuer among staking miners or committee assembler)—**no tip VM** (§10).
10. **Fee collection (dual denomination — §13):**
   - **Asset-class transfer:** **0.01%** of transferred value in **USDC**; of that fee **50% → hosting archive shard** (among AC signers), **50% → \(Q_V\) accepting validators** (equal among ≥5 accept signers on the archived tip).
   - **Storage-class write / retention / access purchase / social:** **content-based** fees in **conet-GB** (not the USDC 0.01% rail); unpaid retention → refuse new blocks; access price paid to owner (delivery miners may take a configured share).
   - **Trade-class listing / settle:** listing / settle hooks charge **USDC** on the quote / settle notional under the same **0.01% → 50/50 archive/validators** split where applicable; unpaid listing fees may halt further trade events.
11. The committee **votes**; on **≥ \(Q_V=5\)** accept signatures within \(T_{\mathrm{vote}}\), it **submits** the attestation / signed block to the archive path (**proposal layer only**).
12. **Archive members verify** the vote set (≥ \(Q_V\)), block quality, `daRoot`, (asset-class) **≤ 100 USDC** post-revaluation invariant, (trade-class) **SettleReady** / close rules and **L1 `settleTrade` linkage** (no tip-only Settled), and (storage-class) purchase / delivery / social-signer / lineage / **sales↔asset-tx link** invariants (§4.8–§4.10).
13. If **qualified** and **≥ \(Q_A\)** archive signatures form an **Archive Certificate** → **archive** (finalize and store); if not → reject certificate / dissolve / reselect (§5.2.1, §6.5, §9).

### 6.4 Timeout and succession

| Fault | Recovery (product freeze — detail in §6.5) |
| --- | --- |
| **Committee member timeout / silence** | Count as **non-vote** after \(T_{\mathrm{vote}}\); if still **≥ \(Q_V\)** accepts → continue; else **promote standbys**, then dissolve / reselect. |
| **Unjustified refuse-to-sign** (online but no ballot) | **Slash** that identity’s bonded stake; apply **cooldown**; promote standbys or reselect. |
| **Network fault** (no listen heartbeat / unreachable) | **Exclude without slash** (or light availability penalty only); may still reselect if \(Q_V\) missed. |
| **Archive incomplete / failed quality check** | Issue **reject certificate** (≥ \(Q_A\)); run rollback (§9); prior committee under **cooldown**. |
| **Archive shard partition / < \(Q_A\)** | Tip **stalls**; no conflicting finality (§5.2.1). |
| **Archive censorship past \(T_{\mathrm{archive}}\)** | Bonded L1 **`ArchiveCensorshipChallenge`** → re-home / L1 arbitration (§5.2.1). |
| **Reselect griefing past \(R_{\max}\)** | Stop validator redraws for that height; escalate to archive reject / L1 challenge path (§6.5). |

### 6.5 Validator-committee quorum & liveness (product freeze)

**Problem with \(Q_V=5/5\):** requiring all five signatures means one offline, timed-out, attacked, or malicious refuse blocks the tip. “Dissolve and reselect” alone is **not** enough—an attacker can rejoin the waiting pool and refuse forever. v1 therefore freezes a **\(7\)-draw / \(5\)-of-\(7\)** proposal layer, then archive confirmation at **\(Q_A=2f+1\)**.

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
- After **\(R_{\max}=3\)** consecutive reselections without a \(Q_V\) deposit, the hosting shard **must not** continue roulette for that height: issue a **reject certificate** (if a deposit was attempted) or mark the event **stalled**, and allow owner / challenger **L1** escalation (same family as `ArchiveCensorshipChallenge`, with evidence of \(R_{\max}\) exhausted).
- Waiting-pool **re-entry** after unjustified refuse requires serving the slash + cooldown; spam join without stake is rejected at queue admission (§8).

**Security note.** \(Q_V=5/7\) is **weaker than unanimous 5/5** against “one honest veto of an illegal proposal,” but **stronger for liveness**. Safety of **finalized** tips still rests on **archive \(Q_A=2f+1\)** quality checks—validators alone never finalize.

---

## 7. Cryptography (Mature Primitives Only)

This chapter specifies the cryptographic plane of CoNET-DLE **as an L2 loaded on CoNET DePIN**. Every construction below is chosen because it is already standardized or battle-tested in production systems. Novel ZK/SNARK stacks are **out of scope** for the baseline.

### 7.1 Threat model and privacy goals

| Adversary | Assumed capability | Goal of crypto layer |
| --- | --- | --- |
| Curious entry / mailbox hop | Sees ciphertext, timing, recipient **PGP key id** | Cannot read L2 business plaintext |
| Network observer on one hop | Sees IP of that hop’s TCP peer | Cannot map that IP to the **logical** sender/receiver wallet across A≠B / C≠B paths |
| Colluding minority of a maintenance group | Holds some secp256k1 keys | Cannot forge a **\(Q_V=5/7\)** deposit without enough keys |
| Colluding ≤ \(f\) archives in a shard | Holds ≤ \(f\) archive keys | Cannot forge Archive Certificate (\(Q_A=2f+1\)) (§5.2.1) |
| Adaptive stake attacker | Buys stake, joins waiting pool | Cannot privately bias production \(R_e\) (L1 hash + ECVRF); MVP commit–reveal admits last-revealer abort bias (§7.8) |
| Offline storage attacker | Steals disk of one validator | Limited by per-task keys + no full-history requirement for validators |

**Non-goals (baseline):** perfect global traffic-analysis resistance against a world-wide passive adversary that correlates *all* entry nodes; content-hiding from parties who *must* see a block (witnesses of that chain). **Communication privacy** is **natural** from wallet-address gossip + E2E encryption (not mixnets). **Asset privacy** is **natural** from multi-wallet fragmentation that **raises clustering cost** (client-only recombination; ERC-5564 receive)—**not** strong anonymity and **not** baseline ZK (§4.5).

### 7.2 Primitive catalogue (implementation baseline)

| Layer | Primitive | Maturity anchor | Use in CoNET-DLE |
| --- | --- | --- | --- |
| Wallet identity | **secp256k1** ECDSA | Bitcoin / Ethereum | Node & user EOA |
| Auth signatures | **EIP-191** `personal_sign` | Ethereum wallets | Gossip commands, listen, task ACKs |
| Structured domain sigs (optional) | **EIP-712** | Ethereum dApps | Archive selection commits, stake ops |
| Directory | **AddressPGP** on-chain registry | CoNET production | Map EOA → user PGP + route key |
| Asymmetric message crypto | **OpenPGP** (RFC 4880 / **RFC 9580**) with **X25519** (+ Ed25519 where used) | OpenPGP ecosystem | Encrypt L2 envelopes to recipient |
| Symmetric AEAD | **AES-256-GCM** (NIST SP 800-38D) | TLS, age, modern apps | Optional bulk payload / session wrap |
| Session (listen path) | AES-256-CBC + explicit MAC *or* prefer GCM | Existing CoNET-SI listen | Long-lived listen channel key |
| Hashing | **SHA-256**, **Keccak-256** | NIST / Ethereum | Local PoH ticks, Ethereum digests, armor hashes |
| KDF | **HKDF-SHA256** (RFC 5869) | TLS 1.3, OpenPGP v6 | Derive task / fragment keys |
| Random beacon (**production**) | **ECVRF** + CoNET L1 finalized block hash | IETF ECVRF / Algorand-class VRFs | Unbiasable roulette seed \(R_e\) (§7.8.1) |
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

**Per-member vote**

```text
vote = EIP-191( "CoNET-DLE/vote/v1" || chainId || chainNFT || height || blockHash || role || eoa )
```

Collect ECDSA signatures from **all** required members (issuer, witnesses, validators). Archive verifies:

1. `ecrecover` matches the roulette-selected set.
2. Set completeness = 100% of required roles.
3. `blockHash` matches recomputed digest from deposited body (or body availability proof).

**No custom BLS threshold crypto in baseline**—threshold BLS is mature in some stacks but adds operational complexity; **explicit multi-signature collection** of secp256k1 signatures is enough and already ubiquitous.

### 7.8 Verifiable roulette cryptography

**Product freeze:** production roulette **MUST** use **CoNET L1 finalized entropy + per-archive ECVRF**. **Commit–reveal is MVP / bootstrap only**—it is **not** the production randomness claim. The informal slogan “bias-free if at least one honest reveal” is **incomplete** (see §7.8.3 last-revealer bias).

#### 7.8.1 Production: L1 finalized hash ∥ epoch ∥ archive VRF outputs

For hosting archive shard size \(N_A = 3f+1\), fixed epoch \(e\), and a **publicly agreed** CoNET L1 block that is **already finalized** (not the tip still under reorg risk):

\[
R_e \;=\; H\!\big(\mathrm{L1FinalizedBlockHash}\;\big\|\; e \;\big\|\; \mathrm{VRF}_1 \;\big\|\; \cdots \;\big\|\; \mathrm{VRF}_{N_A}\big)
\]

where \(H\) is **Keccak-256** (or SHA-256; freeze one in the ABI), concatenation is canonical length-prefixed, and each archive member \(i\) publishes

\[
\mathrm{VRF}_i \;=\; \mathsf{ECVRF}_{sk_i}(\mathrm{L1FinalizedBlockHash}\;\big\|\; e \;\big\|\; \mathrm{shardId}).
\]

**Normative steps:**

1. **Epoch binding:** \(e\) is a fixed integer schedule published in the **\(Q_A\)-attested** selection log (wall-clock / L1-height aligned). Local PoH may annotate proposals; **canonical** \(e\) is the quorum-certified value. Draws for a tip height bind to exactly one \(e\).
2. **External entropy:** `L1FinalizedBlockHash` is taken from CoNET L1 **after** finality (e.g. \(N\) confirmations / CL justified-finalized head—implementation freeze). Archives **MUST NOT** substitute an unpublished or non-final L1 hash.
3. **Per-archive ECVRF:** every active shard member outputs a VRF proof + output for the same input; peers **verify** with the member’s registered VRF pubkey. Missing / invalid VRF → that member is **non-contributing** for \(R_e\) (slash / no fee) but **does not** let a coordinator invent entropy.
4. **Canonical aggregation:** sort contributing VRF outputs by archive NFT id (or EOA) ascending; hash as above. **Any** participant with the L1 hash, epoch, shard roster, and VRF proofs can **recompute** \(R_e\) and the selected set—no trust in a single archive RPC.
5. **Waiting-pool snapshot (not unilaterally owned):** eligibility list \(\mathcal{W}_e\) is the set of on-demand miners whose **join commitments** are included in a **snapshot root** `poolRoot_e` attested by **≥ \(Q_A\)** archive signatures (or anchored to L1). A single archive **MUST NOT** privately edit the pool after \(R_e\) is bound. Snapshot cutoff is the same L1 height / epoch as the entropy input.
6. **Map to seats:** Fisher–Yates / modular indexing of \(\mathcal{W}_e\) under \(R_e\) yields the ordered **\(N_V=7\)** committee + **\(S_{\mathrm{sb}}=2\)** standbys (§6.5). Optional issuer slot uses the same \(R_e\) stream with a distinct domain tag.

**Properties:** unpredictability before L1 finality of the bound hash; **no last-revealer abort** over private \(s_i\) (VRF outputs are determined by key + public input); publicly recomputeable; pool snapshot quorum-attested.

#### 7.8.2 Production ECVRF tickets (stake-weighted optional path)

When stake-weighted tickets are desired, eligible stakers may also publish

`ticket = ECVRF_sk(R_e || roleDomain)`.

Highest / hash-ordered **valid** tickets win roles. Verification uses standard ECVRF verify. Tickets gossip over DePIN ciphertext channels. This path **complements** §7.8.1; it does **not** replace the L1-bound seed.

#### 7.8.3 MVP only: commit–reveal (and why “one honest seed” is incomplete)

For early testnets / bootstrap when L1 finality plumbing is unavailable, archives may run classic commit–reveal:

1. Each archive \(i\) samples \(s_i ← \{0,1\}^{256}\).
2. **Commit:** `C_i = keccak256(s_i || eoa_i || e || shardId)` with EIP-191 attestation.
3. After cutoff, **Reveal** \(s_i\); peers check the commitment.
4. Aggregate `R = keccak256(s_1 || … || s_n || e || chainSeed)` over **revealed** values only.
5. Map \(R\) to \(\mathcal{W}_e\) as in production.

**Last-revealer bias (mandatory caveat).** The claim “bias-resistant if at least one honest \(s_i\)” assumes all committed parties **reveal**. The **last revealer** can observe others’ reveals, recompute the would-be \(R\), and then:

- reveal their \(s_i\) if the resulting committee is favorable; or
- **withhold** the reveal (abort / force redraw) if unfavorable.

Slash / fee denial for non-reveal **raises the cost** of abort attacks but **does not remove** this cryptographic bias channel. Therefore commit–reveal is **MVP-only**, must be labeled as such in clients, and **MUST NOT** be advertised as production-unbiasable randomness. Production deployments **MUST** migrate to §7.8.1.

#### 7.8.4 Selection log

Archive shard appends `{ e, L1FinalizedBlockHash, poolRoot_e, R_e, vrfProofs[], selected[] }` (or MVP `{ e, commits, reveals, R, selected[] }`) to a **selection chain** (hash-linked SHA-256/Keccak). Entries are gossiped as L2 messages and mirrored on archive storage. Tip genesis / block assembly consumes `selected[]` only after **≥ \(Q_A\)** archive attestation signatures (same quorum as Archive Certificate — §5.2.1)—**no tip VM**. Clients **SHOULD** recompute \(R_e\) locally when verifying a draw.

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

Therefore PoH is a **local metronome / anti-rollback clock**, not “the event-order agreement among archive nodes.” **Canonical** waiting-pool order, `poolRoot_e`, selection-log entries, tip height, and archival finality exist only when the relevant object carries an **archive quorum certificate** (**≥ \(Q_A\)** signatures)—the same family as Archive Certificates and selection-log attestations (§5.2.1, §7.8.4, §8.1).

**Allowed uses of PoH:**

1. Local wall-clock substitute / rate limit for proposal pacing.
2. Binding a *proposal* to a local `(t, h_t)` so a signer cannot easily rewrite its own recent history.
3. Optional measurement aid for timeouts (\(T_{\mathrm{vote}}\), etc.)—**timeout enforcement and liveness still follow wall-clock / L1-aligned rules** unless a future ABI freezes otherwise.

**Forbidden framing:** describing PoH checkpoints, by themselves, as cross-archive consensus, shared FIFO, or the sole source of waiting-pool ranks.

### 7.10 Task keys and witness storage

| Material | Derivation | Lifetime |
| --- | --- | --- |
| Task session key | `HKDF-SHA256(master = ECDH_or_shared, info = "dle|task|"‖taskId)` | Single block task |
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
- [ ] Production roulette = \(R_e = H(\mathrm{L1FinalizedBlockHash}\,\|\,e\,\|\,\mathrm{VRF}_i)\) with ECVRF verify + \(Q_A\)-attested `poolRoot_e`; commit–reveal only for MVP (§7.8).
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
- **Snapshot for a draw:** at epoch \(e\) / bound L1 height, archives freeze \(\mathcal{W}_e\) under `poolRoot_e` attested by **≥ \(Q_A\)** members (§7.8.1). Clients and validators recompute selection from that root + \(R_e\); **no** single archive’s local wait list or local PoH chain is authoritative.

### 8.2 Anonymous participation via CoNET DePIN

- Participant nodes reach CoNET-DLE through **wallet-address gossip** on CoNET DePIN / CoNET-SI—**without using IP as identity** (§7.3–§7.6).
- Waiting-pool and task messages are OpenPGP ciphertext; entry/mailbox hops remain zero-trust.

### 8.3 Creating a validator committee (per event / block)

1. Hosting **archive shard** observes a **new event** on a chain (or genesis request).
2. Shard freezes `poolRoot_e` (≥ \(Q_A\) attestation) and computes production seed
   \(R_e = H(\mathrm{L1FinalizedBlockHash}\,\|\,e\,\|\,\mathrm{VRF}_i)\) (§7.8.1). MVP testnets may temporarily use commit–reveal (§7.8.3) with the last-revealer caveat.
3. Roulette maps \(R_e\) over \(\mathcal{W}_e\) to **\(N_V=7\) validators + \(S_{\mathrm{sb}}=2\) standbys** for that chain’s **current block** (optional: also a proposer / issuer slot if required by the contract) (§6.5), **rejecting** draws that would violate committee cumulative exposure \(E_C\le E_{\max}\) (§12.3.2). **Any** party with the public inputs can recompute the same set.
4. After **≥ \(Q_A\)** archive attestation of the draw, selection is recorded on the **selection log**.
5. The committee votes; on **≥ \(Q_V=5\)** accept signatures within \(T_{\mathrm{vote}}\) (with standby promotion if needed), it **submits**; archive shard **quality-checks** then issues an **Archive Certificate** (\(Q_A=2f+1\)) and **archives** if qualified (§6.3, §5.2.1).
6. Selected miners leave the waiting list for this task; unused standbys that were never promoted return to their prior positions; dissolved identities enter **cooldown** \(C_{\mathrm{cool}}\).

### 8.4 Tragedy of the commons (PoRep / lazy verification)

See §7.11. Split mining payout between PoS verifiers and PoRep replication nodes; false-proof sampling slashes lazy verifiers.

---

## 9. Archive Quality Check and Rollback

Any archive member may **propose** rollback when the **\(Q_V\)** validator deposit or quality checks fail; **execution** requires a **reject certificate** with **≥ \(Q_A = 2f+1\)** archive signatures (§5.2.1)—not a unilateral archive decision.

1. Collect a **reject certificate** for the unqualified tip (or fail to reach accept AC within the round).
2. Dissolve the chain’s current maintenance group (apply §6.5 cooldowns / refuse slash).
3. Reselect a fresh random group if \(R < R_{\max}\) (**prior members under cooldown**).
4. Regenerate the block under the new group; if \(R_{\max}\) exhausted, escalate (§6.5).
5. Punish cheating:

   - Cheaters may be banned from archive participation; income and stake move to an **income / reward pool**.
   - Equivocating archive members (conflicting AC signatures) are **slashed** and removed from the shard roster.
   - Unjustified validator refuse-to-sign is slashed per §6.5; network-fault silence is not.
   - Honest reporters may be rewarded per contract rules.

**Finalization:** a deposited block is final **only** when an **Archive Certificate** with **≥ \(Q_A\)** distinct signatures from the hosting shard (\(N_A = 3f+1\)) is available. Incomplete archive quorum → no finality (stall or reject + rollback). Clients and indexers **must not** treat a single archive RPC success as final.

---

## 10. No tip VM — class-fixed event state machines

**Product freeze:** Atomic tips do **not** host a general-purpose VM. Each tip is a **class-fixed event state machine** (**asset** / **storage** / **trade**). Tip validators verify typed events against the frozen transition table (§6.3); they do **not** execute user-deployed programs.

| Layer | Role |
| --- | --- |
| **DLE tip** | Fixed event schemas + AC finality for the three classes; isolation by design (no free cross-tip calls). |
| **CoNET L1 EVM** | NFT birth / ownership, oracle valuation, `settleTrade`, registry / ERC-5564—**not** tip bytecode. |
| **Application layer** | Wallets, indexers, Beamio modules, and optional L1 business contracts **compose** tips + L1 into products. |

**Why no tip VM:** asset transfer, storage/copyright delivery, and trade coordination already cover the L2 value surface; a tip VM would add execution / metering / upgrade surface without proportional product gain, and would fight tip isolation.

---

## 11. Features Summary

| Feature | Mechanism |
| --- | --- |
| Proof of Stake participation | Stake to become issuer, witness, validator; **\(N_V=7\)**, **\(Q_V=5/7\)** proposal quorum per block (§6.5). |
| Many parallel atomic chains | Concurrent tips scale with staking / archive shards; each chain is event-atomic (not “infinite free TPS”). |
| Archive draws 7 + 2 standbys | On new event: archive roulette → **7** validators + **2** standbys → **≥5** votes → **Archive Certificate** (§6.3, §6.5, §5.2.1). |
| Archive-plane fission 2/4/8… | More archive nodes → \(S_e=2^k\); route by \(H(\mathrm{contract}\|\mathrm{tokenId}\|R_e)\bmod S_e\); fission via **MigrationCertificate** (§5.2). |
| Archive-shard BFT finality | Per shard \(N_A=3f+1\), \(Q_A=2f+1\); AC is sole tip finality; no sticky leader; L1 escape hatch (§5.2.1). |
| Trilemma boundary (§3.4) | Does **not** eliminate the trilemma; many isolated, value-bounded tips; aggregate scale with archive shards; security **conditional**. |
| On-demand role participation | Role-split actors need not sync all data; join/exit consensus as capacity allows. |
| L1 NFT birth certificate | Unique CoNET L1 NFT before genesis; class = asset **or** storage **or** trade. |
| Asset cap + micro-fragmentation | Oracle ≤ **100 USDC** at mint **and** on each event; over-cap outbound → **new chain** (§4.6). |
| Trade-class atomic NFT sale | Tip = L2 coordinator; L1 `settleTrade` atomically pays + moves **subject NFT**; tip then **closes** (§4.7). |
| Storage / CopyrightContent delivery | Fragmented ciphertext; private index → authorized miner PGP; tip = hashes only; **conet-GB** access; first-completer → buyer PGP package; short-lived URLs + `storagePaidUntil` (§4.8). |
| Copyright ZERO version tree | Parent/child storage NFTs; each branch independently trade-listable; social likes/comments/citations as tip history; WoT-weighted auction signals (§4.9). |
| Storage sales ↔ asset txs | Storage tip keeps sales-revenue journal; value moves on parallel **asset-class** tips; rows link `assetNftId`/`assetTxId` (§4.10). |
| Dual fee rails (§13) | **Storage:** content / access / retention in **conet-GB**. **Asset/trade:** **0.01%** in **USDC**; of that fee **50% archive / 50% \(Q_V\) validators**. **0.01% alone** is not a full security budget. |
| No tip VM (§10) | Class-fixed event FSMs only; validators verify transition tables; app-layer composes tips + L1; **no** user-deployed tip programs. |
| Event-driven blocks | **No event ⇒ no block**; empty tips are never mined. |
| Natural privacy (dual) | Comms: DePIN + OpenPGP (§7); assets: raise clustering cost + break one-address portfolio map; **not** strong anonymity (§4.5). |
| Receive-code predict-*n* (client) | **Canonical ERC-5564** (meta-address, ephemeral key, view tag, announcement, scan/spend, batch *n*, recover/scan); BIP-47/BIP-352 = references only; **not** tip/archive/validator-committee duty (§4.5). |
| Fragment custody security | Conditional: many EOAs ≠ safer; need **key-domain + recovery-domain** isolation + hierarchical vault SHOULD (§4.5, §12.9). |
| Recipient anonymity boundary | Stronger payee unlinkability = **client product** design using L2; **not** tip/archive/validator infra (§4.5). |
| Better decentralization | Lightweight validators; on-demand participation without full storage. |
| Concurrent execution | One staker can serve many chains under different role rules. |
| Aggregate scalability | Dynamic clustering by chain; more participants / shards → more maintainable tips (conditional on DA & honesty). |
| Safe and reliable | Random distinct miners; \(5/7\) quorum + standbys + \(R_{\max}\) anti-grief; archive \(Q_A\) finality. |
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

| Attacker pool share \(p\) | \(P_{\mathrm{capture}}^{(5/5)}=p^{5}\) |
| --- | ---: |
| 10% | \(10^{-5}\) |
| 20% | \(3.2\times 10^{-4}\) |
| 33% | \(\approx 3.9\times 10^{-3}\) |
| 50% | \(3.125\times 10^{-2}\) |

**v1 product freeze (\(N_V=7\), \(Q_V=5\)).** A malicious **proposal deposit** does **not** require all seven seats—only **≥ 5** accept signatures. Under the same i.i.d. model (\(K\sim\mathrm{Binomial}(7,p)\)):

\[
P_{\mathrm{prop}}
= \Pr[K \ge 5]
= \binom{7}{5} p^{5}(1-p)^{2}
+ \binom{7}{6} p^{6}(1-p)
+ p^{7}.
\]

| Attacker pool share \(p\) | \(P_{\mathrm{prop}}=\Pr[K\ge 5]\) (approx.) |
| --- | ---: |
| 10% | \(1.765\times 10^{-4}\) |
| 20% | \(4.672\times 10^{-3}\) |
| 33% | \(\approx 4.34\times 10^{-2}\) |
| 50% | \(2.266\times 10^{-1}\) |

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

**BFT assumption (product freeze):** each shard maintains \(N_A = 3f+1\) active archives and finalizes only with \(Q_A = 2f+1\) signatures (§5.2.1). Safety holds if at most \(f\) members are Byzantine. Quorum intersection prevents two conflicting finalized tips for the same height under that bound; equivocation is slashable and resolved on L1. Partition without \(Q_A\) yields **stall**, not dual finals (safety over liveness).

**Censorship:** a single archive (or minority) cannot unilaterally reject or withhold finality forever—reject needs \(Q_A\); sustained non-progress past \(T_{\mathrm{archive}}\) unlocks bonded L1 **`ArchiveCensorshipChallenge`** and re-home. **DA:** AC-bound `daRoot` + witness / erasure redundancy; spendable balances require an AC. Cheating archive participants can be banned and have stake redirected. Long-term security still depends on the \(f\)-bound per shard and mainchain registry integrity.

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

If that entire fee were split equally among **five** accepting validators:

\[
0.01 / 5 = 0.002\ \mathrm{USDC}
\]

per validator—**before** paying: **archive nodes**, **network transport**, **oracle**, **L1 NFT mint**, **data retention**, **reselection / failed-draw costs**, and **conet-GB ↔ USDC** price volatility.

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
| **50%** | **Hosting archive shard** | Among members who form the **Archive Certificate** (\(Q_A\) signers)—equal unless governance mandates weighted shares |
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

1. Exact **thresholds** that advance archive-plane width \(S_e\) along \(2 \to 4 \to 8 \to \cdots\) (membership / load), subject to post-fission \(N_A \ge 4\) per shard. Placement is product-frozen: \(i = H(\mathrm{nftContract}\|\mathrm{tokenId}\|R_e)\bmod S_e\) with anti-grinding bonds; fission requires **MigrationCertificate** dual-shard \(Q_A\) (§5.2)—**not** \(i=\mathrm{tokenId}\bmod S\). Open items: numerical bond sizes, optional commit-to-\(R_{e+1}\) mint windows, MC L1 checkpoint ABI. Validator proposal layer is product-frozen: **\(N_V=7\)**, **\(Q_V=5/7\)**, **\(S_{\mathrm{sb}}=2\)**, \(T_{\mathrm{vote}}=30\,\mathrm{s}\), \(C_{\mathrm{cool}}\), \(R_{\max}=3\) (§6.5)—not \(5/5\). **Archive-shard BFT** is product-frozen: \(N_A=3f+1\), \(Q_A=2f+1\), Archive Certificate finality, no sticky leader, L1 escape hatch (§5.2.1)—not an open quorum question. **Committee capture math** is product-frozen in form (§12.3.1): \(P_{\mathrm{prop}}=\Pr[\mathrm{Bin}(7,p)\ge 5]\), \(P_{\mathrm{year}}=1-(1-P_{\mathrm{prop}})^{M}\); open items are measured \(M\), conservative \(p\) estimators, and joint archive correlation—not whether annual risk may be ignored. **Per-tip 100 USDC** is a **direct-loss ceiling only** (§12.2)—not “collusion motive → 0.” **Committee cumulative exposure** form is frozen: \(E_C=\sum_j V_j\le E_{\max}\) (§12.3.2); open items are numeric \(E_{\max}\), epoch vs round window, and how storage-only tips enter \(V_j\).
2. Roulette randomness is product-frozen in form (§7.8): production \(R_e = H(\mathrm{L1FinalizedBlockHash}\,\|\,e\,\|\,\mathrm{VRF}_i)\) with ECVRF + \(Q_A\)-attested `poolRoot_e`; commit–reveal **MVP-only** (last-revealer bias acknowledged). Open items: L1 finality depth \(N\), VRF pubkey registry ABI, and exact `poolRoot` Merkle encoding.
3. Exact bonded fraction \(B_{\mathrm{refuse}}\) for unjustified refuse-to-sign, optional light availability-score decay for network-fault silence, and whether \(T_{\mathrm{vote}}\) / \(T_{\mathrm{sb}}\) remain wall-clock-only or also cite local PoH measurements (§6.5)—**without** treating PoH as shared order (§7.9).
4. PoH is product-frozen as a **local** sequencing clock only; canonical order = archive QC (§7.9). Open items: SHA-256 tick rate, checkpoint publish interval, how much local PoH evidence to attach to join proposals—not whether PoH alone orders the waiting pool.
5. Slash amounts, bounty shares, ban durations, and concrete \(T_{\mathrm{archive}}\) / bond sizes for **`ArchiveCensorshipChallenge`** (fee rate **0.01%**, **50/50 archive/validators**, asset cap **100 USDC**, and dual denomination **storage=conet-GB / asset·trade=USDC** are product-frozen defaults—see §13). Open: how the archive **50%** is weighted among AC signers vs whole shard; whether tip **USDC** is native Base USDC, conet-USDC, or an oracle unit; separate L1 mint / oracle / retention fee lines beyond 0.01%.
6. **Class event schema / transition-table** freeze (encoding + validation rules—**not** a tip VM) for stake / roulette / **USDC + conet-GB** fee hooks; L1 NFT mint ABI for class + deposit; trade tip event types for **listing / match / SettleReady / close** (coordinator only—**atomic delivery is L1 `settleTrade`**, §4.7); storage event types for **contentIndexHash / purchase / first-completer delivery** (§4.8), **parent lineage / social events** (§4.9), and **sales journal + asset-tx references** (§4.10); L1 ABI for AC checkpoint / dispute / censorship challenge (§5.2.1).
7. Matcher / order-index discovery for open trade tips (off-tip index vs dedicated index role)—must not bypass atomic ≤100 USDC or L1 ownership rules (§4.7). **L1 Settlement Contract** ABI for `settleTrade` (AC verification, payment escrow asset set, freeze/unfreeze hooks, re-exec guards) is product-frozen in **semantics** (§4.7); open items are exact bytecode address, payment-token allowlist, and who may call `settleTrade` (anyone vs bonded relayer).
8. Delivery-miner authorization set size, first-completer **challenge / heartbeat** before retention payout, signed-URL TTL, multi-recipient vs per-miner index ciphertext, and optional blinded-purchase privacy (§4.8 / CopyrightContentModule thesis).
9. Open **Web of Trust** scoring formulas for auction UIs (which identity graphs, decay, anti-sybil)—DLE freezes **signed history**, not a single global WoT oracle (§4.9).
10. Archive cross-check policy for storage `SaleBooked` ↔ asset-tip finality (timing windows, multi-asset fragment proceeds) (§4.10)—asset tip “final” means **AC present**.
11. `listenKind` string for DLE vs mining vs chat; session AEAD = AES-256-GCM only for new clients.
12. Canonical block encoding (RLP vs deterministic JSON) and single hash function choice for `blockHash` / AC fields.
13. Cross-version migration of archive state, selection logs, and AC checkpoints.
14. Clear separation between **historical Avalanche-subnet era mainchain sketches** and **later CoNET L1 / DePIN deployments**—DLE cluster logic remains the same thesis either way.
15. Wallet-layer **ERC-5564 CoNET profile** details (announcement contract / registry, default *n*, view-tag parameters, recover/scan UX) and how clients advertise the **stealth meta-address** (AddressPGP / off-tip QR)—must stay **off** tip/archive/validator-committee paths; do **not** leave BIP-47 / BIP-352 as alternate CoNET L1 runtimes (§4.5).
16. Hierarchical **key vault** parameters (batch size for spend derivation, hardware/threshold policy, recovery-map encryption, per-shard derivation domain IDs, default per-device hourly merge/withdraw caps) and UX for **key-domain / recovery-domain** isolation—client product only; not tip/archive/validator consensus (§4.5, §12.9).
16. Erasure-coding parameters for archive DA shares (must remain \(Q_A\)-recoverable) and witness sync SLA (§5.2.1).

---

## 16. Conclusion

CoNET-DLE proposes **decentralization clusters** that maintain **many parallel, event-based atomic chains**: **no event ⇒ no block**; on each event the hosting **archive shard** (selected by \(i=H(\mathrm{nftContract}\|\mathrm{tokenId}\|R_e)\bmod S_e\), \(S_e \in \{2,4,8,\ldots\}\)—**not** grindable `tokenId mod S`) draws **\(N_V=7\)** on-demand validators + **\(S_{\mathrm{sb}}=2\)** standbys from its waiting queue, they form a **\(Q_V=5/7\)** attestation (proposal layer, §6.5), and that shard **finalizes only** with an **Archive Certificate** under **\(N_A=3f+1\)**, **\(Q_A=2f+1\)**—not a single archive node (§5.2.1). As archive participants grow, the archive plane **fissions** \(2 \to 4 \to 8 \to \cdots\) via epoch **MigrationCertificate** handoffs for cluster-like load balance and higher **aggregate** bandwidth, provided each shard keeps \(N_A \ge 4\) (§5.2). **L1 NFT** birth certificates force a ternary **asset / storage / trade** class. Asset chains deposit oracle-valued L1 collateral capped at **≤ 100 USDC**, **revalue on every event**, and if balance **> 100 USDC** require **new chain(s)** for outbound excess (§4.6); each transfer pays **0.01%** in **USDC**, split **50% hosting archive / 50% \(Q_V\) validators**—acknowledging that **0.01% alone** cannot fund the full security stack (§13). Storage chains charge by **content in conet-GB** and may host **creator content** under the same **CopyrightContentModule** thesis: fragmented ciphertext, private index to authorized miners, **conet-GB**-priced access, **first-completer** buyer-PGP delivery, short-lived URLs, and tip/L1 hashes only (§4.8). Under **Copyright ZERO**, storage tips form a **version tree** of original and modified editions—each node an independently tradeable L1 NFT—while **signed likes, comments, and citations** accumulate as a **Web of Trust** evidence base for auction valuation (§4.9). Each storage tip also keeps a **sales-revenue journal** that **links** to parallel **asset-class** tip transactions where value actually moves (§4.10). **Trade-class** tips are **L2 order / state coordinators** for listings ≤ **100 USDC**; **cross-layer atomic delivery** (pay + move **subject L1 NFT**) runs only in CoNET **L1 Settlement Contract** `settleTrade`; the trade tip then **closes**, while the subject ledger continues (§4.7). Micro-fragmentation **caps direct book loss per asset tip** at ≤100 USDC—it does **not** make collusion motive tend to zero; capture **frequency** still needs \(P_{\mathrm{prop}}\) / \(P_{\mathrm{year}}\), and concurrent multi-tip cash risk needs \(E_C\le E_{\max}\) (§12.2–§12.3.2). Role-split, on-demand participants lower the barrier that concentrates today’s networks. Tips are **class-fixed event state machines** with **no tip VM**; application workflows compose tips and L1 at the **application layer** (§10). The paper’s answer to the **blockchain trilemma** is **not** that it is eliminated: CoNET-DLE **redefines the operating boundary**—many isolated, value-bounded, event-driven tips; aggregate throughput can scale with archive shards; security stays **conditional** on shard honesty, committee sampling, L1 settlement, DA, and client key isolation (§3.4). As an L2 **loaded on CoNET DePIN**, it inherits **wallet-address (non-IP) gossip** with OpenPGP end-to-end encryption and zero-trust entry/mailbox hops. **Natural privacy** is dual: that **communication** plane plus **asset** privacy that **raises on-chain clustering cost** and breaks **one-address = whole portfolio**—**not** strong anonymity (§4.5). Transfers keep the same dual stack. Multi-address receipt uses CoNET’s **canonical ERC-5564** wallet profile (meta-address, ephemeral key, view tag, announcement, scan/spend keys); BIP-47 / BIP-352 are **design references only**—**not** a DLE tip/archive/validator-committee address oracle (§4.5). Custody security rises only under **key-domain + recovery-domain isolation** (hierarchical vault SHOULD)—address fragmentation alone is not enough (§4.5, §7.6, §12.9). Stake and NFT security anchor on the CoNET mainchain registry. Production roulette binds to **L1 finalized entropy + archive ECVRF** so draws are publicly recomputeable and free of last-revealer abort bias; commit–reveal remains MVP-only (§7.8). Cryptography stays within mature primitives (§7) so the design is implementable without exotic proving systems.

---

## References

1. Original CoNET-DLE design note — Peter Xie, 2023 (this document lineage).
2. CoNET ecosystem commentary covering CoNET-SI, CoNETCash, and CoNET-DLE — Cointime / 0x237, *“CoNET：从基础设施层面出发，能否解决加密隐私问题？”* (2023).
3. **RFC 9580** — OpenPGP (obsoletes RFC 4880 / 6637); X25519 encryption profiles.
4. **EIP-191** — Signed Data Standard (`personal_sign`); **EIP-712** — typed structured data (optional domain separation).
5. **NIST SP 800-38D** — AES-GCM; **RFC 5869** — HKDF; **FIPS 180-4** — SHA-256; Ethereum **Keccak-256**.
6. IETF **ECVRF** (RFC / draft lineage) and production VRF deployments — **normative production** roulette entropy with CoNET L1 finalized block hash (§7.8.1).
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
| **Placement salt \(R_e\)** | Public epoch salt from L1 finalized entropy for archive placement hash (§5.2.0, §7.8). |
| **MigrationCertificate (MC)** | Dual-shard \(Q_A\) certificate for \(S_e\to S_{e+1}\) tip handoff; forbids silent remapping (§5.2.2). |
| **\(N_A\) / \(Q_A\)** | Per-shard archive membership \(N_A=3f+1\) and finality quorum \(Q_A=2f+1\) (§5.2.1). |
| **Archive Certificate (AC)** | Sole tip-finality object: tip identity + `daRoot` + ≥ \(Q_A\) archive signatures (§5.2.1). |
| **Archive coordinator** | Deterministic per-round assembler of roulette/AC aggregation; **no** sticky leader / unilateral finality (§5.2.1). |
| **ArchiveCensorshipChallenge** | Bonded L1 escape hatch after \(T_{\mathrm{archive}}\) without progress (§5.2.1). |
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
| **Verifiable roulette** | Publicly recomputeable committee draw: production \(R_e\) from L1 finalized hash + epoch + archive ECVRF; commit–reveal MVP-only (§7.8). |
| **Last-revealer bias** | Commit–reveal abort channel: last party sees others’ reveals then reveals or withholds; slash raises cost, does not remove bias (§7.8.3). |
| **Selection chain** | Log of agreed draws before tip genesis / block assembly; entries are canonical only with **≥ \(Q_A\)** attestation. |
| **No tip VM** | Product freeze: tips are class-fixed event FSMs; no general-purpose or user-deployed tip programs; compose at app layer + L1 (§10). |
| **Class event FSM** | Frozen typed-event transition table for asset / storage / trade tips; validators verify, they do not execute bytecode (§6.3, §10). |
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
     → archive QC → Archive Certificate (QA=2f+1) → archive if qualified
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
