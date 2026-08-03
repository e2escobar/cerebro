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
# The same application walkthrough.sh puts its flag in. Naming it explicitly
# also keeps this working once a second application exists — the generator
# refuses to guess, and rightly so.
APP="${APP:-default}"

# Inside the repo so workspace type packages resolve from node_modules.
WORK="$(mktemp -d "$ROOT/.codegen-check.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

echo
echo "Cerebro codegen check → $API"
echo

# Generated outside the compiled directory: as emitted it imports the package by
# name, which only resolves once the package is built and installed.
mkdir -p "$WORK/raw"
bun "$ROOT/packages/client/src/cli/codegen.ts" \
  --app "$APP" --url "$API" --email "$ADMIN_EMAIL" --password "$ADMIN_PASSWORD" \
  --out "$WORK/raw/generated.manifest.ts"

echo
echo "generated:"
sed 's/^/  /' "$WORK/raw/generated.manifest.ts"

# Point the augmentation at the library source and compile a scratch file
# against it, so this needs no build and no published package.
sed "s|\"@cerebro/client\"|\"$ROOT/packages/client/src/index.ts\"|g" \
  "$WORK/raw/generated.manifest.ts" > "$WORK/cerebro.manifest.ts"

cat > "$WORK/scratch.ts" <<EOF
import { createClient, validateSnapshot } from "$ROOT/packages/client/src/index.ts";
import { manifest } from "./cerebro.manifest.ts";

const client = createClient({
  apiKey: "cbr_dev_x",
  baseUrl: "$API",
  autoStart: false,
  manifest,
});

const ok: boolean = client.get("new-checkout");
// @ts-expect-error a boolean flag is not a string
const bad: string = client.get("new-checkout");

// The runtime half of the same file: a payload can be checked against it.
const issues = validateSnapshot({ "new-checkout": true }, manifest);
const unknownKeys: string[] = issues.unknownKeys;

export { ok, bad, unknownKeys };
EOF

# library.json rather than bun.json: this compiles the library's own source,
# which is browser-shaped — it needs the DOM lib and must not see Bun's globals.
cat > "$WORK/tsconfig.json" <<EOF
{
  "extends": "$ROOT/packages/tsconfig/library.json",
  "compilerOptions": {
    "types": [],
    "allowImportingTsExtensions": true
  },
  "include": ["*.ts", "*.d.ts"]
}
EOF

echo "compiling a consumer against the generated manifest…"
if bun x tsc --noEmit -p "$WORK/tsconfig.json"; then
  echo "  ✓ get('new-checkout') is boolean, and assigning it to string fails"
else
  echo "  ✗ the generated map did not narrow as expected"
  exit 1
fi

echo
echo "passed"
echo
