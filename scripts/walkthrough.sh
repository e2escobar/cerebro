#!/usr/bin/env bash
# Phase 3 acceptance walkthrough (spec §11).
#
# Drives the management API end to end as a developer and then an admin,
# asserting the expected HTTP status at every step.
#
#   bun run db:reset && bun run db:migrate && bun run db:seed
#   bash scripts/walkthrough.sh
set -euo pipefail

API="${API_BASE_URL:-http://localhost:3011}"
DEV_EMAIL="${SEED_DEVELOPER_EMAIL:-dev@local}"
DEV_PASSWORD="${SEED_DEVELOPER_PASSWORD:-dev12345}"
ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@local}"
ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-admin12345}"
FLAG_KEY="${FLAG_KEY:-new-checkout}"
APP="${APP:-default}"

DEV_JAR="$(mktemp)"
ADMIN_JAR="$(mktemp)"
BODY="$(mktemp)"
trap 'rm -f "$DEV_JAR" "$ADMIN_JAR" "$BODY"' EXIT

pass=0
fail=0

# call <jar> <expected-status> <description> <method> <path> [json-body]
call() {
  local jar="$1" expected="$2" description="$3" method="$4" path="$5" payload="${6:-}"
  local status

  if [ -n "$payload" ]; then
    status=$(curl -sS -o "$BODY" -w '%{http_code}' -X "$method" "$API$path" \
      -b "$jar" -c "$jar" -H 'Content-Type: application/json' -d "$payload")
  else
    status=$(curl -sS -o "$BODY" -w '%{http_code}' -X "$method" "$API$path" -b "$jar" -c "$jar")
  fi

  if [ "$status" = "$expected" ]; then
    printf '  \033[32m✓\033[0m %-52s %s\n' "$description" "$status"
    pass=$((pass + 1))
  else
    printf '  \033[31m✗\033[0m %-52s expected %s, got %s\n' "$description" "$expected" "$status"
    echo "      $(head -c 400 "$BODY")"
    fail=$((fail + 1))
  fi
}

echo
echo "Cerebro management API walkthrough → $API"
echo

echo "as developer ($DEV_EMAIL)"
call "$DEV_JAR" 200 "log in"                        POST "/v1/auth/login" \
  "{\"email\":\"$DEV_EMAIL\",\"password\":\"$DEV_PASSWORD\"}"
call "$DEV_JAR" 200 "read own permissions"          GET  "/v1/auth/me"
call "$DEV_JAR" 201 "create flag in dev"            POST "/v1/mgmt/applications/$APP/flags" \
  "{\"key\":\"$FLAG_KEY\",\"name\":\"New checkout flow\",\"description\":\"Rewritten cart\",\"type\":\"boolean\",\"defaultValue\":false,\"isClientSafe\":true}"
call "$DEV_JAR" 200 "set its value in dev"          PUT  "/v1/mgmt/applications/$APP/flags/$FLAG_KEY/environments/dev/value" '{"value":true}'
call "$DEV_JAR" 200 "enable it in dev"              PUT  "/v1/mgmt/applications/$APP/flags/$FLAG_KEY/environments/dev/enabled" '{"enabled":true}'

# The sequencing guard is only reachable by someone who holds `promote` on the
# target — for the developer, the permission check fires first (asserted below).
echo
echo "as admin ($ADMIN_EMAIL)"
call "$ADMIN_JAR" 200 "log in"                      POST "/v1/auth/login" \
  "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
call "$ADMIN_JAR" 422 "cannot skip dev → prod"      POST "/v1/mgmt/applications/$APP/flags/$FLAG_KEY/environments/prod/promote"

echo
echo "back to the developer"
call "$DEV_JAR" 200 "promote to qa"                 POST "/v1/mgmt/applications/$APP/flags/$FLAG_KEY/environments/qa/promote"
call "$DEV_JAR" 403 "refused promoting to prod"     POST "/v1/mgmt/applications/$APP/flags/$FLAG_KEY/environments/prod/promote"
call "$DEV_JAR" 403 "refused creating environments" POST "/v1/mgmt/environments" '{"key":"staging","name":"Staging","rank":9}'
call "$DEV_JAR" 403 "refused creating applications"  POST "/v1/mgmt/applications" '{"key":"other","name":"Other"}'
call "$DEV_JAR" 400 "rejects a mistyped value"      PUT  "/v1/mgmt/applications/$APP/flags/$FLAG_KEY/environments/dev/value" '{"value":"yes"}'

echo
echo "as admin again"
call "$ADMIN_JAR" 200 "promote to prod"             POST "/v1/mgmt/applications/$APP/flags/$FLAG_KEY/environments/prod/promote"
call "$ADMIN_JAR" 200 "enable in prod"              PUT  "/v1/mgmt/applications/$APP/flags/$FLAG_KEY/environments/prod/enabled" '{"enabled":true}'
call "$ADMIN_JAR" 200 "disable in prod (kill switch)" PUT "/v1/mgmt/applications/$APP/flags/$FLAG_KEY/environments/prod/enabled" '{"enabled":false}'
call "$ADMIN_JAR" 409 "promoting twice conflicts"   POST "/v1/mgmt/applications/$APP/flags/$FLAG_KEY/environments/prod/promote"
call "$ADMIN_JAR" 200 "read the flag detail"        GET  "/v1/mgmt/applications/$APP/flags/$FLAG_KEY"
call "$ADMIN_JAR" 200 "read the audit log"          GET  "/v1/mgmt/audit?entityType=flag"

echo
echo "unauthenticated"
call "$BODY.jar" 401 "management API refuses anonymous" GET "/v1/mgmt/applications/$APP/flags"

echo
echo "audit trail for $FLAG_KEY"
curl -sS -b "$ADMIN_JAR" "$API/v1/mgmt/audit?entityType=flag" \
  | grep -o '"action":"[^"]*"' | sed 's/"action":"/  /;s/"//' || true

echo
printf 'passed %d, failed %d\n\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
