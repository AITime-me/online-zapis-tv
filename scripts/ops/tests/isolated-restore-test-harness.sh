#!/usr/bin/env bash
# Linux/Git-Bash behavioral harness for isolated-restore-test failure paths.
# Uses fake docker; never touches real Docker, dumps, or working DBs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="${ROOT}/scripts/ops/isolated-restore-test.sh"
FAKE_SRC="${ROOT}/scripts/ops/lib/fake-docker-irt.sh"
PASS=0
FAIL=0
SKIP=0
RESULTS=()

note() { RESULTS+=("$1"); }

ok() { PASS=$((PASS + 1)); note "PASS $1"; echo "PASS $1"; }
bad() { FAIL=$((FAIL + 1)); note "FAIL $1 — $2"; echo "FAIL $1 — $2" >&2; }
skip() { SKIP=$((SKIP + 1)); note "SKIP $1 — $2"; echo "SKIP $1 — $2"; }

require_flock() {
  command -v flock >/dev/null 2>&1
}

setup_case() {
  CASE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/irt-harness.XXXXXX")"
  BIN="${CASE_DIR}/bin"
  STATE="${CASE_DIR}/docker-state"
  EVIDENCE="${CASE_DIR}/evidence"
  DUMPS="${CASE_DIR}/dumps"
  mkdir -p "$BIN" "$STATE" "$EVIDENCE" "$DUMPS"
  cp -- "$FAKE_SRC" "${BIN}/docker"
  chmod +x "${BIN}/docker"
  # Always shadow flock with a controllable test double so lock contention is
  # executable on hosts without util-linux flock (Windows Git Bash).
  cat >"${BIN}/flock" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n) shift ;;
    -u) shift; exit 0 ;;
    *)
      if [[ "${IRT_FAKE_FLOCK_BUSY:-0}" == "1" ]]; then
        exit 1
      fi
      exit 0
      ;;
  esac
done
exit 0
EOF
  chmod +x "${BIN}/flock"
  export PATH="${BIN}:${PATH}"
  export FAKE_DOCKER_STATE="$STATE"
  export FAKE_DOCKER_MODE="${1:-ok}"
  export IRT_DUMP_DIR_OVERRIDE="$DUMPS"
  export IRT_SKIP_FORBIDDEN_CHECK="${IRT_SKIP_FORBIDDEN_CHECK:-1}"
}

make_dump() {
  local name="${1:-20260726T120000Z_testdump.dump}"
  local path="${DUMPS}/${name}"
  printf 'FAKE-PG-DUMP-%s' "$name" >"$path"
  # fresh mtime
  touch "$path"
  printf '%s' "$path"
}

seed_success() {
  local env_name="$1"
  local run_id="${2:-aaaaaaaaaaaaaaaa}"
  mkdir -p "${EVIDENCE}/${env_name}/history" "${EVIDENCE}/${env_name}/runtime"
  cat >"${EVIDENCE}/${env_name}/last-success.env" <<EOF
SCHEMA_VERSION=1
ENVIRONMENT=${env_name}
STATUS=success
ERROR_CODE=
STARTED_AT_UTC=2026-07-20T00:00:00Z
FINISHED_AT_UTC=2026-07-20T00:05:00Z
DURATION_SEC=300
RUN_ID=${run_id}
DUMP_BASENAME=20260720T000000Z_old.dump
DUMP_MTIME_UTC=2026-07-20T00:00:00Z
DUMP_SIZE_BYTES=10
DUMP_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
DUMP_AGE_HOURS=1
PG_IMAGE=postgres:17-alpine
TEMP_CONTAINER=
TEMP_CID=
TEMP_PG_STARTED=0
RESTORE_OK=1
SQL_CONNECT_OK=1
USER_SCHEMA_COUNT=1
USER_TABLE_COUNT=5
INTEGRITY_OK=1
CLEANUP_OK=1
TEMP_RESOURCES_ABSENT=1
SNAPSHOT_ABSENT=1
EOF
  cp -- "${EVIDENCE}/${env_name}/last-success.env" "${EVIDENCE}/${env_name}/last-attempt.env"
}

read_key() {
  local file="$1" key="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | tail -n1 | cut -d= -f2- || true
}

run_irt() {
  local env_name="${1:-production}"
  shift || true
  bash "$SCRIPT" --environment "$env_name" --evidence-root "$EVIDENCE" "$@"
}

# Background signal tests must target the restore-test process that owns INT/TERM
# traps (same contract as systemd KillMode on the unit MainPID).
# `run_irt &` backgrounds a *wrapper* function shell without traps; SIGTERM then
# yields harness rc=143, leaves the real script orphaned, and skips finalizer.
# `exec` replaces that wrapper in-place so $! is the trapped restore-test PID.
run_irt_bg() {
  local env_name="${1:-production}"
  shift || true
  exec bash "$SCRIPT" --environment "$env_name" --evidence-root "$EVIDENCE" "$@"
}

# --- scenarios --------------------------------------------------------------

scenario_dump_missing() {
  setup_case ok
  set +e
  run_irt production
  local rc=$?
  set -e
  if [[ "$rc" -eq 10 ]]; then ok "dump_missing"; else bad "dump_missing" "rc=$rc"; fi
}

scenario_dump_stale() {
  setup_case ok
  local p
  p="$(make_dump)"
  # age > 36h
  if touch -d '40 hours ago' "$p" 2>/dev/null || touch -t 202601010101 "$p" 2>/dev/null; then
    set +e
    run_irt production
    local rc=$?
    set -e
    if [[ "$rc" -eq 10 ]]; then ok "dump_stale"; else bad "dump_stale" "rc=$rc"; fi
  else
    skip "dump_stale" "touch -d unavailable"
  fi
}

scenario_dump_unreadable() {
  setup_case ok
  local p
  p="$(make_dump)"
  chmod 000 "$p" || true
  if [[ -r "$p" ]]; then
    chmod 644 "$p" 2>/dev/null || true
    skip "dump_unreadable" "chmod 000 ineffective on this host"
    return
  fi
  set +e
  run_irt production
  local rc=$?
  set -e
  chmod 644 "$p" 2>/dev/null || true
  if [[ "$rc" -eq 10 ]]; then ok "dump_unreadable"; else bad "dump_unreadable" "rc=$rc"; fi
}

scenario_noimage() {
  setup_case noimage
  make_dump >/dev/null
  set +e
  run_irt production
  local rc=$?
  set -e
  if [[ "$rc" -eq 20 ]]; then ok "noimage"; else bad "noimage" "rc=$rc"; fi
}

scenario_notready() {
  setup_case notready
  make_dump >/dev/null
  export IRT_PG_READY_TIMEOUT_SEC=2
  set +e
  run_irt production
  local rc=$?
  set -e
  unset IRT_PG_READY_TIMEOUT_SEC
  if [[ "$rc" -eq 20 ]]; then ok "notready"; else bad "notready" "rc=$rc"; fi
}

scenario_restorefail() {
  setup_case restorefail
  make_dump >/dev/null
  set +e
  run_irt production
  local rc=$?
  set -e
  if [[ "$rc" -eq 30 ]]; then ok "restorefail"; else bad "restorefail" "rc=$rc"; fi
  local attempt="${EVIDENCE}/production/last-attempt.env"
  [[ -f "$attempt" ]] || { bad "restorefail_evidence" "no last-attempt"; return; }
  [[ "$(read_key "$attempt" CLEANUP_OK)" == "1" ]] || bad "restorefail_cleanup" "CLEANUP_OK!=1"
  [[ "$(read_key "$attempt" TEMP_RESOURCES_ABSENT)" == "1" ]] || bad "restorefail_absent" "absent!=1"
}

scenario_integrityfail() {
  setup_case integrityfail
  make_dump >/dev/null
  set +e
  run_irt production
  local rc=$?
  set -e
  if [[ "$rc" -eq 40 ]]; then ok "integrityfail"; else bad "integrityfail" "rc=$rc"; fi
}

scenario_term() {
  case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW*|MSYS*|CYGWIN*)
      skip "term_interrupt" "SIGTERM to blocked child unreliable on Git Bash"
      return
      ;;
  esac
  setup_case hang-after-run
  make_dump >/dev/null
  set +e
  run_irt_bg production &
  local pid=$!
  local waited=0
  # Wait until fake docker has created a container (pg_isready hang phase).
  while (( waited < 20 )); do
    if compgen -G "${STATE}/containers/*" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
    waited=$((waited + 1))
  done
  kill -TERM "$pid" 2>/dev/null || true
  wait "$pid"
  local rc=$?
  set -e
  if [[ "$rc" -eq 50 ]]; then ok "term_interrupt"; else bad "term_interrupt" "rc=$rc"; fi
  if [[ -d "${STATE}/containers" ]] && compgen -G "${STATE}/containers/*" >/dev/null; then
    bad "term_cleanup" "container still present"
  else
    ok "term_cleanup"
  fi
  # Runtime leftovers must be gone after finalizer cleanup.
  if compgen -G "${EVIDENCE}/production/runtime/*/dump.snapshot" >/dev/null 2>&1 \
    || compgen -G "${EVIDENCE}/production/runtime/*/container.cid" >/dev/null 2>&1 \
    || [[ -f "${EVIDENCE}/production/runtime/current.env" ]]; then
    bad "term_runtime_cleanup" "snapshot/cidfile/current.env remain"
  else
    ok "term_runtime_cleanup"
  fi
  # Interrupted run must leave failed attempt evidence when storage is writable.
  local attempt="${EVIDENCE}/production/last-attempt.env"
  if [[ -f "$attempt" ]] \
    && [[ "$(read_key "$attempt" STATUS)" == "failed" ]] \
    && [[ "$(read_key "$attempt" ERROR_CODE)" == "INTERRUPTED" ]]; then
    ok "term_evidence_failed"
  else
    bad "term_evidence_failed" "expected STATUS=failed ERROR_CODE=INTERRUPTED"
  fi
  if [[ -f "${EVIDENCE}/production/last-success.env" ]]; then
    bad "term_no_success" "last-success written on interrupt"
  else
    ok "term_no_success"
  fi
}

assert_term_cleanup_residue() {
  local prefix="$1"
  if [[ -d "${STATE}/containers" ]] && compgen -G "${STATE}/containers/*" >/dev/null; then
    bad "${prefix}_cleanup" "container still present"
  else
    ok "${prefix}_cleanup"
  fi
  if compgen -G "${EVIDENCE}/production/runtime/*/dump.snapshot" >/dev/null 2>&1 \
    || compgen -G "${EVIDENCE}/production/runtime/*/container.cid" >/dev/null 2>&1 \
    || [[ -f "${EVIDENCE}/production/runtime/current.env" ]]; then
    bad "${prefix}_runtime_cleanup" "snapshot/cidfile/current.env remain"
  else
    ok "${prefix}_runtime_cleanup"
  fi
  if [[ -f "${EVIDENCE}/production/last-success.env" ]]; then
    bad "${prefix}_no_success" "last-success written on interrupt/fail"
  else
    ok "${prefix}_no_success"
  fi
}

scenario_term_during_restore() {
  case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW*|MSYS*|CYGWIN*)
      skip "term_during_restore" "SIGTERM to blocked child unreliable on Git Bash"
      return
      ;;
  esac
  setup_case hang-on-restore
  make_dump >/dev/null
  set +e
  run_irt_bg production &
  local pid=$!
  local waited=0
  local hang_marker="${STATE}/pg_restore.hanging"
  # Deterministic barrier: fake docker touches this only after entering hung pg_restore.
  while (( waited < 60 )); do
    if [[ -f "$hang_marker" ]]; then
      break
    fi
    sleep 0.5
    waited=$((waited + 1))
  done
  if [[ ! -f "$hang_marker" ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    set -e
    bad "term_during_restore_rc" "pg_restore hang marker never appeared"
    return
  fi
  kill -TERM "$pid" 2>/dev/null || true
  wait "$pid"
  local rc=$?
  set -e
  if [[ "$rc" -eq 50 ]]; then ok "term_during_restore_rc"; else bad "term_during_restore_rc" "rc=$rc"; fi
  local attempt="${EVIDENCE}/production/last-attempt.env"
  if [[ -f "$attempt" ]] \
    && [[ "$(read_key "$attempt" ERROR_CODE)" == "INTERRUPTED" ]] \
    && [[ "$(read_key "$attempt" STATUS)" == "failed" ]]; then
    ok "term_during_restore_evidence"
  else
    bad "term_during_restore_evidence" "expected failed/INTERRUPTED last-attempt"
  fi
  assert_term_cleanup_residue "term_during_restore"
  # Parent script exited; no harness-owned background jobs should remain.
  if [[ -n "$(jobs -p 2>/dev/null || true)" ]]; then
    bad "term_during_restore_jobs" "background jobs remain: $(jobs -p)"
  else
    ok "term_during_restore_jobs"
  fi
}

scenario_term_after_work_ok() {
  case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW*|MSYS*|CYGWIN*)
      skip "term_after_work_ok" "SIGTERM to blocked child unreliable on Git Bash"
      return
      ;;
  esac
  setup_case ok
  make_dump >/dev/null
  export IRT_TEST_PAUSE_AFTER_WORK_OK=1
  set +e
  run_irt_bg production &
  local pid=$!
  local waited=0
  local pause_marker="${EVIDENCE}/production/runtime/.pause-after-work-ok"
  while (( waited < 60 )); do
    if [[ -f "$pause_marker" ]]; then
      break
    fi
    sleep 0.5
    waited=$((waited + 1))
  done
  unset IRT_TEST_PAUSE_AFTER_WORK_OK
  if [[ ! -f "$pause_marker" ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    set -e
    bad "term_after_work_ok_rc" "pause marker never appeared"
    return
  fi
  kill -TERM "$pid" 2>/dev/null || true
  wait "$pid"
  local rc=$?
  set -e
  if [[ "$rc" -eq 50 ]]; then ok "term_after_work_ok_rc"; else bad "term_after_work_ok_rc" "rc=$rc (must not be 0)"; fi
  local attempt="${EVIDENCE}/production/last-attempt.env"
  if [[ -f "$attempt" ]] \
    && [[ "$(read_key "$attempt" STATUS)" == "failed" ]] \
    && [[ "$(read_key "$attempt" ERROR_CODE)" == "INTERRUPTED" ]]; then
    ok "term_after_work_ok_evidence"
  else
    bad "term_after_work_ok_evidence" "expected STATUS=failed ERROR_CODE=INTERRUPTED"
  fi
  assert_term_cleanup_residue "term_after_work_ok"
}

scenario_child_signal_death_one() {
  local mode="$1"
  local tag="$2"
  setup_case "$mode"
  make_dump >/dev/null
  set +e
  run_irt production
  local rc=$?
  set -e
  if [[ "$rc" -eq 50 ]]; then ok "child_signal_death_${tag}_rc"; else bad "child_signal_death_${tag}_rc" "rc=$rc"; fi
  local attempt="${EVIDENCE}/production/last-attempt.env"
  local err status
  err="$(read_key "$attempt" ERROR_CODE 2>/dev/null || true)"
  status="$(read_key "$attempt" STATUS 2>/dev/null || true)"
  if [[ "$status" == "failed" && -n "$err" && "$err" != "INTERRUPTED" ]]; then
    ok "child_signal_death_${tag}_code"
  else
    bad "child_signal_death_${tag}_code" "STATUS=$status ERROR_CODE=$err (must be failed, not INTERRUPTED)"
  fi
  if [[ "$err" == "PG_RESTORE_FAILED" ]]; then
    ok "child_signal_death_${tag}_phase"
  else
    bad "child_signal_death_${tag}_phase" "expected PG_RESTORE_FAILED got=$err"
  fi
  if [[ -d "${STATE}/containers" ]] && compgen -G "${STATE}/containers/*" >/dev/null; then
    bad "child_signal_death_${tag}_cleanup" "container still present"
  else
    ok "child_signal_death_${tag}_cleanup"
  fi
  if [[ -f "${EVIDENCE}/production/last-success.env" ]]; then
    bad "child_signal_death_${tag}_no_success" "last-success written on child signal death"
  else
    ok "child_signal_death_${tag}_no_success"
  fi
}

scenario_child_signal_death() {
  # Child exit 137/143 without parent SIGTERM must stay phase-failed (M3), not INTERRUPTED.
  scenario_child_signal_death_one restore-child-137 137
  scenario_child_signal_death_one restore-child-143 143
}

scenario_rmfail() {
  setup_case rmfail
  make_dump >/dev/null
  set +e
  run_irt production
  local rc=$?
  set -e
  # restore may succeed then cleanup fail → 50
  if [[ "$rc" -eq 50 ]]; then ok "partial_cleanup"; else bad "partial_cleanup" "rc=$rc"; fi
  local attempt="${EVIDENCE}/production/last-attempt.env"
  [[ "$(read_key "$attempt" CLEANUP_OK)" == "0" ]] || bad "partial_cleanup_flag" "CLEANUP_OK not 0"
  [[ ! -f "${EVIDENCE}/production/last-success.env" ]] || [[ "$(read_key "${EVIDENCE}/production/last-success.env" STATUS)" != "success" ]] \
    || true
  # ensure last-success not created as success from this run
  if [[ -f "${EVIDENCE}/production/last-success.env" ]]; then
    bad "partial_cleanup_success" "last-success written on cleanup fail"
  else
    ok "partial_cleanup_no_success"
  fi
}

scenario_lock() {
  setup_case ok
  make_dump >/dev/null
  seed_success production
  export IRT_FAKE_FLOCK_BUSY=1
  set +e
  run_irt production
  local rc=$?
  set -e
  unset IRT_FAKE_FLOCK_BUSY
  if [[ "$rc" -eq 60 ]]; then ok "lock_held"; else bad "lock_held" "rc=$rc"; fi
  [[ "$(read_key "${EVIDENCE}/production/last-success.env" STATUS)" == "success" ]] \
    && ok "lock_preserves_success" \
    || bad "lock_preserves_success" "last-success changed"
}

scenario_evidence_write_fail() {
  setup_case ok
  make_dump >/dev/null
  mkdir -p "${EVIDENCE}/production/history" "${EVIDENCE}/production/runtime"
  # Pre-seed a valid prior success that must remain intact.
  seed_success production
  local prior_sha prior_status
  prior_sha="$(read_key "${EVIDENCE}/production/last-success.env" DUMP_SHA256)"
  prior_status="$(read_key "${EVIDENCE}/production/last-success.env" STATUS)"
  # Make env evidence dir non-writable so last-attempt write fails (Unix).
  chmod 555 "${EVIDENCE}/production" 2>/dev/null || true
  if touch "${EVIDENCE}/production/.writetest" 2>/dev/null; then
    rm -f "${EVIDENCE}/production/.writetest"
    chmod 755 "${EVIDENCE}/production" 2>/dev/null || true
    skip "evidence_write" "cannot make evidence dir non-writable on this host"
    return
  fi
  set +e
  local out
  out="$(run_irt production 2>&1)"
  local rc=$?
  set -e
  chmod 755 "${EVIDENCE}/production" 2>/dev/null || true
  if [[ "$rc" -eq 50 ]]; then ok "evidence_write"; else bad "evidence_write" "rc=$rc"; fi
  echo "$out" | grep -q 'EVIDENCE_WRITE_FAILED\|evidence write failed' \
    && ok "evidence_write_logged" \
    || bad "evidence_write_logged" "no evidence failure log"
  # Prior success must not be clobbered / partially replaced.
  if [[ -f "${EVIDENCE}/production/last-success.env" ]] \
    && [[ "$(read_key "${EVIDENCE}/production/last-success.env" STATUS)" == "$prior_status" ]] \
    && [[ "$(read_key "${EVIDENCE}/production/last-success.env" DUMP_SHA256)" == "$prior_sha" ]]; then
    ok "evidence_preserves_success"
  else
    bad "evidence_preserves_success" "last-success damaged"
  fi
  # No orphan temp publish files in the evidence dir.
  if compgen -G "${EVIDENCE}/production/last-attempt.env.tmp."* >/dev/null 2>&1; then
    bad "evidence_no_tmp" "tmp attempt file left behind"
  else
    ok "evidence_no_tmp"
  fi
}

scenario_success_preserves_on_fail() {
  setup_case restorefail
  make_dump >/dev/null
  seed_success production
  set +e
  run_irt production
  local rc=$?
  set -e
  [[ "$rc" -eq 30 ]] || bad "preserve_fail_rc" "rc=$rc"
  [[ "$(read_key "${EVIDENCE}/production/last-success.env" DUMP_BASENAME)" == "20260720T000000Z_old.dump" ]] \
    && ok "preserves_last_success" \
    || bad "preserves_last_success" "overwritten"
}

scenario_success_ok() {
  setup_case ok
  make_dump >/dev/null
  local out rc
  set +e
  out="$(run_irt production 2>&1)"
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then ok "success"; else bad "success" "rc=$rc"; fi
  local attempt="${EVIDENCE}/production/last-attempt.env"
  local success="${EVIDENCE}/production/last-success.env"
  [[ -f "$attempt" && -f "$success" ]] || { bad "success_evidence" "missing files"; return; }
  [[ "$(read_key "$success" CLEANUP_OK)" == "1" ]] || bad "success_cleanup" "CLEANUP_OK"
  [[ "$(read_key "$success" TEMP_RESOURCES_ABSENT)" == "1" ]] || bad "success_absent" "absent"
  local dur
  dur="$(read_key "$success" DURATION_SEC)"
  if [[ "$dur" =~ ^[0-9]+$ ]] && (( dur >= 0 )); then
    ok "success_duration"
  else
    bad "success_duration" "dur=$dur"
  fi
  if echo "$out" | grep -Eq 'durationSec=-[0-9]'; then
    bad "success_log_duration" "$out"
  else
    ok "success_log_duration"
  fi
  # Log durationSec should match evidence when present.
  local log_dur
  log_dur="$(echo "$out" | sed -n 's/.*durationSec=\([0-9][0-9]*\).*/\1/p' | tail -n1)"
  if [[ -n "$log_dur" && "$log_dur" == "$dur" ]]; then
    ok "success_duration_match"
  elif [[ -n "$log_dur" ]]; then
    # Allow tiny skew only if both non-negative integers (should match exactly).
    bad "success_duration_match" "log=$log_dur evidence=$dur"
  else
    bad "success_duration_match" "no durationSec in log"
  fi
  if grep -Eqi 'password|token|secret|PGPASSWORD' "$success"; then
    bad "success_secrets" "secret-like content"
  else
    ok "success_no_secrets"
  fi
  if [[ -d "${STATE}/containers" ]] && compgen -G "${STATE}/containers/*" >/dev/null; then
    bad "success_docker_left" "container remains"
  else
    ok "success_docker_cleaned"
  fi
}

scenario_toctou() {
  setup_case ok
  local p
  p="$(make_dump)"
  # Race injector: rewrite dump while script copies — use a wrapper by patching PATH with a slow cp?
  # Simpler: after creating snapshot logic, change source before run by injecting via LD — hard.
  # Executable proof: start script in background is hard. Instead call snapshot path by
  # changing file between identity capture using a tiny shim around sha256sum that mutates once.
  mkdir -p "${CASE_DIR}/shim"
  cat >"${CASE_DIR}/shim/sha256sum" <<'EOF'
#!/usr/bin/env bash
# First call: hash normally. Second call (post-copy recheck): mutate source then hash.
COUNTER_FILE="${IRT_TOCTOU_COUNTER}"
SRC_FILE="${IRT_TOCTOU_SRC}"
n=0
if [[ -f "$COUNTER_FILE" ]]; then
  n="$(cat "$COUNTER_FILE")"
fi
n=$((n + 1))
echo "$n" >"$COUNTER_FILE"
if [[ "$n" -eq 2 && -n "$SRC_FILE" && -f "$SRC_FILE" ]]; then
  echo MUTATED >>"$SRC_FILE"
fi
exec /usr/bin/sha256sum "$@"
EOF
  chmod +x "${CASE_DIR}/shim/sha256sum"
  export IRT_TOCTOU_COUNTER="${CASE_DIR}/toctou.n"
  export IRT_TOCTOU_SRC="$p"
  echo 0 >"$IRT_TOCTOU_COUNTER"
  export PATH="${CASE_DIR}/shim:${BIN}:${PATH}"
  set +e
  run_irt production
  local rc=$?
  set -e
  if [[ "$rc" -eq 10 ]]; then ok "toctou_detected"; else bad "toctou_detected" "rc=$rc"; fi
}

scenario_emergency() {
  setup_case ok
  make_dump >/dev/null
  mkdir -p "${EVIDENCE}/production/runtime/deadbeefdeadbeef"
  local cid="abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567"
  mkdir -p "${STATE}/containers/${cid}"
  printf 'oz-rt-production-deadbeefdeadbeef\n' >"${STATE}/containers/${cid}/name"
  printf 'running\n' >"${STATE}/containers/${cid}/status"
  cat >"${STATE}/containers/${cid}/labels" <<EOF
com.online-zapis-tv.component=isolated-restore-test
com.online-zapis-tv.environment=production
com.online-zapis-tv.run-id=deadbeefdeadbeef
EOF
  local cidfile="${EVIDENCE}/production/runtime/deadbeefdeadbeef/container.cid"
  printf '%s' "$cid" >"$cidfile"
  cat >"${EVIDENCE}/production/runtime/current.env" <<EOF
RUN_ID=deadbeefdeadbeef
CIDFILE=${cidfile}
ENVIRONMENT=production
STARTED_AT_EPOCH=$(date +%s)
EOF
  set +e
  bash "$SCRIPT" --emergency-cleanup --environment production --evidence-root "$EVIDENCE"
  local rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then ok "emergency_cleanup"; else bad "emergency_cleanup" "rc=$rc"; fi
  if [[ -d "${STATE}/containers/${cid}" ]]; then
    bad "emergency_absent" "container remains"
  else
    ok "emergency_absent"
  fi
}

scenario_emergency_overrides_old_attempt() {
  # N-01: old last-attempt=success must not hide a new SIGKILL run.
  setup_case ok
  seed_success production aaaaaaaaaaaaaaaa
  local success_before
  success_before="$(cat "${EVIDENCE}/production/last-success.env")"
  local run_b="bbbbbbbbbbbbbbbb"
  local cid="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  mkdir -p "${EVIDENCE}/production/runtime/${run_b}" "${STATE}/containers/${cid}"
  printf 'oz-rt-production-%s\n' "$run_b" >"${STATE}/containers/${cid}/name"
  printf 'running\n' >"${STATE}/containers/${cid}/status"
  cat >"${STATE}/containers/${cid}/labels" <<EOF
com.online-zapis-tv.component=isolated-restore-test
com.online-zapis-tv.environment=production
com.online-zapis-tv.run-id=${run_b}
EOF
  local cidfile="${EVIDENCE}/production/runtime/${run_b}/container.cid"
  printf '%s' "$cid" >"$cidfile"
  local started_epoch
  started_epoch="$(( $(date +%s) - 120 ))"
  cat >"${EVIDENCE}/production/runtime/current.env" <<EOF
RUN_ID=${run_b}
CIDFILE=${cidfile}
ENVIRONMENT=production
STARTED_AT_EPOCH=${started_epoch}
EOF

  set +e
  out="$(bash "$SCRIPT" --emergency-cleanup --environment production --evidence-root "$EVIDENCE" 2>&1)"
  local rc=$?
  set -e
  [[ "$rc" -eq 0 ]] && ok "n01_emergency_rc" || bad "n01_emergency_rc" "rc=$rc"
  [[ ! -d "${STATE}/containers/${cid}" ]] && ok "n01_container_removed" || bad "n01_container_removed" "still present"
  [[ "$(read_key "${EVIDENCE}/production/last-attempt.env" RUN_ID)" == "$run_b" ]] \
    && ok "n01_attempt_run_b" || bad "n01_attempt_run_b" "run=$(read_key "${EVIDENCE}/production/last-attempt.env" RUN_ID)"
  [[ "$(read_key "${EVIDENCE}/production/last-attempt.env" STATUS)" == "failed" ]] \
    && ok "n01_attempt_failed" || bad "n01_attempt_failed" "status"
  [[ "$(read_key "${EVIDENCE}/production/last-attempt.env" CLEANUP_OK)" == "1" ]] \
    && ok "n01_cleanup_ok" || bad "n01_cleanup_ok" "cleanup"
  [[ "$(read_key "${EVIDENCE}/production/last-attempt.env" TEMP_RESOURCES_ABSENT)" == "1" ]] \
    && ok "n01_absent" || bad "n01_absent" "absent"
  local dur
  dur="$(read_key "${EVIDENCE}/production/last-attempt.env" DURATION_SEC)"
  [[ "$dur" =~ ^[0-9]+$ ]] && (( dur >= 0 )) && ok "n01_duration_nonneg" || bad "n01_duration_nonneg" "dur=$dur"
  echo "$out" | grep -Eq 'durationSec=-[0-9]' && bad "n01_log_neg_duration" "$out" || ok "n01_log_nonneg_duration"
  [[ "$(cat "${EVIDENCE}/production/last-success.env")" == "$success_before" ]] \
    && ok "n01_success_unchanged" || bad "n01_success_unchanged" "last-success mutated"
  if compgen -G "${EVIDENCE}/production/history/*${run_b}*emergency_failed.env" >/dev/null; then
    ok "n01_history_b"
  else
    bad "n01_history_b" "no history for B"
  fi

  # IHM with enforce must not report healthy for production restore-test.
  touch "${EVIDENCE}/.enforce"
  mkdir -p "${CASE_DIR}/empty-prod-dumps" "${CASE_DIR}/empty-stg-dumps"
  local ihm_out ihm_rc
  set +e
  ihm_out="$(
    IHM_RESTORE_TEST_EVIDENCE_ROOT="$EVIDENCE" \
    IHM_PROD_BACKUP_DIR="${CASE_DIR}/empty-prod-dumps" \
    IHM_STAGING_BACKUP_DIR="${CASE_DIR}/empty-stg-dumps" \
    bash "${ROOT}/scripts/ops/internal-health-monitor.sh" \
      --state-dir "${CASE_DIR}/ihm-state" --only-restore-test 2>&1
  )"
  ihm_rc=$?
  set -e
  if echo "$ihm_out" | grep -q 'OK production restore-test'; then
    bad "n01_ihm_not_healthy" "$ihm_out"
  else
    ok "n01_ihm_not_healthy"
  fi
  # Expect warning (last attempt failed) or critical (dump linkage); never overall healthy (0).
  [[ "$ihm_rc" -ne 0 ]] && ok "n01_ihm_nonzero" || bad "n01_ihm_nonzero" "rc=$ihm_rc out=$ihm_out"

  # Idempotent second emergency: marker/cid gone → no-op, last-attempt stays B.
  set +e
  bash "$SCRIPT" --emergency-cleanup --environment production --evidence-root "$EVIDENCE" >/dev/null 2>&1
  rc=$?
  set -e
  [[ "$rc" -eq 0 ]] && ok "n01_emergency_idempotent" || bad "n01_emergency_idempotent" "rc=$rc"
  [[ "$(read_key "${EVIDENCE}/production/last-attempt.env" RUN_ID)" == "$run_b" ]] \
    && ok "n01_attempt_stable" || bad "n01_attempt_stable" "changed"
}

scenario_emergency_symlink_cidfile() {
  # L-01: marker CIDFILE may be a symlink; snapshot cleanup must use canonical run-dir.
  # Static assertions always run; runtime symlink semantics may SKIP on Windows/Git Bash.
  if grep -Eq 'run_dir="\$\(dirname -- "\$resolved"\)"' "$SCRIPT" \
    && ! grep -Eq 'run_dir="\$\(dirname -- "\$cidfile"\)"' "$SCRIPT"; then
    ok "l01_static_resolved_dirname"
  else
    bad "l01_static_resolved_dirname" "emergency cleanup still derives run_dir from raw cidfile"
  fi
  if grep -Eq 'basename -- "\$run_dir"\)" != "\$run_id"' "$SCRIPT" \
    && grep -Eq 'basename -- "\$resolved"\)" != "container\.cid"' "$SCRIPT"; then
    ok "l01_static_run_dir_contract"
  else
    bad "l01_static_run_dir_contract" "missing runtime/<run-id>/container.cid checks"
  fi

  setup_case ok
  local run_b="dddddddddddddddd"
  local other_run="eeeeeeeeeeeeeeee"
  local cid="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  local foreign_cid="ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  local real_run_dir link_dir link_cidfile resolved_check decoy_snapshot foreign_keep other_keep

  mkdir -p "${EVIDENCE}/production/runtime/${run_b}" \
    "${EVIDENCE}/production/runtime/${other_run}" \
    "${STATE}/containers/${cid}" \
    "${STATE}/containers/${foreign_cid}"

  printf 'oz-rt-production-%s\n' "$run_b" >"${STATE}/containers/${cid}/name"
  printf 'running\n' >"${STATE}/containers/${cid}/status"
  cat >"${STATE}/containers/${cid}/labels" <<EOF
com.online-zapis-tv.component=isolated-restore-test
com.online-zapis-tv.environment=production
com.online-zapis-tv.run-id=${run_b}
EOF
  # Foreign owned-looking container of another RUN_ID — must survive.
  printf 'oz-rt-production-%s\n' "$other_run" >"${STATE}/containers/${foreign_cid}/name"
  printf 'running\n' >"${STATE}/containers/${foreign_cid}/status"
  cat >"${STATE}/containers/${foreign_cid}/labels" <<EOF
com.online-zapis-tv.component=isolated-restore-test
com.online-zapis-tv.environment=production
com.online-zapis-tv.run-id=${other_run}
EOF

  real_run_dir="${EVIDENCE}/production/runtime/${run_b}"
  printf '%s' "$cid" >"${real_run_dir}/container.cid"
  printf 'CANONICAL-SNAPSHOT-PAYLOAD\n' >"${real_run_dir}/dump.snapshot"
  printf 'keep-other-run\n' >"${EVIDENCE}/production/runtime/${other_run}/keep.txt"
  other_keep="${EVIDENCE}/production/runtime/${other_run}/keep.txt"
  foreign_keep="${EVIDENCE}/production/runtime/foreign-keep.txt"
  printf 'foreign-root-keep\n' >"$foreign_keep"

  link_dir="${CASE_DIR}/cid-symlink-dir"
  mkdir -p "$link_dir"
  link_cidfile="${link_dir}/container.cid"
  decoy_snapshot="${link_dir}/dump.snapshot"
  printf 'DECOY-MUST-REMAIN\n' >"$decoy_snapshot"

  if ! ln -s "${real_run_dir}/container.cid" "$link_cidfile" 2>/dev/null; then
    skip "l01_symlink_cidfile" "cannot create symlink on this host — required on Linux"
    return 0
  fi
  if [[ ! -L "$link_cidfile" ]]; then
    skip "l01_symlink_cidfile" "created path is not a symlink — required on Linux"
    return 0
  fi
  if command -v realpath >/dev/null 2>&1; then
    resolved_check="$(realpath -e -- "$link_cidfile" 2>/dev/null || true)"
  else
    resolved_check="$(readlink -f -- "$link_cidfile" 2>/dev/null || true)"
  fi
  # Canonical target must be the real runtime cidfile (not the symlink dirname).
  if [[ -z "$resolved_check" || "$resolved_check" != "${real_run_dir}/container.cid" ]]; then
    # Some Windows/Git Bash builds resolve or copy differently — do not mask as PASS.
    skip "l01_symlink_cidfile" "symlink realpath semantics unreliable on this host (resolved=${resolved_check:-empty}) — required on Linux"
    return 0
  fi

  # dirname(symlink) must differ from canonical run-dir (otherwise the regression is untestable).
  [[ "$(dirname -- "$link_cidfile")" != "$real_run_dir" ]] \
    && ok "l01_symlink_dirname_differs" \
    || bad "l01_symlink_dirname_differs" "symlink dirname unexpectedly equals run-dir"

  cat >"${EVIDENCE}/production/runtime/current.env" <<EOF
RUN_ID=${run_b}
CIDFILE=${link_cidfile}
ENVIRONMENT=production
STARTED_AT_EPOCH=$(( $(date +%s) - 90 ))
EOF

  set +e
  bash "$SCRIPT" --emergency-cleanup --environment production --evidence-root "$EVIDENCE" >/dev/null 2>&1
  local rc=$?
  set -e

  [[ "$rc" -eq 0 ]] && ok "l01_emergency_rc" || bad "l01_emergency_rc" "rc=$rc"
  [[ ! -e "${real_run_dir}/dump.snapshot" ]] && ok "l01_snapshot_removed" || bad "l01_snapshot_removed" "canonical snapshot remains"
  [[ -f "$decoy_snapshot" ]] && ok "l01_decoy_snapshot_kept" || bad "l01_decoy_snapshot_kept" "symlink-dir decoy deleted"
  [[ -f "$other_keep" ]] && ok "l01_other_run_kept" || bad "l01_other_run_kept" "other run-dir touched"
  [[ -f "$foreign_keep" ]] && ok "l01_foreign_file_kept" || bad "l01_foreign_file_kept" "runtime foreign file deleted"
  [[ ! -d "${STATE}/containers/${cid}" ]] && ok "l01_owned_container_removed" || bad "l01_owned_container_removed" "target remains"
  [[ -d "${STATE}/containers/${foreign_cid}" ]] && ok "l01_foreign_container_kept" || bad "l01_foreign_container_kept" "foreign RUN_ID removed"
  [[ "$(read_key "${EVIDENCE}/production/last-attempt.env" RUN_ID)" == "$run_b" ]] \
    && ok "l01_attempt_run_id" || bad "l01_attempt_run_id" "run=$(read_key "${EVIDENCE}/production/last-attempt.env" RUN_ID)"
  [[ "$(read_key "${EVIDENCE}/production/last-attempt.env" STATUS)" == "failed" ]] \
    && ok "l01_attempt_failed" || bad "l01_attempt_failed" "status"
  [[ "$(read_key "${EVIDENCE}/production/last-attempt.env" SNAPSHOT_ABSENT)" == "1" ]] \
    && ok "l01_snapshot_absent" || bad "l01_snapshot_absent" "flag"
  [[ "$(read_key "${EVIDENCE}/production/last-attempt.env" TEMP_RESOURCES_ABSENT)" == "1" ]] \
    && ok "l01_temp_absent" || bad "l01_temp_absent" "flag"
  [[ "$(read_key "${EVIDENCE}/production/last-attempt.env" CLEANUP_OK)" == "1" ]] \
    && ok "l01_cleanup_ok" || bad "l01_cleanup_ok" "cleanup"
  if compgen -G "${EVIDENCE}/production/history/*${run_b}*emergency_failed.env" >/dev/null; then
    ok "l01_history_run_id"
  else
    bad "l01_history_run_id" "missing history"
  fi

  # Idempotent second pass (marker/cid gone).
  set +e
  bash "$SCRIPT" --emergency-cleanup --environment production --evidence-root "$EVIDENCE" >/dev/null 2>&1
  rc=$?
  set -e
  [[ "$rc" -eq 0 ]] && ok "l01_idempotent" || bad "l01_idempotent" "rc=$rc"
  [[ -f "$decoy_snapshot" && -f "$other_keep" && -f "$foreign_keep" ]] \
    && ok "l01_idempotent_no_collateral" || bad "l01_idempotent_no_collateral" "collateral delete on retry"
}

scenario_emergency_same_run_finalized_noop() {
  # N-01 negative: last-attempt already finalized for same RUN_ID → no rewrite.
  setup_case ok
  local run_b="cccccccccccccccc"
  seed_success production "$run_b"
  # Overwrite attempt as failed finalized for same run (as if main finalizer wrote it).
  cat >"${EVIDENCE}/production/last-attempt.env" <<EOF
SCHEMA_VERSION=1
ENVIRONMENT=production
STATUS=failed
ERROR_CODE=INTERRUPTED
STARTED_AT_UTC=2026-07-26T00:00:00Z
FINISHED_AT_UTC=2026-07-26T00:01:00Z
DURATION_SEC=60
RUN_ID=${run_b}
CLEANUP_OK=1
TEMP_RESOURCES_ABSENT=1
SNAPSHOT_ABSENT=1
USER_TABLE_COUNT=0
INTEGRITY_OK=0
EOF
  local attempt_before
  attempt_before="$(cat "${EVIDENCE}/production/last-attempt.env")"
  local success_before
  success_before="$(cat "${EVIDENCE}/production/last-success.env")"
  local cid="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  mkdir -p "${EVIDENCE}/production/runtime/${run_b}" "${STATE}/containers/${cid}"
  # Container already gone — only leftover marker/cidfile (post-cleanup finalize race).
  local cidfile="${EVIDENCE}/production/runtime/${run_b}/container.cid"
  printf '%s' "$cid" >"$cidfile"
  # Do not create container dir — already absent.
  rmdir "${STATE}/containers/${cid}" 2>/dev/null || rm -rf "${STATE}/containers/${cid}"
  cat >"${EVIDENCE}/production/runtime/current.env" <<EOF
RUN_ID=${run_b}
CIDFILE=${cidfile}
ENVIRONMENT=production
STARTED_AT_EPOCH=$(date +%s)
EOF
  set +e
  bash "$SCRIPT" --emergency-cleanup --environment production --evidence-root "$EVIDENCE" >/dev/null 2>&1
  local rc=$?
  set -e
  [[ "$rc" -eq 0 ]] && ok "n01_same_run_noop_rc" || bad "n01_same_run_noop_rc" "rc=$rc"
  [[ "$(cat "${EVIDENCE}/production/last-attempt.env")" == "$attempt_before" ]] \
    && ok "n01_same_run_attempt_preserved" || bad "n01_same_run_attempt_preserved" "rewritten"
  [[ "$(cat "${EVIDENCE}/production/last-success.env")" == "$success_before" ]] \
    && ok "n01_same_run_success_preserved" || bad "n01_same_run_success_preserved" "rewritten"
}

scenario_reaper() {
  setup_case ok
  # old stopped labeled
  local old="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  mkdir -p "${STATE}/containers/${old}"
  printf 'oz-rt-production-aaaaaaaaaaaaaaaa\n' >"${STATE}/containers/${old}/name"
  printf 'exited\n' >"${STATE}/containers/${old}/status"
  date -u -d '10 hours ago' +%Y-%m-%dT%H:%M:%SZ >"${STATE}/containers/${old}/created" 2>/dev/null \
    || printf '2026-01-01T00:00:00Z\n' >"${STATE}/containers/${old}/created"
  cat >"${STATE}/containers/${old}/labels" <<EOF
com.online-zapis-tv.component=isolated-restore-test
com.online-zapis-tv.environment=production
com.online-zapis-tv.run-id=aaaaaaaaaaaaaaaa
EOF
  # young stopped
  local young="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  mkdir -p "${STATE}/containers/${young}"
  printf 'oz-rt-production-bbbbbbbbbbbbbbbb\n' >"${STATE}/containers/${young}/name"
  printf 'exited\n' >"${STATE}/containers/${young}/status"
  date -u +%Y-%m-%dT%H:%M:%SZ >"${STATE}/containers/${young}/created"
  cat >"${STATE}/containers/${young}/labels" <<EOF
com.online-zapis-tv.component=isolated-restore-test
com.online-zapis-tv.environment=production
com.online-zapis-tv.run-id=bbbbbbbbbbbbbbbb
EOF
  # running
  local run="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  mkdir -p "${STATE}/containers/${run}"
  printf 'oz-rt-production-cccccccccccccccc\n' >"${STATE}/containers/${run}/name"
  printf 'running\n' >"${STATE}/containers/${run}/status"
  date -u -d '10 hours ago' +%Y-%m-%dT%H:%M:%SZ >"${STATE}/containers/${run}/created" 2>/dev/null \
    || printf '2026-01-01T00:00:00Z\n' >"${STATE}/containers/${run}/created"
  cat >"${STATE}/containers/${run}/labels" <<EOF
com.online-zapis-tv.component=isolated-restore-test
com.online-zapis-tv.environment=production
com.online-zapis-tv.run-id=cccccccccccccccc
EOF
  # wrong label
  local wrong="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  mkdir -p "${STATE}/containers/${wrong}"
  printf 'oz-rt-production-dddddddddddddddd\n' >"${STATE}/containers/${wrong}/name"
  printf 'exited\n' >"${STATE}/containers/${wrong}/status"
  date -u -d '10 hours ago' +%Y-%m-%dT%H:%M:%SZ >"${STATE}/containers/${wrong}/created" 2>/dev/null \
    || printf '2026-01-01T00:00:00Z\n' >"${STATE}/containers/${wrong}/created"
  cat >"${STATE}/containers/${wrong}/labels" <<EOF
com.online-zapis-tv.component=other
com.online-zapis-tv.environment=production
com.online-zapis-tv.run-id=dddddddddddddddd
EOF
  # working container name must never appear as delete target — create decoy without labels
  local work="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  mkdir -p "${STATE}/containers/${work}"
  printf 'tvoe-vremya-production-postgres\n' >"${STATE}/containers/${work}/name"
  printf 'exited\n' >"${STATE}/containers/${work}/status"
  date -u -d '10 hours ago' +%Y-%m-%dT%H:%M:%SZ >"${STATE}/containers/${work}/created" 2>/dev/null \
    || printf '2026-01-01T00:00:00Z\n' >"${STATE}/containers/${work}/created"

  bash "$SCRIPT" --reap-orphans --environment production --evidence-root "$EVIDENCE"
  [[ ! -d "${STATE}/containers/${old}" ]] && ok "reaper_old_removed" || bad "reaper_old_removed" "still there"
  [[ -d "${STATE}/containers/${young}" ]] && ok "reaper_young_kept" || bad "reaper_young_kept" "removed"
  [[ -d "${STATE}/containers/${run}" ]] && ok "reaper_running_kept" || bad "reaper_running_kept" "removed"
  [[ -d "${STATE}/containers/${wrong}" ]] && ok "reaper_wrong_label_kept" || bad "reaper_wrong_label_kept" "removed"
  [[ -d "${STATE}/containers/${work}" ]] && ok "reaper_workdir_kept" || bad "reaper_workdir_kept" "removed"
}

scenario_forbidden_mutate() {
  export IRT_SKIP_FORBIDDEN_CHECK=0
  setup_case forbidden-mutate
  make_dump >/dev/null
  # Mutate mid-run via shim on docker exec first pg_isready — touch flag after inspect pre
  # Simpler: run with MODE that flips after first forbidden snapshot. Use wrapper docker.
  cat >"${BIN}/docker" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export FAKE_DOCKER_STATE="$STATE"
export FAKE_DOCKER_MODE="forbidden-mutate"
if [[ "\${1-}" == "exec" ]]; then
  touch "${STATE}/forbidden-mutated"
fi
exec bash "$FAKE_SRC" "\$@"
EOF
  chmod +x "${BIN}/docker"
  set +e
  run_irt production
  local rc=$?
  set -e
  if [[ "$rc" -eq 80 ]]; then ok "forbidden_changed"; else bad "forbidden_changed" "rc=$rc"; fi
  export IRT_SKIP_FORBIDDEN_CHECK=1
}

# notready with override: patch common via env if we add it
ensure_ready_timeout_override() {
  # Inject by exporting — add to common if missing
  :
}

main() {
  echo "=== isolated-restore-test behavioral harness ==="
  scenario_dump_missing
  scenario_dump_stale
  scenario_dump_unreadable
  scenario_noimage
  scenario_notready
  scenario_restorefail
  scenario_integrityfail
  scenario_term
  scenario_term_during_restore
  scenario_term_after_work_ok
  scenario_child_signal_death
  scenario_rmfail
  scenario_lock
  scenario_success_preserves_on_fail
  scenario_evidence_write_fail
  scenario_success_ok
  scenario_toctou
  scenario_emergency
  scenario_emergency_overrides_old_attempt
  scenario_emergency_same_run_finalized_noop
  scenario_emergency_symlink_cidfile
  scenario_reaper
  scenario_forbidden_mutate

  echo "=== summary PASS=${PASS} FAIL=${FAIL} SKIP=${SKIP} ==="
  if [[ "$FAIL" -gt 0 ]]; then
    exit 1
  fi
  exit 0
}

main "$@"
