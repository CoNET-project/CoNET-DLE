# DLE TypeScript MVP CI evidence

`DLE TypeScript MVP CI` is a local-only, reproducible verification workflow. It
does not deploy software, access SSH, use credentials, or contact a network
service. The workflow is defined in
`.github/workflows/dle-typescript-mvp-ci.yml`.

## Required checks

The workflow executes these checks in order:

1. validates the CI-evidence contract and the checked-in corpus SHA-256
   manifest;
2. regenerates the v2 corpus in memory and rejects stale corpus or checksum
   files;
3. parses TypeScript import syntax in both Archive trees and rejects every
   cross-Archive import, including relative, package, `require`, and literal
   dynamic-import forms;
4. builds, tests, and runs corpus conformance for Archive A;
5. builds, tests, and runs corpus conformance for Archive B; and
6. runs the independent-process differential transcript suite.

Archive A and Archive B may consume the canonical corpus and schema, but they
must never import source code from one another.

## Local reproduction

From the `conet-layer2` repository root:

```bash
npm ci
npm --prefix implementations/archive-b ci
npm run evidence:verify
npm run corpus:check
npm run boundary:check
npm run archive-a:build
npm run archive-a:test
npm run archive-a:conformance
npm run archive-b:build
npm run archive-b:test
npm run archive-b:conformance
npm run differential
```

## Evidence bundle

On a successful CI run, the workflow uploads
`dle-typescript-mvp-evidence-<commit>` containing one log per required check,
`manifest.json`, and `SHA256SUMS`.

The manifest is specified by
`evidence/schemas/dle-typescript-mvp-ci-evidence-v1.schema.json`. It records:

- the source revision;
- SHA-256 and byte length for the canonical corpus, schema, and corpus
  integrity manifest;
- the two implementation source roots and the cross-import prohibition;
- every required check, its exact command, its log artifact, and a `passed`
  status; and
- SHA-256 and byte length for every copied log artifact.

The generated `SHA256SUMS` covers each log and `manifest.json`. Collection
rejects missing, symbolic-link, or unexpected check logs, and immediately
re-verifies the completed bundle before upload.

To create the same bundle layout locally after all checks pass:

```bash
mkdir -p /tmp/dle-ci-evidence/logs
# Write each command's stdout/stderr to the matching logs/<check>.log name.
npm run evidence:collect -- \
  --output /tmp/dle-ci-evidence/bundle \
  --artifacts /tmp/dle-ci-evidence \
  --revision local
npm run evidence:verify-manifest -- --output /tmp/dle-ci-evidence/bundle
```

The accepted log names are fixed by `evidence/scripts/ci-evidence.ts`; CI
creates them automatically. Do not add untracked files to the bundle as
evidence.
