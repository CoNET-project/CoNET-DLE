# Archive A TypeScript MVP

Archive A is an independent TypeScript implementation of the canonical
`dle.archive.tendermint.corpus.v2` boundary. It does not import a shared
consensus core.

Implemented deterministic surfaces:

- fixed-container SSZ serialization, tree roots, and Keccak signing roots;
- `PrevoteQC`, `ArchiveCertificate`, `TimeoutCertificate`, and
  `CandidateRejectCertificate` validation and references;
- unbiased deterministic coordinator selection over a canonical five-member
  roster;
- Tendermint proposal/prevote/precommit state transitions;
- append-only, fsync-before-return WAL frames and safety records;
- byte-exact systematic `dle.rs.v1` Reed–Solomon `(7,4)` encoding,
  reconstruction, body commitment, and DA root;
- planned-exit `5 active + 2 ready standby` lifecycle transitions;
- newline-delimited JSON stdin/stdout conformance runner.

## Commands

```bash
npm run build
npm test
npm run corpus:check
npm run conformance
```

Runner example:

```json
{"id":1,"method":"health"}
```

Every input line produces exactly one JSON response line. Protocol failures use
the frozen `ERR_*` values; malformed runner requests use
`ERR_INVALID_REQUEST`.

This MVP intentionally excludes networking, timers, key custody, production
signature aggregation, and an L1 client.
