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
| Orders / cert wire | `runtime/src/shared/tradeMatch.ts` |
| HTTP engines | `runtime/src/archive/mockL1/engine.ts`, `…/trade/engine.ts` |
| Mode A | `runtime/src/archive/bft/modeA.ts` → `replayTradeMatchModeA` |
| CLI / demo | `runtime/src/daemon/mock-l1-auction-cli.ts`, `mock-l1-auction-demo.ts` |
| Web | Explorer `/mock-auction` (session keys may sign; Archive-side custody when RPC set) |

## MVP round 2 (2026-08)

1. Archive `POST /trade/check` verifies NFT `ownerOf` + `getApproved`/`isApprovedForAll` and ERC-20 `balanceOf` + `allowance` against the mock settlement when RPC env is set (client custody flags ignored).
2. `npm run mock-auction-demo` runs submit→scan→candidate→check→attest→settle in-process.
3. Explorer can sign sell/buy with memory-only session keys (no disk persistence).
4. Root `dle:deploy:mock-auction-local` prints `MOCK_L1_*` for Archive.

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
