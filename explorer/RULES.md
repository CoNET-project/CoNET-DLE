# DLE Explorer programming rules

Read-only SPA for the isolated CoNET-DLE lab. Not Blockscout. Not a tip VM browser.

Public host: `https://dle.conet.network` (authorized). Do not invent extra `dle.*` hostnames.

After any Explorer programming or display-spec change, **update this file in the same task** (`conet-dle-write-back-subproject.mdc`).

## Home metrics (2026-08-15)

The first metric row is:

| Slot | Label | Value | Notes |
|---|---|---|---|
| 1 | Chain ID | `0x44c45` | **CoNET-DLE Testnet** EIP-155 `eth_chainId`. Hint = `CoNET-DLE Testnet`. **No** “Decimal 281,669. Not CoNET L1 224422.” Under the value: **Group ID** capsule = bootstrap L1 `registerTxHash` `0x3076a806…6f2ad0`. Click opens CoNET L1 Blockscout `/tx/{hash}` via `openExternalUrl`. Not `tip.hash`. |
| 2 | **Clusters** | `liveGroupCount` | Live archive groups \(G_e\). Genesis is **1**. |
| 3 | Archives | roster length · 5+2 | Node count, not cluster fission. |
| 4 | Archive Certificate | Available / Empty | Tip finality object. |

**Removed:** Home `Tip height` MetricCard. Archive Certificate height on NFT 42 is written to `0x1` after AC and does not grow. Showing it as a dashboard number is misleading.

**Kept:** the **Tip hash** capsule under the metric row (DLE `/hash/` lookup), not a height panel. That capsule is **not** the Chain ID L1 register tx.

### Chain ID + Group ID capsule

- **Value in the card:** CoNET-DLE Testnet EIP-155 hex (`0x44c45`). Hint: `CoNET-DLE Testnet`.
- **Capsule under it:** label **Group ID**; value = L1 bootstrap group register tx (`BOOTSTRAP_GROUP_REGISTER_TX_HASH` in `config/l1Routing.ts`), copied from the CoNET deploy snapshot. Do **not** `../..` import `deployments/`.
- **Click:** `https://mainnet.conet.network/tx/{hash}` through this subproject’s `openExternalUrl`. Copy writes the full 32-byte hash.
- **Not** lab decimal `281669`, **not** CoNET L1 chain id `224422` as hint text, **not** L1 storage uint `1`, **not** `dle_tip.hash` / AC `valueHash`.

### Clusters semantics

- **Clusters = \(G_e\)** = distinct live `groupId`s on the lab route table (including the genesis group).
- **No fission ⇒ 1.** Creating asset / storage / trade lab chains copies NFT 42’s Group ID (bootstrap register tx hash) and **must not** increment this number.
- A later fission that introduces a **new** Group ID (that group’s own L1 register tx hash) increments \(G_e\) by 1.

Trusted fields (Explorer must not `../..` import runtime):

```text
GET /health          → liveGroupCount, liveGroupIds
GET /api/v2/dle      → same at top level and under archive
```

Parse only a trusted integer `>= 1`. Missing field, timeout, or non-2xx: keep last trusted value or default **1**. Never treat failure as `0` or empty.

**Legacy `/health` (unupgraded archives):** `parseLiveGroupIds` / `parseClusterCount` must run `canonicalGroupId` on each id **before** unique-count. `[dle.lab.group.v1]` and `[dle.lab.group.v1, 0x3076…]` are **one** cluster. Prefer unique canonical `liveGroupIds` over a raw `liveGroupCount` that double-counted aliases. `parseWaitingPool` / `parseSelectionLog` canonicalize `groupId`. `parseArchiveInfo` defaults missing `chainName` to `CoNET-DLE Testnet`. Copy `canonicalGroupId` / `sameGroupId` in `explorer/src/protocol.ts` — do **not** `../..` import runtime.

Home hint copy (English):

- `clusterCount <= 1` → `Genesis cluster — no fission yet`
- else → `N live archive groups after fission`

Implementation: `HomePage.tsx` MetricCard `Clusters`; `useArchiveFeed.ts` + `parseClusterCount` / `parseLiveGroupIds`; default `GENESIS_CLUSTER_COUNT = 1`.

## Other Explorer invariants

- No top navigation bar. Main pages: title capsule. Detail: circular back button. Tabs in the footer.
- Refresh: `setTimeout` chain only. No `setInterval`.
- Failed fetches keep the last trusted snapshot (`beamio-trusted-vs-untrusted-fetch.mdc`).
- User-visible strings: English.
- Independent `package.json`. Do not import `runtime`, `archive-a`, or `archive-b`.
- Cache only archive URL + last trusted snapshot. No wallet keys.

## Related

- Archive API: `../runtime/RULES.md` §Archive (`liveGroupCount`)
- Client: `../runtime/src/daemon/RULES.md`
- On-demand (not Clusters): `../runtime/src/shared/ondemand/RULES.md`
