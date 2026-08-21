# Mock-L1 auction wire contract

All payloads below are **`mockL1Only: true`**. HTTP JSON only; Archive validates before certificate / settlement.

## Schemas

| Schema | Role |
| --- | --- |
| `MockL1ChainRegistrationV1` | Bound local ERC-1155 registration (`assignmentStatus` must be **2** / BOUND) |
| `MockL1GenesisCertificateV1` | L2 genesis cert after accept |
| `MockL1TradeOrderV1` | Sell or buy order (EIP-191 over `orderHash`) |
| `MockL1MatchCandidateV1` | Scanner proposal (not settlement authority) |
| `TradeMatchCertificateV1` | Committee quorum cert (`notProductionBeacon`, `notProductionDepin`) |

## HTTP (archive node)

| Method | Path | Body / notes |
| --- | --- | --- |
| `POST` | `/mockl1/register` | `MockL1ChainRegistrationV1`; reject `notL1Nft: true` |
| `GET` | `/mockl1/chains` | Accepted mock-L1 genesis records |
| `GET` | `/mockl1/queue` | Queue view |
| `POST` | `/trade/submit` | Signed `MockL1TradeOrderV1` |
| `POST` | `/trade/cancel` | Cancel by order hash + maker sig |
| `POST` | `/trade/scan` | Local scan → best match (deterministic tie-break) |
| `POST` | `/trade/candidate` | Submit `MockL1MatchCandidateV1` |
| `POST` | `/trade/check` | Archive legality. With `MOCK_L1_RPC_URL` + `MOCK_L1_SETTLEMENT` (or custody hook), **eth_call / hook** — client `l1EscrowCustody` flags **ignored**. Otherwise lab flags fallback |
| `POST` | `/trade/attest` | Freeze pool → draw → collect → certificate |
| `POST` | `/trade/list` | Escrow NFT into settlement (`listTxHash`); needs `sellerPrivateKey` (session) |
| `POST` | `/trade/unlist` | Seller reclaim after list / on `settlement_failed`; clears `listTxHash`, sets `unlistTxHash` |
| `POST` | `/trade/approve` | Buyer ERC-20 approve for settlement |
| `POST` | `/trade/settle` | Mode A settlement; `outcome: 'failed'` → `settlement_failed` (lab recovery) |
| `GET` | `/trade/orders` | Order pool |
| `GET` | `/trade/matches` | Match / cert timeline |
| `GET` | `/trade/timeline` | Combined timeline |

`/health` may include `tradeRpcCustodyConfigured` / `tradeRpcCustodyMode` (`rpc` | `hook` | `clientFlags`), `tradeListConfigured` / `tradeListMode`, `tradeUnlistConfigured` / `tradeUnlistMode`, `tradeApproveConfigured` / `tradeApproveMode`, `tradeSettleConfigured` / `tradeSettleMode`, `tradeSettlePreflightConfigured` / `tradeSettlePreflightMode`.

**Forbidden:** using `POST /ondemand/hook` or WaitingPool as this ingress.

## Order fields (essential)

```json
{
  "schema": "MockL1TradeOrderV1",
  "mockL1Only": true,
  "side": "sell",
  "chainNftId": "7",
  "maker": "0x…",
  "subjectNftContract": "0x…",
  "subjectNftId": "1",
  "quoteAsset": "0x…",
  "price": "1000000",
  "amount": "1",
  "nonce": "1",
  "deadline": "1893456000",
  "feePolicyHash": "<mockL1FeePolicyHash()>",
  "signature": "0x…",
  "orderHash": "0x…"
}
```

Personal-sign message: `DLE mock-L1 trade order\n{orderHash}`.

## Match rules

- Same `chainNftId`, same NFT contract+id, same ERC-20 quote
- `bid >= ask`; neither cancelled/expired
- Tie-break: earliest `createdAt`, then lexicographically smaller `orderHash`
- Clearing price = sell ask

## Certificate

`TradeMatchCertificateV1` commits to scanner, committee/standbys, clearing price, 1 bps fee split, `settlementCalldataHash`, `selectionLogRef`, `beaconSource: "labInstantKeccakAfterFreeze"`.

Personal-sign message: `DLE mock-L1 trade match certificate\n{certificateHash}`.

## Mode A event types

| Code | Name |
| --- | --- |
| `0x1301` | TradeOpened (existing) |
| `0x1302` | MatchProposed |
| `0x1303` | MatchCertified |
| `0x1304` | SettlementSubmitted |
| `0x1305` | Settled |
| `0x1306` | SettlementFailed |

Client / Explorer must **not** claim Archive legality or quorum; they only display Archive responses.
