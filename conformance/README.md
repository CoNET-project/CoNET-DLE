# CoNET-DLE Archive Conformance Corpus

The canonical machine-readable boundary is:

- schema: `schema/dle-archive-tendermint-corpus-v2.schema.json`;
- corpus: `corpus/DLE-Archive-Tendermint-Vectors-v2.json`;
- integrity manifest: `DLE-Archive-Tendermint-Corpus-v2.sha256`.

The v1 artifact in `src/whitepaper/` remains immutable. The v2 corpus embeds
the six v1 Proposal/Vote golden vectors and replaces the v1 prose-only state
cases with ordered machine inputs, outputs, errors, final states, and state
roots.

The corpus freezes certificate containers and references, coordinator
selection, WAL frame and safety-record bytes, error enums, reject reasons,
systematic RS `(7,4)` vectors, all 35 four-shard reconstruction sets, and the
`5 active + 2 ready standby` planned-exit lifecycle.

Implementations may parse the shared schema and corpus. They must not import a
shared consensus core.
