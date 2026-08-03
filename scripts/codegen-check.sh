#!/usr/bin/env bash
# Phase 7 acceptance (spec §11): the real generator, against the running API,
# produces a flag map that makes `get()` narrow per key.
#
#   bash scripts/walkthrough.sh      # so there are flags to read
#   bash scripts/codegen-check.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="${API_BASE_URL:-http://localhost:3011}"
ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@local}"
ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-admin12345}"

# Inside the repo so workspace type packages resolve from node_modules.
WORK="$(mktemp -d "$ROOT/.codegen-check.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

echo
echo "Cerebro codegen check → $API"
echo

bun "$ROOT/packages/sdk/src/codegen.ts" \
  --url "$API" --email "$ADMIN_EMAIL" --password "$ADMIN_PASSWORD" \
  --out "$WORK/cerebro-flags.d.ts"

echo
echo "generated:"
sed 's/^/  /' "$WORK/cerebro-flags.d.ts"

# Point the augmentation at the SDK source and compile a scratch file against it.
sed "s|\"@cerebro/sdk\"|\"$ROOT/packages/sdk/src/index.ts\"|g" \
  "$WORK/cerebro-flags.d.ts" > "$WORK/flags.d.ts"

cat > "$WORK/scratch.ts" <<EOF
import { createClient } from "$ROOT/packages/sdk/src/index.ts";
import "./flags.d.ts";

const client = createClient({ apiKey: "cbr_dev_x", baseUrl: "$API", autoStart: false });

const ok: boolean = client.get("new-checkout");
// @ts-expect-error a boolean flag is not a string
const bad: string = client.get("new-checkout");

export { ok, bad };
EOF

cat > "$WORK/tsconfig.json" <<EOF
{
  "extends": "$ROOT/packages/tsconfig/bun.json",
  "include": ["*.ts", "*.d.ts"]
}
EOF

echo "compiling a consumer against the generated map…"
if bun x tsc --noEmit -p "$WORK/tsconfig.json"; then
  echo "  ✓ get('new-checkout') is boolean, and assigning it to string fails"
else
  echo "  ✗ the generated map did not narrow as expected"
  exit 1
fi

echo
echo "passed"
echo
