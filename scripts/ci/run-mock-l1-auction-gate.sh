#!/usr/bin/env bash
# Mock-L1 auction CI gate for CoNET-DLE (TypeScript demos + targeted tests).
# Optional --with-hardhat: when nested under BeamioContract monorepo, run full
# hardhat node → deploy → recovery → settle (npm run dle:mock-auction-e2e).
# Local / lab only — never CoNET 224422.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

WITH_HARDHAT=0
for arg in "$@"; do
  case "$arg" in
    --with-hardhat) WITH_HARDHAT=1 ;;
    -h|--help)
      echo "Usage: $0 [--with-hardhat]"
      exit 0
      ;;
  esac
done

echo "==> runtime:test (mock-l1 / trade)"
npx tsx --test \
  runtime/test/mock-l1.test.ts \
  runtime/test/trade-match.test.ts \
  runtime/test/trade-custody.test.ts \
  runtime/test/trade-onchain-settle.test.ts

echo "==> explorer:test"
npm run explorer:test

echo "==> mock-auction-demo (settle)"
MOCK_L1_DEMO_MODE=settle npm run mock-auction-demo

echo "==> mock-auction-demo (recovery)"
MOCK_L1_DEMO_MODE=recovery npm run mock-auction-demo

if [[ "$WITH_HARDHAT" -eq 1 ]]; then
  PARENT="$(cd "$ROOT/../.." && pwd)"
  if [[ ! -f "$PARENT/package.json" ]] || ! grep -q '"dle:mock-auction-e2e"' "$PARENT/package.json"; then
    echo "missing monorepo parent with dle:mock-auction-e2e at $PARENT" >&2
    exit 1
  fi
  echo "==> hardhat e2e (parent dle:mock-auction-e2e)"
  (cd "$PARENT" && npm run dle:mock-auction-e2e)
fi

echo "mock-l1 auction CI gate OK"
