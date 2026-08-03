#!/usr/bin/env bash
# Phase 4 acceptance checks (spec §11).
#
# Assumes scripts/walkthrough.sh has already run, so `new-checkout` exists and
# is promoted everywhere. Creates SDK keys, then verifies per-environment
# payloads, client-safe filtering, ETag/304, and version movement on mutation.
set -euo pipefail

API="${API_BASE_URL:-http://localhost:3011}"
ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@local}"
ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-admin12345}"
APP="${APP:-default}"

JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

pass=0
fail=0

check() { # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf '  \033[32m✓\033[0m %-50s %s\n' "$1" "$3"
    pass=$((pass + 1))
  else
    printf '  \033[31m✗\033[0m %-50s expected %s, got %s\n' "$1" "$2" "$3"
    fail=$((fail + 1))
  fi
}

json_field() { grep -o "\"$1\":[^,}]*" | head -1 | cut -d: -f2- ; }

echo
echo "Cerebro evaluation API checks → $API"
echo

curl -sS -o /dev/null -c "$JAR" -X POST "$API/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"

new_key() { # new_key <envKey> <kind> [appKey]
  local app="${3:-$APP}"
  curl -sS -b "$JAR" -X POST "$API/v1/mgmt/api-keys" -H 'Content-Type: application/json' \
    -d "{\"applicationKey\":\"$app\",\"environmentKey\":\"$1\",\"name\":\"$app-$1-$2\",\"kind\":\"$2\"}" \
    | grep -o '"key":"[^"]*"' | cut -d'"' -f4
}

# A second flag that is NOT client-safe, enabled in prod, to prove filtering.
curl -sS -o /dev/null -b "$JAR" -X POST "$API/v1/mgmt/applications/$APP/flags" -H 'Content-Type: application/json' \
  -d '{"key":"internal-metrics","name":"Internal metrics","type":"number","defaultValue":0,"initialValue":42,"isClientSafe":false}'
curl -sS -o /dev/null -b "$JAR" -X PUT "$API/v1/mgmt/applications/$APP/flags/internal-metrics/environments/dev/enabled" \
  -H 'Content-Type: application/json' -d '{"enabled":true}'

DEV_KEY="$(new_key dev server)"
PROD_KEY="$(new_key prod server)"
CLIENT_KEY="$(new_key dev client)"

echo "key format"
check "dev server key looks like cbr_<app>_dev_<32>" "ok" \
  "$(printf '%s' "$DEV_KEY" | grep -Eq "^cbr_${APP}_dev_[A-Za-z0-9_-]{32}$" && echo ok || echo "$DEV_KEY")"

echo
echo "payloads"
DEV_BODY="$(curl -sS -H "Authorization: Bearer $DEV_KEY" "$API/v1/flags")"
PROD_BODY="$(curl -sS -H "Authorization: Bearer $PROD_KEY" "$API/v1/flags")"
CLIENT_BODY="$(curl -sS -H "Authorization: Bearer $CLIENT_KEY" "$API/v1/flags")"

check "dev and prod payloads differ" "different" \
  "$([ "$DEV_BODY" != "$PROD_BODY" ] && echo different || echo same)"
check "dev sees new-checkout enabled (true)" "true" "$(printf '%s' "$DEV_BODY" | json_field 'new-checkout')"
check "prod sees new-checkout disabled → default" "false" \
  "$(printf '%s' "$PROD_BODY" | json_field 'new-checkout')"
check "dev server key sees internal-metrics" "42" "$(printf '%s' "$DEV_BODY" | json_field 'internal-metrics')"
check "client key omits non-client-safe flag" "absent" \
  "$(printf '%s' "$CLIENT_BODY" | grep -q 'internal-metrics' && echo present || echo absent)"
check "client key still sees the client-safe flag" "true" \
  "$(printf '%s' "$CLIENT_BODY" | json_field 'new-checkout')"

echo
echo "caching"
ETAG="$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $DEV_KEY" "$API/v1/flags" \
  | grep -i '^etag:' | tr -d '\r' | cut -d' ' -f2-)"
check "ETag names the application and environment" "ok" \
  "$(printf '%s' "$ETAG" | grep -Eq "^W/\"${APP}-dev-[0-9]+\"$" && echo ok || echo "$ETAG")"

STATUS_304="$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $DEV_KEY" -H "If-None-Match: $ETAG" "$API/v1/flags")"
check "If-None-Match returns 304" "304" "$STATUS_304"

VERSION_BEFORE="$(curl -sS -H "Authorization: Bearer $DEV_KEY" "$API/v1/config-version" | json_field version)"
curl -sS -o /dev/null -b "$JAR" -X PUT "$API/v1/mgmt/applications/$APP/flags/new-checkout/environments/dev/enabled" \
  -H 'Content-Type: application/json' -d '{"enabled":false}'
VERSION_AFTER="$(curl -sS -H "Authorization: Bearer $DEV_KEY" "$API/v1/config-version" | json_field version)"
ETAG_AFTER="$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $DEV_KEY" "$API/v1/flags" \
  | grep -i '^etag:' | tr -d '\r' | cut -d' ' -f2-)"

check "a mutation bumps config_version" "bumped" \
  "$([ "$VERSION_AFTER" -gt "$VERSION_BEFORE" ] && echo bumped || echo "stuck at $VERSION_AFTER")"
check "and changes the ETag" "changed" \
  "$([ "$ETAG" != "$ETAG_AFTER" ] && echo changed || echo unchanged)"
check "stale ETag no longer returns 304" "200" \
  "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $DEV_KEY" \
     -H "If-None-Match: $ETAG" "$API/v1/flags")"

echo
echo "auth"
check "no key is refused" "401" \
  "$(curl -sS -o /dev/null -w '%{http_code}' "$API/v1/flags")"
check "an unknown key is refused" "401" \
  "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer cbr_dev_notarealkey00000000000000000" "$API/v1/flags")"

KEY_ID="$(curl -sS -b "$JAR" "$API/v1/mgmt/api-keys" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)"
curl -sS -o /dev/null -b "$JAR" -X DELETE "$API/v1/mgmt/api-keys/$KEY_ID"
check "a revoked key stops resolving" "401" \
  "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $CLIENT_KEY" "$API/v1/flags")"

echo
echo "application isolation"
curl -sS -o /dev/null -b "$JAR" -X POST "$API/v1/mgmt/applications" -H 'Content-Type: application/json' \
  -d '{"key":"isolation-probe","name":"Isolation probe"}'
PROBE_KEY="$(new_key dev server isolation-probe)"
check "a second application starts empty" "{}" \
  "$(curl -sS -H "Authorization: Bearer $PROBE_KEY" "$API/v1/flags")"
check "and its ETag names it, not the other app" "ok" \
  "$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $PROBE_KEY" "$API/v1/flags" \
     | grep -i '^etag:' | grep -q 'isolation-probe-dev' && echo ok || echo mismatch)"
curl -sS -o /dev/null -b "$JAR" -X DELETE "$API/v1/mgmt/applications/isolation-probe"

echo
printf 'passed %d, failed %d\n\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
