#!/usr/bin/env bash
# Executable IHM restore-test evidence linkage / bootstrap harness.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
IHM="${ROOT}/scripts/ops/internal-health-monitor.sh"
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "PASS $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL $1 — $2" >&2; }

setup() {
  CASE="$(mktemp -d "${TMPDIR:-/tmp}/ihm-rt.XXXXXX")"
  EVIDENCE="${CASE}/evidence"
  PROD_DUMPS="${CASE}/prod-dumps"
  STG_DUMPS="${CASE}/stg-dumps"
  STATE="${CASE}/state"
  mkdir -p "${EVIDENCE}/production/history" "${EVIDENCE}/staging/history" \
    "$PROD_DUMPS" "$STG_DUMPS" "$STATE"
  export IHM_RESTORE_TEST_EVIDENCE_ROOT="$EVIDENCE"
  export IHM_PROD_BACKUP_DIR="$PROD_DUMPS"
  export IHM_STAGING_BACKUP_DIR="$STG_DUMPS"
}

write_dump() {
  local dir="$1" name="$2" content="${3:-dump-body}"
  printf '%s' "$content" >"${dir}/${name}"
  touch "${dir}/${name}"
}

sha_of() {
  sha256sum -- "$1" | awk '{print $1}'
}

write_success() {
  local env_name="$1"
  local basename="$2"
  local dump_path="$3"
  local finished="${4:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  local size sha mtime_epoch mtime_utc
  size="$(stat -c '%s' "$dump_path")"
  sha="$(sha_of "$dump_path")"
  mtime_epoch="$(stat -c '%Y' "$dump_path")"
  mtime_utc="$(date -u -d "@${mtime_epoch}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -r "$mtime_epoch" +%Y-%m-%dT%H:%M:%SZ)"
  cat >"${EVIDENCE}/${env_name}/last-success.env" <<EOF
SCHEMA_VERSION=1
ENVIRONMENT=${env_name}
STATUS=success
ERROR_CODE=
STARTED_AT_UTC=${finished}
FINISHED_AT_UTC=${finished}
DURATION_SEC=10
DUMP_BASENAME=${basename}
DUMP_MTIME_UTC=${mtime_utc}
DUMP_SIZE_BYTES=${size}
DUMP_SHA256=${sha}
DUMP_AGE_HOURS=1
PG_IMAGE=postgres:17-alpine
TEMP_CONTAINER=
USER_SCHEMA_COUNT=1
USER_TABLE_COUNT=5
INTEGRITY_OK=1
CLEANUP_OK=1
TEMP_RESOURCES_ABSENT=1
SNAPSHOT_ABSENT=1
EOF
  cp -- "${EVIDENCE}/${env_name}/last-success.env" "${EVIDENCE}/${env_name}/last-attempt.env"
}

run_check() {
  bash "$IHM" --state-dir "$STATE" --only-restore-test
}

# bootstrap not_enforced
setup
out="$(run_check 2>&1 || true)"
echo "$out" | grep -q 'INFO production restore-test' && ok "not_enforced_info" || bad "not_enforced_info" "$out"
echo "$out" | grep -q 'not proof of restore readiness' && ok "not_enforced_detail" || bad "not_enforced_detail" "$out"
echo "$out" | grep -qv 'OK production restore-test' && ok "not_enforced_not_ok" || bad "not_enforced_not_ok" "looks healthy"
echo "$out" | grep -q 'INTERNAL_HEALTH_MONITOR OK' && ok "not_enforced_overall_ok" || bad "not_enforced_overall_ok" "$out"

# enforce + correct linkage
setup
touch "${EVIDENCE}/.enforce"
bn="20260726T120000Z_ok.dump"
write_dump "$PROD_DUMPS" "$bn" "prod-ok"
write_dump "$STG_DUMPS" "$bn" "stg-ok"
write_success production "$bn" "${PROD_DUMPS}/${bn}"
write_success staging "$bn" "${STG_DUMPS}/${bn}"
out="$(run_check 2>&1 || true)"
echo "$out" | grep -q 'OK production restore-test' && ok "healthy_linked" || bad "healthy_linked" "$out"

# wrong environment in evidence
setup
touch "${EVIDENCE}/.enforce"
bn="20260726T120000Z_env.dump"
write_dump "$PROD_DUMPS" "$bn" "x"
write_success production "$bn" "${PROD_DUMPS}/${bn}"
# corrupt ENVIRONMENT
sed -i 's/^ENVIRONMENT=production/ENVIRONMENT=staging/' "${EVIDENCE}/production/last-success.env" 2>/dev/null \
  || sed -i '' 's/^ENVIRONMENT=production/ENVIRONMENT=staging/' "${EVIDENCE}/production/last-success.env"
# staging missing success → also critical; focus production line
write_success staging "$bn" "${PROD_DUMPS}/${bn}" 2>/dev/null || true
write_dump "$STG_DUMPS" "$bn" "x"
write_success staging "$bn" "${STG_DUMPS}/${bn}"
out="$(run_check 2>&1 || true)"
echo "$out" | grep -q 'RESTORE_TEST_ENV_MISMATCH\|environment mismatch' && ok "env_mismatch" || bad "env_mismatch" "$out"

# hash mismatch
setup
touch "${EVIDENCE}/.enforce"
bn="20260726T120000Z_hash.dump"
write_dump "$PROD_DUMPS" "$bn" "body-a"
write_dump "$STG_DUMPS" "$bn" "body-a"
write_success production "$bn" "${PROD_DUMPS}/${bn}"
write_success staging "$bn" "${STG_DUMPS}/${bn}"
printf 'body-b' >"${PROD_DUMPS}/${bn}"
out="$(run_check 2>&1 || true)"
echo "$out" | grep -q 'RESTORE_TEST_DUMP_HASH\|sha256 mismatch' && ok "hash_mismatch" || bad "hash_mismatch" "$out"

# wrong basename
setup
touch "${EVIDENCE}/.enforce"
bn="20260726T120000Z_base.dump"
write_dump "$PROD_DUMPS" "$bn" "x"
write_dump "$STG_DUMPS" "$bn" "x"
write_success production "$bn" "${PROD_DUMPS}/${bn}"
write_success staging "$bn" "${STG_DUMPS}/${bn}"
sed -i 's/DUMP_BASENAME=.*/DUMP_BASENAME=20260726T120000Z_other.dump/' "${EVIDENCE}/production/last-success.env" 2>/dev/null \
  || sed -i '' 's/DUMP_BASENAME=.*/DUMP_BASENAME=20260726T120000Z_other.dump/' "${EVIDENCE}/production/last-success.env"
out="$(run_check 2>&1 || true)"
echo "$out" | grep -q 'RESTORE_TEST_DUMP_MISSING\|referenced dump missing\|DUMP_BASENAME' && ok "basename_missing" || bad "basename_missing" "$out"

# missing referenced dump
setup
touch "${EVIDENCE}/.enforce"
bn="20260726T120000Z_miss.dump"
write_dump "$PROD_DUMPS" "$bn" "x"
write_dump "$STG_DUMPS" "$bn" "x"
write_success production "$bn" "${PROD_DUMPS}/${bn}"
write_success staging "$bn" "${STG_DUMPS}/${bn}"
rm -f "${PROD_DUMPS}/${bn}"
out="$(run_check 2>&1 || true)"
echo "$out" | grep -q 'RESTORE_TEST_DUMP_MISSING\|referenced dump missing' && ok "dump_missing" || bad "dump_missing" "$out"

# dump too old
setup
touch "${EVIDENCE}/.enforce"
bn="20260101T000000Z_old.dump"
write_dump "$PROD_DUMPS" "$bn" "old"
write_dump "$STG_DUMPS" "$bn" "old"
touch -d '200 hours ago' "${PROD_DUMPS}/${bn}" 2>/dev/null || touch -t 202601010101 "${PROD_DUMPS}/${bn}"
touch -d '200 hours ago' "${STG_DUMPS}/${bn}" 2>/dev/null || touch -t 202601010101 "${STG_DUMPS}/${bn}"
write_success production "$bn" "${PROD_DUMPS}/${bn}"
write_success staging "$bn" "${STG_DUMPS}/${bn}"
out="$(run_check 2>&1 || true)"
echo "$out" | grep -q 'RESTORE_TEST_DUMP_STALE\|too old' && ok "dump_stale" || bad "dump_stale" "$out"

# success too old
setup
touch "${EVIDENCE}/.enforce"
bn="20260726T120000Z_ok2.dump"
write_dump "$PROD_DUMPS" "$bn" "x"
write_dump "$STG_DUMPS" "$bn" "x"
write_success production "$bn" "${PROD_DUMPS}/${bn}" "2026-01-01T00:00:00Z"
write_success staging "$bn" "${STG_DUMPS}/${bn}" "2026-01-01T00:00:00Z"
out="$(run_check 2>&1 || true)"
echo "$out" | grep -q 'RESTORE_TEST_STALE\|stale ageHours' && ok "success_stale" || bad "success_stale" "$out"

# daily newer dump within lag window
setup
touch "${EVIDENCE}/.enforce"
old="20260720T120000Z_verified.dump"
new="20260725T120000Z_daily.dump"
write_dump "$PROD_DUMPS" "$old" "verified"
write_dump "$STG_DUMPS" "$old" "verified"
touch -d '5 days ago' "${PROD_DUMPS}/${old}" 2>/dev/null || true
touch -d '5 days ago' "${STG_DUMPS}/${old}" 2>/dev/null || true
write_dump "$PROD_DUMPS" "$new" "newer"
write_dump "$STG_DUMPS" "$new" "newer"
write_success production "$old" "${PROD_DUMPS}/${old}"
write_success staging "$old" "${STG_DUMPS}/${old}"
out="$(run_check 2>&1 || true)"
echo "$out" | grep -q 'OK production restore-test' && ok "lag_within_window" || bad "lag_within_window" "$out"

# lag beyond window
setup
touch "${EVIDENCE}/.enforce"
old="20260601T120000Z_verified.dump"
new="20260725T120000Z_daily.dump"
write_dump "$PROD_DUMPS" "$old" "verified"
write_dump "$STG_DUMPS" "$old" "verified"
touch -d '40 days ago' "${PROD_DUMPS}/${old}" 2>/dev/null || touch -t 202606011200 "${PROD_DUMPS}/${old}"
touch -d '40 days ago' "${STG_DUMPS}/${old}" 2>/dev/null || touch -t 202606011200 "${STG_DUMPS}/${old}"
write_dump "$PROD_DUMPS" "$new" "newer"
write_dump "$STG_DUMPS" "$new" "newer"
# success finished recent but dump age/lag bad
finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
write_success production "$old" "${PROD_DUMPS}/${old}" "$finished"
write_success staging "$old" "${STG_DUMPS}/${old}" "$finished"
out="$(run_check 2>&1 || true)"
echo "$out" | grep -qE 'RESTORE_TEST_DUMP_LAG|RESTORE_TEST_DUMP_STALE|lag behind|too old' && ok "lag_beyond_window" || bad "lag_beyond_window" "$out"

# last attempt failed while old success exists
setup
touch "${EVIDENCE}/.enforce"
bn="20260726T120000Z_ok3.dump"
write_dump "$PROD_DUMPS" "$bn" "x"
write_dump "$STG_DUMPS" "$bn" "x"
write_success production "$bn" "${PROD_DUMPS}/${bn}"
write_success staging "$bn" "${STG_DUMPS}/${bn}"
cat >"${EVIDENCE}/production/last-attempt.env" <<EOF
SCHEMA_VERSION=1
ENVIRONMENT=production
STATUS=failed
ERROR_CODE=PG_RESTORE_FAILED
FINISHED_AT_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CLEANUP_OK=1
TEMP_RESOURCES_ABSENT=1
EOF
out="$(run_check 2>&1 || true)"
echo "$out" | grep -q 'RESTORE_TEST_LAST_ATTEMPT_FAILED\|last attempt failed' && ok "last_attempt_failed" || bad "last_attempt_failed" "$out"

echo "=== IHM restore-test harness PASS=${PASS} FAIL=${FAIL} ==="
[[ "$FAIL" -eq 0 ]]
