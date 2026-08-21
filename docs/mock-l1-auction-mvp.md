# Mock-L1 auction MVP (local only)

**Status:** laboratory / `mockL1Only`. Not CoNET mainnet (224422) wiring. Not production CL RANDAO or DePIN gossip.

CoNET mainnet may already host `DLEChainRegistry1155V1`; this MVP still uses **local Hardhat/Anvil fixtures only**. Do not treat lab `POST /newchain/request` (`notL1Nft`) as L1 proof.

## Goals

1. Mint a real local ERC-1155 1/1 chain NFT (`ASSET` / `STORAGE` / `TRADE`) via `DLEChainRegistry1155V1` + archive binding.
2. Register that NFT through `MockL1ChainRegistrationV1` → L2 genesis (parallel to lab newchain).
3. Trade EventIngress: sell (ERC-721) / buy (ERC-20) orders → scanner `MatchCandidate` → Archive legality → freeze-then-draw committee → `TradeMatchCertificateV1`.
4. Mode A monotonic states after `TradeOpened`: MatchProposed → MatchCertified → SettlementSubmitted → Settled | SettlementFailed.
5. Mock L1 escrow atomically swaps NFT ↔ ERC-20; fee = 1 bps of clearing price, 50% scanner / 50% committee.

## Non-goals

- WaitingPool / `POST /ondemand/hook` as trade mempool
- Elevating lab hashed `chainNftId` to L1
- Claiming production beacon or DePIN
- Wiring mainnet registry addresses into MVP paths

## Components

| Layer | Path |
| --- | --- |
| Settlement mock | `src/dle/mocks/MockDleAuctionSettlement.sol` |
| Fixture | `test/dle/fixtures.ts` → `deployAuctionFixture` |
| Local deploy script | `scripts/dle/deployMockL1AuctionLocal.ts` (`npm run dle:deploy:mock-auction-local`) |
| Registration wire | `runtime/src/shared/mockL1.ts` |
| Custody (Archive) | `runtime/src/shared/mockL1Custody.ts` (`MOCK_L1_RPC_URL` + `MOCK_L1_SETTLEMENT`) |
| On-chain settle | `runtime/src/shared/mockL1Settle.ts` (`MOCK_L1_AUTHORITY_PRIVATE_KEY` + `MOCK_L1_SETTLE_ONCHAIN` / `executeOnChain`) |
| Orders / cert wire | `runtime/src/shared/tradeMatch.ts` |
| HTTP engines | `runtime/src/archive/mockL1/engine.ts`, `…/trade/engine.ts` |
| Mode A | `runtime/src/archive/bft/modeA.ts` → `replayTradeMatchModeA` |
| CLI / demo / e2e | `runtime/src/daemon/mock-l1-auction-cli.ts`, `mock-l1-auction-demo.ts`, `mock-l1-auction-e2e.ts` |
| One-shot local | Root `scripts/dle/mockAuctionE2eLocal.sh` → `npm run dle:mock-auction-e2e` |
| Web | Explorer `/mock-auction` (session keys may sign; Round 5 list + Round 4 settle CTA → Archive) |

## MVP round 2 (2026-08)

1. Archive `POST /trade/check` verifies NFT `ownerOf` + `getApproved`/`isApprovedForAll` and ERC-20 `balanceOf` + `allowance` against the mock settlement when RPC env is set (client custody flags ignored).
2. `npm run mock-auction-demo` runs submit→scan→candidate→check→attest→settle in-process (**lab / optional custody**; settle may use a demo txHash when on-chain settle is off).
3. Explorer can sign sell/buy with memory-only session keys (no disk persistence).
4. Root `dle:deploy:mock-auction-local` prints `MOCK_L1_*` for Archive.

## MVP round 3 (2026-08)

1. Seller `list`s NFT into `MockDleAuctionSettlement` escrow before Archive settle.
2. Archive `POST /trade/settle` with `executeOnChain` / env → `certificateAuthority` calls `settle` on local RPC; phases `match_certified` → `settlement_submitted` → `settled` | `settlement_failed`.
3. `npm run mock-auction-e2e` (DLE) or root `npm run dle:mock-auction-e2e` (hardhat node → deploy → e2e) produces a **real** `settlementTxHash`.
4. `/health` may expose `tradeOnChainSettleConfigured` / `tradeOnChainSettleMode`.

## MVP round 4 (2026-08)

1. Explorer **Settlement summary**: phase pills + `HashCapsule` for `settlementTxHash` from `/trade/timeline`.
2. Explorer **Archive settle** button: `POST /trade/settle` with `outcome: settled` + optional `executeOnChain` (default on). Authority private key **never** enters the browser.
3. Health pills: `custody:` / `settle:` from trusted `/health` fields.

## MVP round 5 (2026-08)

1. Archive **`POST /trade/list`**: body `{ candidateHash, sellerPrivateKey }` (lab session key; **not** stored on Archive). Key must match sell order `maker`; calls `MockDleAuctionSettlement.list` via `listMockL1Auction` or `submitL1ListTx` hook.
2. Match record may expose `listTxHash` / `listError`; WAL type `trade-list`.
3. `/health`: `tradeListConfigured` / `tradeListMode` (`rpc` | `hook` | off).
4. Explorer **List NFT escrow** CTA (uses seller session key) → then **Archive settle**. Settlement summary shows `listTxHash` capsules.

## MVP round 6 (2026-08)

1. Archive **`POST /trade/approve`**: body `{ candidateHash, buyerPrivateKey, amount? }` (lab session key; **not** stored). Key must match buy order `maker`; default `amount` = candidate `clearingPrice`. Calls ERC-20 `approve(settlement, amount)` via `approveMockL1AuctionQuote` or `submitL1ApproveTx` hook (idempotent when `allowance >= amount`).
2. Match record may expose `approveTxHash` / `approveError`; WAL type `trade-approve`.
3. `/health`: `tradeApproveConfigured` / `tradeApproveMode` (`rpc` | `hook` | off).
4. Explorer **Approve quote** CTA (buyer session key) after list; Settlement summary shows `approveTxHash`.
5. E2E / demo prefer Archive `/trade/list` + `/trade/approve` after attest, before settle.

## MVP round 7 (2026-08)

1. **`preflightMockL1AuctionSettle`** (`shared/mockL1Settle.ts`): eth_call gate — listing exists / not settled / not expired / clearing ≥ ask / buyer allowance ≥ clearing.
2. Archive **`POST /trade/settle`** (unless `skipSettlePreflight: true`): require match record `listTxHash` + `approveTxHash` before `executeOnChain`; when RPC + settlement configured, also run on-chain preflight. Preflight failure → **400**, phase stays `match_certified` (do **not** mark `settlement_failed`).
3. CLI: `list` / `approve` commands; settle flags `--executeOnChain` / `--skipSettlePreflight`.
4. Explorer one-shot **List → Approve → Settle** (individual CTAs retained).

## MVP round 8 (2026-08)

1. Archive **`POST /trade/preflight`**: **read-only** settle readiness. Shared gate `evaluateSettlePreflight` (phase, `listTxHash`, `approveTxHash`, optional RPC `preflightMockL1AuctionSettle`). Returns `checks`, `fees` (1 bps split), optional `onChain`. **Never** mutates match phase.
2. Settle path reuses the same evaluator (no duplicated list/approve/RPC checks).
3. CLI: `preflight --candidateHash 0x…`.
4. Explorer **Preflight** CTA + Settlement summary fee line (`feeAmount` / scanner / committee); settle / one-shot errors may prefix `Preflight:`.

## MVP round 9 (2026-08)

1. **`MockDleAuctionSettlement.unlist(sellerOrderHash)`**: seller-only reclaim when listing exists and not settled; emits `Unlisted`; deletes listing and returns NFT.
2. Shared helper **`unlistMockL1Auction`** (`shared/mockL1Settle.ts`); Archive hook `submitL1UnlistTx`.
3. Archive **`POST /trade/unlist`**: body `{ candidateHash, sellerPrivateKey }` (lab session key; **not** stored). Requires `listTxHash`; phase `match_certified` **or** `settlement_failed`. On success: set `unlistTxHash`, **clear `listTxHash`**, clear list errors; **do not** change phase. WAL `trade-unlist`.
4. Lab recovery: `POST /trade/settle` with `outcome: 'failed'` → `settlement_failed` + `settlementError` (then unlist to reclaim escrow).
5. CLI: `unlist --candidateHash 0x… --pk HEX`.
6. Explorer: **Unlist escrow** / **Mark failed** / **Cancel sell order** CTAs; Settlement summary shows `unlistTxHash` / `unlistError` / `settlementError`; health pill `unlist:`.
7. `/health`: `tradeUnlistConfigured` / `tradeUnlistMode` (`rpc` | `hook`).

## Fee

```
feeAmount = clearingPrice / 10_000
scannerReward = feeAmount / 2
committeeReward = feeAmount - scannerReward
```

Canonical policy hash: `mockL1FeePolicyHash()` (`dle.mockL1.fee.v1|1bps|scanner50|committee50`).

## Related

- Wire contract: [mock-l1-auction-wire.md](./mock-l1-auction-wire.md)
- RULES: `runtime/RULES.md` (Archive mock-L1 / trade table), `runtime/src/daemon/RULES.md`, `explorer/RULES.md`
- Canvas snapshot: `src/canvas/dle-mock-l1-auction-mvp-2026-08.md`
