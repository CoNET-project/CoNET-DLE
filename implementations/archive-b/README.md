# CoNET-DLE Archive-B TypeScript MVP

Independent archive implementation. It imports no code from another implementation.

## Commands

```bash
npm ci
npm test
npm run build
npm run conformance
CORPUS_PATH=/path/to/later-corpus.json npm run conformance
```

The CLI also accepts newline-delimited JSON on stdin and writes exactly one JSON response per request:

```json
{"id":1,"op":"corpus.run"}
{"id":2,"op":"da.encode","bodyHex":"0x00010203"}
```

Supported operations are `corpus.run`, `ssz.proposal`, `ssz.vote`, `da.encode`,
`da.reconstruct`, and `lifecycle.advance`.

## Safety boundaries

- Proposal/Vote serialization is fixed-width SSZ with strict field and byte-length checks.
- Tendermint lock/valid transitions call a durable-transition adapter before returning any vote.
- `DLEW` WAL frames use monotonic sequence numbers and SHA-256 payload/frame checksums. Corrupt or
  incomplete tails fail closed into non-voting recovery; they are never silently truncated.
- `dle.rs.v1` is the frozen systematic GF(2^8) RS(7,4) matrix and fixed eight-leaf SHA-256 DA tree.
- Group admission requires five disjoint voters plus two disjoint, readiness-proven standbys.

The canonical v2 corpus freezes certificate SSZ/references, coordinator selection, DLEW frames,
RS(7,4), DA roots, Tendermint state transitions, and the 5+2 lifecycle. The immutable v1 corpus
remains supported through `CORPUS_PATH`; its report lists the dimensions that v1 did not freeze.
This is an MVP, not a production signer: the final SSZ-to-EIP-712 signature wrapper, production
networking, key custody, and crash-injection integration remain outside this package.
