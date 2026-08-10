#!/usr/bin/env bash
# Internal health monitor v1 (simple): read-only host checks for staging + production.
# Detect and journal only. Optional Telegram notify after the result (never remediates).
set -Eeuo pipefail

readonly IHM_SELF_UNIT="online-zapis-tv-internal-health-monitor.service"
readonly IHM_STATE_DIR_DEFAULT="/var/lib/online-zapis-tv/health-monitor"
readonly IHM_LOCK_NAME="run.lock"
readonly IHM_JOURNAL_NAME="journal.jsonl"
readonly IHM_TELEGRAM_STATE_NAME="telegram-notify-state.json"
readonly IHM_TELEGRAM_CONFIG_DEFAULT="/etc/online-zapis-tv/health-monitor.env"
readonly IHM_N8N_TARGETS_DEFAULT="/etc/online-zapis-tv/health-monitor-targets.env"
readonly IHM_N8N_STATE_NAME="n8n-external-probe-state.json"
readonly IHM_N8N_TIMEOUT_DEFAULT=10
readonly IHM_N8N_FAILURE_THRESHOLD_DEFAULT=2
readonly IHM_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly IHM_TELEGRAM_NOTIFIER="${IHM_SCRIPT_DIR}/internal-health-monitor-telegram.py"

readonly IHM_DISK_WARN_PERCENT=75
readonly IHM_DISK_CRIT_PERCENT=90
readonly IHM_INODE_WARN_PERCENT=80
readonly IHM_INODE_CRIT_PERCENT=95
readonly IHM_BACKUP_MAX_AGE_HOURS=30
# Restore-test freshness thresholds: single policy file (fail closed if missing).
IHM_IRT_POLICY=""
for IHM_IRT_POLICY_CANDIDATE in \
  "${IHM_SCRIPT_DIR}/lib/isolated-restore-test-policy.sh" \
  "/usr/local/lib/online-zapis-tv/lib/isolated-restore-test-policy.sh"
do
  if [[ -f "$IHM_IRT_POLICY_CANDIDATE" && -r "$IHM_IRT_POLICY_CANDIDATE" ]]; then
    IHM_IRT_POLICY="$IHM_IRT_POLICY_CANDIDATE"
    break
  fi
done
if [[ -z "$IHM_IRT_POLICY" ]]; then
  echo "ERROR: isolated-restore-test policy file missing" >&2
  exit 30
fi
# shellcheck source=lib/isolated-restore-test-policy.sh
source "$IHM_IRT_POLICY"
# Evidence/backup roots are overridable for local harness only (units never set these).
IHM_RESTORE_TEST_EVIDENCE_ROOT="${IHM_RESTORE_TEST_EVIDENCE_ROOT:-/var/lib/online-zapis-tv/restore-test}"
readonly IHM_RESTORE_TEST_ENFORCE_MARKER=".enforce"
readonly IHM_HTTP_TIMEOUT_SEC=10
readonly IHM_PG_RESTORE_TIMEOUT_SEC=20
readonly IHM_PG_VERIFY_IMAGE="postgres:17-alpine"
readonly IHM_DUMP_NAME_RE='^[0-9]{8}T[0-9]{6}Z_[A-Za-z0-9._-]+\.dump$'

readonly IHM_PROD_APP="tvoe-vremya-production-app"
readonly IHM_PROD_PG="tvoe-vremya-production-postgres"
readonly IHM_STAGING_APP="tvoe-vremya-staging-app"
readonly IHM_STAGING_PG="tvoe-vremya-staging-postgres"

readonly IHM_PROD_HEALTH_URL="http://127.0.0.1:3100/api/health"
readonly IHM_STAGING_HEALTH_URL="http://127.0.0.1:3000/api/health"

readonly IHM_PROD_CHECKOUT="/opt/online-zapis-tv-production"
readonly IHM_STAGING_CHECKOUT="/opt/online-zapis-tv"
IHM_PROD_BACKUP_DIR="${IHM_PROD_BACKUP_DIR:-/opt/online-zapis-tv-production/backups/production/postgres}"
IHM_STAGING_BACKUP_DIR="${IHM_STAGING_BACKUP_DIR:-/opt/online-zapis-tv/backups/postgres}"

readonly IHM_PROD_BACKUP_TIMER="online-zapis-tv-production-backup.timer"
readonly IHM_PROD_BACKUP_SERVICE="online-zapis-tv-production-backup.service"
readonly IHM_STAGING_BACKUP_TIMER="online-zapis-tv-staging-backup.timer"
readonly IHM_STAGING_BACKUP_SERVICE="online-zapis-tv-staging-backup.service"

IHM_STATE_DIR="${IHM_STATE_DIR_DEFAULT}"
IHM_TELEGRAM_CONFIG="${IHM_TELEGRAM_CONFIG:-$IHM_TELEGRAM_CONFIG_DEFAULT}"
IHM_TELEGRAM_DRY_RUN_DIR="${IHM_TELEGRAM_DRY_RUN_DIR:-}"
# Optional override for local harness; units never set this.
IHM_N8N_TARGETS_FILE="${IHM_N8N_TARGETS_FILE:-$IHM_N8N_TARGETS_DEFAULT}"
# Test-only mock: "liveness:200:40,readiness:200:50" or classes timeout|tls|transport.
# When set, no real network probe is performed.
IHM_N8N_PROBE_MOCK="${IHM_N8N_PROBE_MOCK:-}"
IHM_FIXTURE=""
IHM_HELP=0
IHM_SKIP_TELEGRAM=0
IHM_ONLY_RESTORE_TEST=0
IHM_ONLY_N8N_EXTERNAL=0
# Sticky: set only by --only-n8n-external parse; never read from env. Gates harness PATH curl.
IHM_N8N_HARNESS_ENTRY=0

IHM_OVERALL="healthy"
IHM_FAIL_COUNT=0
IHM_PROBLEM_CODES=()
IHM_CHECK_RECORDS=()
IHM_COMMIT_PROD="unknown"
IHM_COMMIT_STAGING="unknown"

usage() {
  cat <<'EOF'
Usage: internal-health-monitor.sh [--help] [--state-dir PATH] [--fixture MODE]

Read-only host health monitor for staging + production on one Ubuntu host.
Writes a human summary to stdout (journald) and one JSONL line to the state dir.

Options:
  --help              Show help
  --state-dir PATH    State directory (default: /var/lib/online-zapis-tv/health-monitor)
  --fixture MODE      Local fixture without Docker/systemd:
                      healthy | warning | critical | technical_error |
                      restore_test_not_enforced
                      (skips Telegram notify)
  --only-restore-test Run only isolated restore-test evidence checks (harness/tests)
  --only-n8n-external Run only config-driven n8n HTTPS probes (harness/tests)

Exit codes:
  0   healthy
  10  warning
  20  critical
  30  technical_error

This script never restarts containers, restores databases, migrates, or prunes Docker.
Optional Telegram notifications may be sent after the health result (detect only; no auto-fix).
Independent n8n HTTPS probing is optional and config-driven; n8n is never its own only monitor.
EOF
}

die_usage() {
  echo "ERROR: $*" >&2
  usage >&2
  exit 30
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --help|-h)
        IHM_HELP=1
        ;;
      --state-dir)
        shift
        [[ $# -gt 0 ]] || die_usage "--state-dir requires a path"
        IHM_STATE_DIR="$1"
        ;;
      --fixture)
        shift
        [[ $# -gt 0 ]] || die_usage "--fixture requires a mode"
        IHM_FIXTURE="$1"
        ;;
      --only-restore-test)
        IHM_ONLY_RESTORE_TEST=1
        ;;
      --only-n8n-external)
        IHM_ONLY_N8N_EXTERNAL=1
        IHM_N8N_HARNESS_ENTRY=1
        ;;
      *)
        die_usage "unknown argument: $1"
        ;;
    esac
    shift
  done
}

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

rank_of() {
  case "$1" in
    healthy) echo 0 ;;
    warning) echo 1 ;;
    critical) echo 2 ;;
    technical_error) echo 3 ;;
    *) echo 3 ;;
  esac
}

raise_overall() {
  local next="$1"
  local cur_rank next_rank
  cur_rank="$(rank_of "$IHM_OVERALL")"
  next_rank="$(rank_of "$next")"
  if (( next_rank > cur_rank )); then
    IHM_OVERALL="$next"
  fi
}

record_problem() {
  local code="$1"
  local existing
  for existing in "${IHM_PROBLEM_CODES[@]+"${IHM_PROBLEM_CODES[@]}"}"; do
    if [[ "$existing" == "$code" ]]; then
      return
    fi
  done
  IHM_PROBLEM_CODES+=("$code")
}

emit_check() {
  local level="$1"
  local label="$2"
  local detail="${3:-}"
  local code="${4:-}"
  local line

  case "$level" in
    healthy)
      line="OK ${label}"
      [[ -n "$detail" ]] && line="${line} ${detail}"
      echo "$line"
      ;;
    not_enforced|info)
      # Neutral / informational: not a pass-as-healthy claim, not a fail, no Telegram escalation.
      line="INFO ${label}"
      [[ -n "$detail" ]] && line="${line}: ${detail}"
      echo "$line"
      ;;
    warning)
      IHM_FAIL_COUNT=$((IHM_FAIL_COUNT + 1))
      line="WARN ${label}"
      [[ -n "$detail" ]] && line="${line}: ${detail}"
      echo "$line"
      raise_overall warning
      [[ -n "$code" ]] && record_problem "$code"
      ;;
    critical|technical_error)
      IHM_FAIL_COUNT=$((IHM_FAIL_COUNT + 1))
      line="FAIL ${label}"
      [[ -n "$detail" ]] && line="${line}: ${detail}"
      echo "$line"
      raise_overall "$level"
      [[ -n "$code" ]] && record_problem "$code"
      ;;
  esac

  IHM_CHECK_RECORDS+=("${level}"$'\t'"${label}"$'\t'"${code}"$'\t'"${detail}")
}

check_docker_container() {
  local name="$1"
  local label="$2"
  local running health oom

  if ! docker inspect "$name" >/dev/null 2>&1; then
    emit_check critical "docker ${label}" "missing" "DOCKER_MISSING"
    return
  fi

  running="$(docker inspect --format '{{if .State.Running}}true{{else}}false{{end}}' "$name" 2>/dev/null || echo error)"
  if [[ "$running" == "error" ]]; then
    emit_check technical_error "docker ${label}" "inspect failed" "DOCKER_INSPECT_ERROR"
    return
  fi
  if [[ "$running" != "true" ]]; then
    emit_check critical "docker ${label}" "not running" "DOCKER_NOT_RUNNING"
    return
  fi

  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || echo error)"
  oom="$(docker inspect --format '{{if .State.OOMKilled}}true{{else}}false{{end}}' "$name" 2>/dev/null || echo error)"

  if [[ "$health" == "error" || "$oom" == "error" ]]; then
    emit_check technical_error "docker ${label}" "inspect failed" "DOCKER_INSPECT_ERROR"
    return
  fi
  if [[ "$oom" == "true" ]]; then
    emit_check critical "docker ${label}" "OOMKilled" "DOCKER_OOM"
    return
  fi
  if [[ "$health" != "none" && "$health" != "healthy" ]]; then
    emit_check critical "docker ${label}" "health=${health}" "DOCKER_UNHEALTHY"
    return
  fi

  emit_check healthy "docker ${label}"
}

check_http_health() {
  local url="$1"
  local label="$2"
  local body_file http_code

  body_file="$(mktemp)"

  http_code="$(curl \
    --silent \
    --show-error \
    --max-time "$IHM_HTTP_TIMEOUT_SEC" \
    --no-location \
    --output "$body_file" \
    --write-out '%{http_code}' \
    "$url" 2>/dev/null || true)"

  if [[ ! "$http_code" =~ ^[0-9]+$ ]] || [[ "$http_code" -eq 000 ]]; then
    rm -f "$body_file"
    emit_check critical "http ${label}" "request failed" "HTTP_REQUEST_FAILED"
    return
  fi
  if [[ "$http_code" -ne 200 ]]; then
    rm -f "$body_file"
    emit_check critical "http ${label}" "http=${http_code}" "HTTP_STATUS"
    return
  fi

  if ! grep -qE '"ok"[[:space:]]*:[[:space:]]*true' "$body_file"; then
    rm -f "$body_file"
    emit_check critical "http ${label}" "payload not healthy" "HTTP_PAYLOAD"
    return
  fi
  if ! grep -qE '"status"[[:space:]]*:[[:space:]]*"healthy"' "$body_file"; then
    rm -f "$body_file"
    emit_check critical "http ${label}" "payload not healthy" "HTTP_PAYLOAD"
    return
  fi

  rm -f "$body_file"
  emit_check healthy "http ${label}"
}

df_percent() {
  local path="$1"
  local mode="$2"
  if [[ "$mode" == "inode" ]]; then
    df -Pi "$path" 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}'
  else
    df -P "$path" 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}'
  fi
}

check_disk_root() {
  local used
  used="$(df_percent / space || true)"
  if [[ ! "$used" =~ ^[0-9]+$ ]]; then
    emit_check technical_error "disk /" "df failed" "DISK_DF_ERROR"
    return
  fi
  if (( used >= IHM_DISK_CRIT_PERCENT )); then
    emit_check critical "disk /" "usedPercent=${used}" "DISK_USAGE_CRITICAL"
    return
  fi
  if (( used >= IHM_DISK_WARN_PERCENT )); then
    emit_check warning "disk /" "usedPercent=${used}" "DISK_USAGE_WARNING"
    return
  fi
  emit_check healthy "disk /" "usedPercent=${used}"
}

check_inode_root() {
  local used
  used="$(df_percent / inode || true)"
  if [[ ! "$used" =~ ^[0-9]+$ ]]; then
    emit_check technical_error "inodes /" "df -i failed" "INODE_DF_ERROR"
    return
  fi
  if (( used >= IHM_INODE_CRIT_PERCENT )); then
    emit_check critical "inodes /" "usedPercent=${used}" "INODE_USAGE_CRITICAL"
    return
  fi
  if (( used >= IHM_INODE_WARN_PERCENT )); then
    emit_check warning "inodes /" "usedPercent=${used}" "INODE_USAGE_WARNING"
    return
  fi
  emit_check healthy "inodes /" "usedPercent=${used}"
}

check_failed_units() {
  local raw names filtered compact
  if ! raw="$(systemctl --failed --no-legend --plain 2>/dev/null)"; then
    emit_check technical_error "systemd failed units" "systemctl --failed failed" "SYSTEMD_FAILED_QUERY"
    return
  fi

  names="$(awk '{print $1}' <<<"$raw" | sed '/^$/d' || true)"
  filtered="$(grep -vFx "$IHM_SELF_UNIT" <<<"$names" || true)"
  if [[ -n "${filtered//[[:space:]]/}" ]]; then
    compact="$(tr '\n' ' ' <<<"$filtered" | sed 's/[[:space:]]*$//')"
    emit_check critical "systemd failed units" "${compact}" "UNIT_FAILED"
    return
  fi
  emit_check healthy "systemd failed units"
}

check_backup_timer() {
  local timer="$1"
  local service="$2"
  local label="$3"
  local load_state active_state unit_file_state next result exec_status

  load_state="$(systemctl show -p LoadState --value "$timer" 2>/dev/null || echo error)"
  if [[ "$load_state" != "loaded" ]]; then
    emit_check critical "${label} backup timer" "missing or not loaded" "BACKUP_TIMER_MISSING"
    return
  fi

  active_state="$(systemctl show -p ActiveState --value "$timer" 2>/dev/null || echo error)"
  unit_file_state="$(systemctl show -p UnitFileState --value "$timer" 2>/dev/null || echo error)"
  next="$(systemctl show -p NextElapseUSecRealtime --value "$timer" 2>/dev/null || true)"
  if [[ -z "$next" || "$next" == "0" || "$next" == "n/a" ]]; then
    next="$(systemctl show -p NextElapseUSecMonotonic --value "$timer" 2>/dev/null || true)"
  fi

  if [[ "$active_state" != "active" ]]; then
    emit_check critical "${label} backup timer" "active=${active_state}" "BACKUP_TIMER_INACTIVE"
    return
  fi
  if [[ "$unit_file_state" != "enabled" && "$unit_file_state" != "enabled-runtime" ]]; then
    emit_check critical "${label} backup timer" "enabled=${unit_file_state}" "BACKUP_TIMER_DISABLED"
    return
  fi
  if [[ -z "$next" || "$next" == "0" || "$next" == "n/a" ]]; then
    emit_check critical "${label} backup timer" "next run unknown" "BACKUP_TIMER_NO_NEXT"
    return
  fi

  result="$(systemctl show -p Result --value "$service" 2>/dev/null || echo error)"
  exec_status="$(systemctl show -p ExecMainStatus --value "$service" 2>/dev/null || echo error)"
  if [[ "$result" == "error" || "$exec_status" == "error" ]]; then
    emit_check technical_error "${label} backup timer" "service status query failed" "BACKUP_SERVICE_QUERY"
    return
  fi
  if [[ "$result" == "failed" || ( "$exec_status" =~ ^[0-9]+$ && "$exec_status" -ne 0 ) ]]; then
    emit_check critical "${label} backup timer" "last service result=${result} status=${exec_status}" "BACKUP_SERVICE_FAILED"
    return
  fi

  emit_check healthy "${label} backup timer"
}

newest_matching_dump() {
  local dir="$1"
  local best="" best_prefix="" name prefix

  shopt -s nullglob
  for path in "${dir}"/*.dump; do
    name="$(basename "$path")"
    if [[ ! "$name" =~ $IHM_DUMP_NAME_RE ]]; then
      continue
    fi
    prefix="${name%%_*}"
    if [[ -z "$best_prefix" || "$prefix" > "$best_prefix" ]]; then
      best_prefix="$prefix"
      best="$path"
    fi
  done
  shopt -u nullglob
  printf '%s' "$best"
}

dump_age_hours() {
  local path="$1"
  local name prefix epoch now
  name="$(basename "$path")"
  prefix="${name%%_*}"
  if ! epoch="$(date -u -d "${prefix:0:4}-${prefix:4:2}-${prefix:6:2}T${prefix:9:2}:${prefix:11:2}:${prefix:13:2}Z" +%s 2>/dev/null)"; then
    echo ""
    return 1
  fi
  now="$(date -u +%s)"
  echo $(( (now - epoch) / 3600 ))
}

IHM_PG_RESTORE_ATTEMPTS_USED=0
IHM_PG_RESTORE_LAST_RC=0
IHM_PG_RESTORE_LAST_ERROR=""
IHM_PG_RESTORE_TOTAL_DURATION_SEC=0

verify_dump_readable() {
  local path="$1"
  local max_attempts=3
  local retry_delay_sec=2
  local attempt rc err_file err_text started finished container_name

  IHM_PG_RESTORE_ATTEMPTS_USED=0
  IHM_PG_RESTORE_LAST_RC=0
  IHM_PG_RESTORE_LAST_ERROR=""
  IHM_PG_RESTORE_TOTAL_DURATION_SEC=0

  if ! docker image inspect "$IHM_PG_VERIFY_IMAGE" >/dev/null 2>&1; then
    return 2
  fi

  err_file="$(mktemp)"
  started="$(date +%s)"

  for (( attempt=1; attempt<=max_attempts; attempt++ )); do
    : >"$err_file"
    container_name="ihm-pg-verify-$$-${attempt}"

    docker rm -f "$container_name" >/dev/null 2>&1 || true

    if timeout --signal=TERM --kill-after=10s \
      "$IHM_PG_RESTORE_TIMEOUT_SEC" \
      docker run --rm \
        --name "$container_name" \
        --network none \
        --pull=never \
        --read-only \
        -v "${path}:/dump:ro" \
        "$IHM_PG_VERIFY_IMAGE" \
        pg_restore -l /dump \
        >/dev/null 2>"$err_file"; then
      rc=0
    else
      rc=$?
    fi

    docker rm -f "$container_name" >/dev/null 2>&1 || true

    IHM_PG_RESTORE_ATTEMPTS_USED="$attempt"
    IHM_PG_RESTORE_LAST_RC="$rc"

    err_text="$(
      tr '\r\n' '  ' <"$err_file" \
        | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' \
        | cut -c1-500
    )"
    IHM_PG_RESTORE_LAST_ERROR="$err_text"

    if [[ "$rc" -eq 0 ]]; then
      finished="$(date +%s)"
      IHM_PG_RESTORE_TOTAL_DURATION_SEC=$(( finished - started ))

      if (( attempt > 1 )); then
        echo "INFO pg_restore verification recovered name=$(basename "$path") attempts=${attempt}"
      fi

      rm -f "$err_file"
      return 0
    fi

    echo "WARN pg_restore verification failed name=$(basename "$path") attempt=${attempt}/${max_attempts} rc=${rc} error=${err_text:-no-stderr}"

    if (( attempt < max_attempts )); then
      sleep "$retry_delay_sec"
    fi
  done

  finished="$(date +%s)"
  IHM_PG_RESTORE_TOTAL_DURATION_SEC=$(( finished - started ))
  rm -f "$err_file"

  if [[ "$IHM_PG_RESTORE_LAST_RC" -eq 124 ||
        "$IHM_PG_RESTORE_LAST_RC" -eq 137 ]]; then
    return 3
  fi

  return 1
}

check_backup_dump() {
  local dir="$1"
  local label="$2"
  local path name size age rc detail

  if [[ ! -d "$dir" ]]; then
    emit_check critical "${label} backup age" "directory missing" "BACKUP_DIR_MISSING"
    emit_check critical "${label} dump readable" "directory missing" "BACKUP_DIR_MISSING"
    return
  fi
  if [[ ! -r "$dir" ]]; then
    emit_check critical "${label} backup age" "directory not readable" "BACKUP_DIR_UNREADABLE"
    emit_check critical "${label} dump readable" "directory not readable" "BACKUP_DIR_UNREADABLE"
    return
  fi

  path="$(newest_matching_dump "$dir")"
  if [[ -z "$path" ]]; then
    emit_check critical "${label} backup age" "no matching dump" "BACKUP_DUMP_MISSING"
    emit_check critical "${label} dump readable" "no matching dump" "BACKUP_DUMP_MISSING"
    return
  fi

  name="$(basename "$path")"
  if [[ ! -r "$path" ]]; then
    emit_check critical "${label} backup age" "file not readable name=${name}" "BACKUP_DUMP_UNREADABLE"
    emit_check critical "${label} dump readable" "file not readable name=${name}" "BACKUP_DUMP_UNREADABLE"
    return
  fi

  size="$(stat -c '%s' "$path" 2>/dev/null || echo 0)"
  if [[ ! "$size" =~ ^[0-9]+$ ]] || [[ "$size" -le 0 ]]; then
    emit_check critical "${label} backup age" "empty dump name=${name}" "BACKUP_DUMP_EMPTY"
    emit_check critical "${label} dump readable" "empty dump name=${name}" "BACKUP_DUMP_EMPTY"
    return
  fi

  age="$(dump_age_hours "$path" || true)"
  if [[ ! "$age" =~ ^[0-9]+$ ]]; then
    emit_check technical_error "${label} backup age" "age parse failed name=${name}" "BACKUP_AGE_PARSE"
  elif (( age > IHM_BACKUP_MAX_AGE_HOURS )); then
    emit_check critical "${label} backup age" "name=${name} ageHours=${age}" "BACKUP_STALE"
  else
    emit_check healthy "${label} backup age" "name=${name} ageHours=${age}"
  fi

  if verify_dump_readable "$path"; then
    rc=0
  else
    rc=$?
  fi

  detail="name=${name} attempts=${IHM_PG_RESTORE_ATTEMPTS_USED} durationSec=${IHM_PG_RESTORE_TOTAL_DURATION_SEC} lastRc=${IHM_PG_RESTORE_LAST_RC}"

  if [[ -n "$IHM_PG_RESTORE_LAST_ERROR" ]]; then
    detail+=" error=${IHM_PG_RESTORE_LAST_ERROR}"
  fi

  if [[ "$rc" -eq 2 ]]; then
    emit_check technical_error \
      "${label} dump readable" \
      "image ${IHM_PG_VERIFY_IMAGE} missing locally" \
      "PG_VERIFY_IMAGE_MISSING"
  elif [[ "$rc" -eq 3 ]]; then
    emit_check critical \
      "${label} dump readable" \
      "pg_restore timed out ${detail}" \
      "BACKUP_DUMP_VERIFY_TIMEOUT"
  elif [[ "$rc" -ne 0 ]]; then
    emit_check critical \
      "${label} dump readable" \
      "pg_restore failed ${detail}" \
      "BACKUP_DUMP_UNREADABLE_LIST"
  elif (( IHM_PG_RESTORE_ATTEMPTS_USED > 1 )); then
    emit_check healthy \
      "${label} dump readable" \
      "name=${name} attempts=${IHM_PG_RESTORE_ATTEMPTS_USED} recoveredAfterRetry=true durationSec=${IHM_PG_RESTORE_TOTAL_DURATION_SEC}"
  else
    emit_check healthy \
      "${label} dump readable" \
      "name=${name} durationSec=${IHM_PG_RESTORE_TOTAL_DURATION_SEC}"
  fi
}

ihm_read_evidence_key() {
  local file="$1"
  local key="$2"
  local line
  [[ -f "$file" && -r "$file" ]] || return 1
  line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1
  printf '%s' "${line#*=}"
}

ihm_restore_test_enforced() {
  [[ -f "${IHM_RESTORE_TEST_EVIDENCE_ROOT}/${IHM_RESTORE_TEST_ENFORCE_MARKER}" ]]
}

ihm_restore_test_dump_dir() {
  case "$1" in
    production) printf '%s' "$IHM_PROD_BACKUP_DIR" ;;
    staging) printf '%s' "$IHM_STAGING_BACKUP_DIR" ;;
    *) return 1 ;;
  esac
}

ihm_newest_dump_basename_mtime() {
  # prints: basename mtime_epoch
  local dir="$1"
  local newest="" newest_epoch=0 f epoch base
  [[ -d "$dir" ]] || return 1
  shopt -s nullglob
  for f in "${dir}"/*.dump; do
    [[ -f "$f" && ! -L "$f" ]] || continue
    base="$(basename -- "$f")"
    [[ "$base" =~ $IHM_DUMP_NAME_RE ]] || continue
    epoch="$(stat -c '%Y' "$f" 2>/dev/null || echo 0)"
    if (( epoch > newest_epoch )); then
      newest_epoch="$epoch"
      newest="$base"
    fi
  done
  shopt -u nullglob
  [[ -n "$newest" ]] || return 1
  printf '%s %s' "$newest" "$newest_epoch"
}

ihm_validate_referenced_dump() {
  # Args: env basename expected_sha expected_size expected_mtime_utc
  # Sets: IHM_RT_DUMP_AGE_HOURS IHM_RT_DUMP_LAG_HOURS
  local env_name="$1"
  local basename="$2"
  local expect_sha="$3"
  local expect_size="$4"
  local expect_mtime_utc="$5"
  local dump_dir path resolved root sha size mtime_epoch mtime_utc now latest_meta latest_mtime lag

  dump_dir="$(ihm_restore_test_dump_dir "$env_name")" || return 1
  [[ "$basename" =~ $IHM_DUMP_NAME_RE ]] || return 2
  path="${dump_dir}/${basename}"
  [[ -e "$path" ]] || return 3
  [[ ! -L "$path" ]] || return 4
  [[ -f "$path" ]] || return 5

  if command -v realpath >/dev/null 2>&1; then
    resolved="$(realpath -e -- "$path" 2>/dev/null || true)"
    root="$(realpath -e -- "$dump_dir" 2>/dev/null || true)"
  else
    resolved="$(readlink -f -- "$path" 2>/dev/null || true)"
    root="$(readlink -f -- "$dump_dir" 2>/dev/null || true)"
  fi
  [[ -n "$resolved" && -n "$root" && "$resolved" == "$root"/* ]] || return 6

  size="$(stat -c '%s' "$resolved")"
  mtime_epoch="$(stat -c '%Y' "$resolved")"
  mtime_utc="$(date -u -d "@${mtime_epoch}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$mtime_epoch" +%Y-%m-%dT%H:%M:%SZ)"
  sha="$(sha256sum -- "$resolved" 2>/dev/null | awk '{print $1}')"
  [[ -n "$sha" ]] || return 7
  [[ "$sha" == "$expect_sha" ]] || return 8
  [[ "$size" == "$expect_size" ]] || return 9
  [[ "$mtime_utc" == "$expect_mtime_utc" ]] || return 10

  now="$(date -u +%s)"
  IHM_RT_DUMP_AGE_HOURS=$(( (now - mtime_epoch) / 3600 ))
  if (( IHM_RT_DUMP_AGE_HOURS > IRT_VERIFIED_DUMP_MAX_AGE_HOURS )); then
    return 11
  fi

  IHM_RT_DUMP_LAG_HOURS=0
  if latest_meta="$(ihm_newest_dump_basename_mtime "$dump_dir")"; then
    latest_mtime="${latest_meta##* }"
    if [[ "$latest_mtime" =~ ^[0-9]+$ ]] && (( latest_mtime > mtime_epoch )); then
      lag=$(( (latest_mtime - mtime_epoch) / 3600 ))
      IHM_RT_DUMP_LAG_HOURS="$lag"
      if (( lag > IRT_DUMP_LAG_MAX_HOURS )); then
        return 12
      fi
    fi
  fi
  return 0
}

check_restore_test_evidence() {
  local label="$1"
  local dir success attempt status finished age cleanup absent tables err last_attempt_status
  local now finished_epoch env_field basename sha size mtime_utc
  local dump_rc

  dir="${IHM_RESTORE_TEST_EVIDENCE_ROOT}/${label}"
  success="${dir}/last-success.env"
  attempt="${dir}/last-attempt.env"

  if ! ihm_restore_test_enforced; then
    emit_check not_enforced \
      "${label} restore-test" \
      "control not enabled (.enforce absent); not proof of restore readiness"
    return
  fi

  if [[ ! -f "$success" ]]; then
    emit_check critical \
      "${label} restore-test" \
      "last-success missing" \
      "RESTORE_TEST_SUCCESS_MISSING"
    return
  fi

  status="$(ihm_read_evidence_key "$success" STATUS || true)"
  finished="$(ihm_read_evidence_key "$success" FINISHED_AT_UTC || true)"
  cleanup="$(ihm_read_evidence_key "$success" CLEANUP_OK || true)"
  absent="$(ihm_read_evidence_key "$success" TEMP_RESOURCES_ABSENT || true)"
  tables="$(ihm_read_evidence_key "$success" USER_TABLE_COUNT || true)"
  err="$(ihm_read_evidence_key "$success" ERROR_CODE || true)"
  env_field="$(ihm_read_evidence_key "$success" ENVIRONMENT || true)"
  basename="$(ihm_read_evidence_key "$success" DUMP_BASENAME || true)"
  sha="$(ihm_read_evidence_key "$success" DUMP_SHA256 || true)"
  size="$(ihm_read_evidence_key "$success" DUMP_SIZE_BYTES || true)"
  mtime_utc="$(ihm_read_evidence_key "$success" DUMP_MTIME_UTC || true)"

  if [[ "$env_field" != "$label" ]]; then
    emit_check critical \
      "${label} restore-test" \
      "environment mismatch evidence=${env_field:-empty}" \
      "RESTORE_TEST_ENV_MISMATCH"
    return
  fi
  if [[ "$status" != "success" ]]; then
    emit_check critical \
      "${label} restore-test" \
      "last-success status=${status:-empty}" \
      "RESTORE_TEST_SUCCESS_INVALID"
    return
  fi
  if [[ "$cleanup" != "1" || "$absent" != "1" ]]; then
    emit_check critical \
      "${label} restore-test" \
      "cleanup proof missing cleanup=${cleanup:-} absent=${absent:-}" \
      "RESTORE_TEST_CLEANUP_PROOF"
    return
  fi
  if [[ ! "$tables" =~ ^[0-9]+$ ]] || (( tables < 1 )); then
    emit_check critical \
      "${label} restore-test" \
      "integrity tables=${tables:-empty}" \
      "RESTORE_TEST_INTEGRITY"
    return
  fi
  if [[ ! "$sha" =~ ^[a-f0-9]{64}$ || ! "$size" =~ ^[0-9]+$ || -z "$mtime_utc" ]]; then
    emit_check critical \
      "${label} restore-test" \
      "dump metadata invalid" \
      "RESTORE_TEST_DUMP_META"
    return
  fi

  finished_epoch="$(date -u -d "$finished" +%s 2>/dev/null || echo "")"
  now="$(date -u +%s)"
  if [[ ! "$finished_epoch" =~ ^[0-9]+$ ]]; then
    emit_check technical_error \
      "${label} restore-test" \
      "finished timestamp parse failed" \
      "RESTORE_TEST_TS_PARSE"
    return
  fi
  age=$(( (now - finished_epoch) / 3600 ))
  if (( age > IRT_SUCCESS_MAX_AGE_HOURS )); then
    emit_check critical \
      "${label} restore-test" \
      "stale ageHours=${age}" \
      "RESTORE_TEST_STALE"
    return
  fi

  set +e
  ihm_validate_referenced_dump "$label" "$basename" "$sha" "$size" "$mtime_utc"
  dump_rc=$?
  set -e
  case "$dump_rc" in
    0) ;;
    2)
      emit_check critical "${label} restore-test" "dump basename invalid" "RESTORE_TEST_DUMP_BASENAME"
      return
      ;;
    3)
      emit_check critical "${label} restore-test" "referenced dump missing" "RESTORE_TEST_DUMP_MISSING"
      return
      ;;
    4|5|6)
      emit_check critical "${label} restore-test" "referenced dump path unsafe" "RESTORE_TEST_DUMP_UNSAFE"
      return
      ;;
    8)
      emit_check critical "${label} restore-test" "dump sha256 mismatch" "RESTORE_TEST_DUMP_HASH"
      return
      ;;
    9|10)
      emit_check critical "${label} restore-test" "dump size/mtime mismatch" "RESTORE_TEST_DUMP_STAT"
      return
      ;;
    11)
      emit_check critical "${label} restore-test" "referenced dump too old ageHours=${IHM_RT_DUMP_AGE_HOURS:-}" "RESTORE_TEST_DUMP_STALE"
      return
      ;;
    12)
      emit_check critical "${label} restore-test" "verified dump lag behind latest lagHours=${IHM_RT_DUMP_LAG_HOURS:-}" "RESTORE_TEST_DUMP_LAG"
      return
      ;;
    *)
      emit_check technical_error "${label} restore-test" "dump validation failed rc=${dump_rc}" "RESTORE_TEST_DUMP_VALIDATE"
      return
      ;;
  esac

  if [[ -f "$attempt" ]]; then
    last_attempt_status="$(ihm_read_evidence_key "$attempt" STATUS || true)"
    if [[ "$last_attempt_status" == "failed" ]]; then
      emit_check warning \
        "${label} restore-test" \
        "last attempt failed; last success ageHours=${age}" \
        "RESTORE_TEST_LAST_ATTEMPT_FAILED"
      return
    fi
  fi

  emit_check healthy \
    "${label} restore-test" \
    "ageHours=${age} tables=${tables} cleanup=1 dumpLagHours=${IHM_RT_DUMP_LAG_HOURS:-0}"
}

ihm_n8n_read_kv() {
  local file="$1"
  local want_key="$2"
  local line key value
  [[ -f "$file" && -r "$file" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Full-line comments only; do not strip '#' inside URL values (fragments are rejected later).
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "$line" ]] || continue
    [[ "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    key="${key#"${key%%[![:space:]]*}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ ${#value} -ge 2 ]]; then
      if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]] || [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
        value="${value:1:${#value}-2}"
      fi
    fi
    if [[ "$key" == "$want_key" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done <"$file"
  return 1
}

ihm_n8n_validate_https_url() {
  # Args: url expected_path
  # expected_path must be exactly /healthz or /healthz/readiness (no trailing slash).
  local url="$1"
  local expect_path="$2"
  local rest host_port path_part

  [[ -n "$url" ]] || return 1
  [[ -n "$expect_path" ]] || return 1
  [[ "$url" == https://* ]] || return 2
  [[ "$url" != *"?"* ]] || return 3
  [[ "$url" != *"#"* ]] || return 4
  rest="${url#https://}"
  [[ -n "$rest" ]] || return 5
  [[ "$rest" != *@* ]] || return 6
  host_port="${rest%%/*}"
  [[ -n "$host_port" ]] || return 5
  [[ "$host_port" != *[[:space:]]* ]] || return 7
  [[ "$url" != *[[:space:]]* ]] || return 7
  # Require an explicit path; reject bare hosts and non-canonical suffixes.
  if [[ "$rest" != */* ]]; then
    return 8
  fi
  path_part="${rest#*/}"
  if [[ "/${path_part}" != "$expect_path" ]]; then
    return 8
  fi
  return 0
}

ihm_n8n_error_class_from_rc() {
  local url_rc="$1"
  # curl exit codes: 28 timeout, 35/51/53/54/58/59/60 TLS-ish, else transport
  case "$url_rc" in
    28) printf 'timeout' ;;
    35|51|53|54|58|59|60) printf 'tls' ;;
    *) printf 'transport' ;;
  esac
}

ihm_n8n_atomic_write_state() {
  # Durable replace matching telegram notifier pattern:
  # temp in same dir → complete write → fsync → atomic replace → cleanup on failure.
  # Previous valid state at $path is left untouched if any step fails.
  local path="$1"
  local body="$2"
  local dir tmp bin rc

  dir="$(dirname -- "$path")"
  mkdir -p "$dir" || return 1
  chmod 750 "$dir" 2>/dev/null || true

  # Test-only: simulate replace failure after temp write (only --only-n8n-external).
  # Unreachable on run_live (IHM_ONLY_N8N_EXTERNAL=0). Leaves $path untouched.
  if [[ "$IHM_ONLY_N8N_EXTERNAL" -eq 1 && "${IHM_N8N_STATE_WRITE_FAIL:-}" == "1" ]]; then
    tmp="$(mktemp "${dir}/.n8n-probe-state.XXXXXX")" || return 1
    if ! printf '%s\n' "$body" >"$tmp"; then
      rm -f "$tmp"
      return 1
    fi
    rm -f "$tmp"
    return 1
  fi

  if bin="$(ihm_python3_bin)"; then
    set +e
    "$bin" -c '
import os
import sys
import tempfile

path = sys.argv[1]
directory = sys.argv[2]
body = sys.argv[3]
fd, tmp_path = tempfile.mkstemp(prefix=".n8n-probe-state.", dir=directory, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(body)
        if not body.endswith("\n"):
            fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp_path, path)
    try:
        os.chmod(path, 0o640)
    except OSError:
        pass
except Exception:
    try:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
    except OSError:
        pass
    raise SystemExit(1)
raise SystemExit(0)
' "$path" "$dir" "$body"
    rc=$?
    set -e
    return "$rc"
  fi

  # Fallback without python3: still atomic replace + temp cleanup (no fsync).
  tmp="$(mktemp "${dir}/.n8n-probe-state.XXXXXX")" || return 1
  if ! printf '%s\n' "$body" >"$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  chmod 640 "$tmp" 2>/dev/null || true
  if ! mv -f "$tmp" "$path"; then
    rm -f "$tmp"
    return 1
  fi
  return 0
}

ihm_n8n_read_streak() {
  local state_path="$1"
  local probe="$2"
  local target_id="$3"
  local raw val

  IHM_N8N_STREAK=0
  [[ -f "$state_path" && -r "$state_path" ]] || return 0
  raw="$(tr -d '\n' <"$state_path" 2>/dev/null || true)"
  [[ -n "$raw" ]] || return 0
  # Bound parse: reject oversized state (anti-abuse); no body/secrets expected.
  if (( ${#raw} > 4096 )); then
    return 0
  fi
  if [[ "$raw" != *"\"targetId\":\"$(json_escape "$target_id")\""* ]]; then
    return 0
  fi
  case "$probe" in
    liveness)
      val="$(sed -nE 's/.*"liveness"[[:space:]]*:[[:space:]]*\{[^}]*"consecutiveFailures"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' <<<"$raw" | head -n1)"
      ;;
    readiness)
      val="$(sed -nE 's/.*"readiness"[[:space:]]*:[[:space:]]*\{[^}]*"consecutiveFailures"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' <<<"$raw" | head -n1)"
      ;;
    *)
      val=""
      ;;
  esac
  if [[ "$val" =~ ^[0-9]+$ ]]; then
    IHM_N8N_STREAK="$val"
  fi
}

ihm_n8n_write_state() {
  local state_path="$1"
  local target_id="$2"
  local live_fail="$3"
  local live_http="$4"
  local live_err="$5"
  local live_ms="$6"
  local ready_fail="$7"
  local ready_http="$8"
  local ready_err="$9"
  local ready_ms="${10}"
  local ts body

  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  body="$(printf '{"schemaVersion":1,"targetId":"%s","liveness":{"consecutiveFailures":%s,"lastHttpCode":%s,"lastErrorClass":"%s","lastLatencyMs":%s},"readiness":{"consecutiveFailures":%s,"lastHttpCode":%s,"lastErrorClass":"%s","lastLatencyMs":%s},"updatedAtUtc":"%s"}' \
    "$(json_escape "$target_id")" \
    "$live_fail" \
    "$live_http" \
    "$(json_escape "$live_err")" \
    "$live_ms" \
    "$ready_fail" \
    "$ready_http" \
    "$(json_escape "$ready_err")" \
    "$ready_ms" \
    "$(json_escape "$ts")")"
  ihm_n8n_atomic_write_state "$state_path" "$body"
}

ihm_n8n_parse_mock_slot() {
  # Sets: IHM_N8N_MOCK_HTTP IHM_N8N_MOCK_MS IHM_N8N_MOCK_CLASS IHM_N8N_MOCK_OK
  local mock="$1"
  local probe="$2"
  local slot code_or_class ms

  IHM_N8N_MOCK_HTTP=0
  IHM_N8N_MOCK_MS=0
  IHM_N8N_MOCK_CLASS="transport"
  IHM_N8N_MOCK_OK=0

  slot="$(awk -F',' -v p="$probe" '{
    for (i=1;i<=NF;i++) {
      split($i, a, ":");
      if (a[1]==p) { print $i; exit }
    }
  }' <<<"$mock")"
  [[ -n "$slot" ]] || return 1
  code_or_class="$(cut -d: -f2 <<<"$slot")"
  ms="$(cut -d: -f3 <<<"$slot")"
  [[ "$ms" =~ ^[0-9]+$ ]] || ms=0
  IHM_N8N_MOCK_MS="$ms"
  case "$code_or_class" in
    timeout|tls|transport)
      IHM_N8N_MOCK_CLASS="$code_or_class"
      IHM_N8N_MOCK_HTTP=0
      IHM_N8N_MOCK_OK=0
      ;;
    ''|*[!0-9]*)
      return 1
      ;;
    *)
      IHM_N8N_MOCK_HTTP="$code_or_class"
      IHM_N8N_MOCK_CLASS="none"
      if [[ "$code_or_class" == "200" ]]; then
        IHM_N8N_MOCK_OK=1
        IHM_N8N_MOCK_CLASS="none"
      else
        IHM_N8N_MOCK_OK=0
        IHM_N8N_MOCK_CLASS="http_status"
      fi
      ;;
  esac
  return 0
}

ihm_n8n_probe_once() {
  # Args: probe_type url timeout_sec
  # Sets: IHM_N8N_HTTP_CODE IHM_N8N_LATENCY_MS IHM_N8N_ERROR_CLASS IHM_N8N_PROBE_OK
  local probe_type="$1"
  local url="$2"
  local timeout_sec="$3"
  local body_file out http_code latency_s latency_ms curl_rc

  IHM_N8N_HTTP_CODE=0
  IHM_N8N_LATENCY_MS=0
  IHM_N8N_ERROR_CLASS="none"
  IHM_N8N_PROBE_OK=0

  # Mock is test-only for --only-n8n-external. HARNESS_AS_LIVE keeps only-mode but
  # forces mock ignore (live probe semantics) while still allowing CURL_BIN stubs.
  if [[ -n "$IHM_N8N_PROBE_MOCK" && "$IHM_ONLY_N8N_EXTERNAL" -eq 1 && "${IHM_N8N_HARNESS_AS_LIVE:-}" != "1" ]]; then
    if ! ihm_n8n_parse_mock_slot "$IHM_N8N_PROBE_MOCK" "$probe_type"; then
      IHM_N8N_ERROR_CLASS="transport"
      return 1
    fi
    IHM_N8N_HTTP_CODE="$IHM_N8N_MOCK_HTTP"
    IHM_N8N_LATENCY_MS="$IHM_N8N_MOCK_MS"
    IHM_N8N_ERROR_CLASS="$IHM_N8N_MOCK_CLASS"
    IHM_N8N_PROBE_OK="$IHM_N8N_MOCK_OK"
    if [[ "$IHM_N8N_PROBE_OK" -eq 1 ]]; then
      return 0
    fi
    return 1
  fi

  body_file="$(mktemp)"
  set +e
  # CURL_BIN is harness-only: honored solely under --only-n8n-external.
  # Normal run_live always uses real curl regardless of inherited env.
  # HARNESS_PATH_CURL is only-n8n entry + live-gates simulation (never run_live).
  local curl_bin="curl"
  if [[ "$IHM_ONLY_N8N_EXTERNAL" -eq 1 && -n "${IHM_N8N_CURL_BIN:-}" ]]; then
    curl_bin="${IHM_N8N_CURL_BIN}"
  elif [[ "$IHM_N8N_HARNESS_ENTRY" -eq 1 && "$IHM_ONLY_N8N_EXTERNAL" -ne 1 && -n "${IHM_N8N_HARNESS_PATH_CURL:-}" ]]; then
    curl_bin="${IHM_N8N_HARNESS_PATH_CURL}"
  fi
  out="$("$curl_bin" \
    --silent \
    --show-error \
    --proto '=https' \
    --proto-redir '=https' \
    --max-time "$timeout_sec" \
    --connect-timeout "$timeout_sec" \
    --no-location \
    --output "$body_file" \
    --write-out '%{http_code} %{time_total}' \
    "$url" 2>/dev/null)"
  curl_rc=$?
  set -e
  # Never log response body; discard immediately.
  rm -f "$body_file"

  http_code="$(awk '{print $1}' <<<"$out")"
  latency_s="$(awk '{print $2}' <<<"$out")"
  if [[ "$http_code" =~ ^[0-9]+$ ]]; then
    IHM_N8N_HTTP_CODE="$http_code"
  else
    IHM_N8N_HTTP_CODE=0
  fi
  if [[ "$latency_s" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    latency_ms="$(awk -v t="$latency_s" 'BEGIN { printf "%d", (t * 1000) + 0.5 }')"
    IHM_N8N_LATENCY_MS="$latency_ms"
  fi

  if [[ "$curl_rc" -ne 0 ]] || [[ "$IHM_N8N_HTTP_CODE" -eq 0 ]]; then
    IHM_N8N_ERROR_CLASS="$(ihm_n8n_error_class_from_rc "$curl_rc")"
    return 1
  fi
  if [[ "$IHM_N8N_HTTP_CODE" -ne 200 ]]; then
    IHM_N8N_ERROR_CLASS="http_status"
    return 1
  fi
  IHM_N8N_PROBE_OK=1
  IHM_N8N_ERROR_CLASS="none"
  return 0
}

ihm_n8n_emit_probe_result() {
  local probe_type="$1"
  local target_id="$2"
  local ok="$3"
  local http_code="$4"
  local err_class="$5"
  local latency_ms="$6"
  local streak="$7"
  local threshold="$8"
  local label detail code

  label="n8n ${probe_type}"
  detail="target=${target_id} probe=${probe_type} http=${http_code} errorClass=${err_class} latencyMs=${latency_ms} streak=${streak}/${threshold}"

  if [[ "$ok" -eq 1 ]]; then
    emit_check healthy "$label" "$detail"
    return
  fi

  case "$probe_type" in
    liveness) code="N8N_LIVENESS_UNHEALTHY" ;;
    readiness) code="N8N_READINESS_UNHEALTHY" ;;
    *) code="N8N_EXTERNAL_UNHEALTHY" ;;
  esac

  if (( streak < threshold )); then
    emit_check info "$label" "${detail} debounced"
    return
  fi
  emit_check critical "$label" "$detail" "$code"
}

check_n8n_external_health() {
  local cfg="$IHM_N8N_TARGETS_FILE"
  local target_id live_url ready_url timeout_sec threshold
  local present=0
  local rc state_path
  local live_streak ready_streak live_fail ready_fail
  local live_http live_err live_ms ready_http ready_err ready_ms
  local live_ok ready_ok

  if [[ ! -f "$cfg" ]]; then
    emit_check info "n8n external" "disabled (targets config absent)"
    return
  fi
  if [[ ! -r "$cfg" ]]; then
    emit_check technical_error "n8n external" "targets config unreadable" "N8N_CONFIG_INVALID"
    return
  fi

  target_id="$(ihm_n8n_read_kv "$cfg" "IHM_N8N_TARGET_ID" || true)"
  live_url="$(ihm_n8n_read_kv "$cfg" "IHM_N8N_LIVENESS_URL" || true)"
  ready_url="$(ihm_n8n_read_kv "$cfg" "IHM_N8N_READINESS_URL" || true)"
  timeout_sec="$(ihm_n8n_read_kv "$cfg" "IHM_N8N_TIMEOUT_SEC" || true)"
  threshold="$(ihm_n8n_read_kv "$cfg" "IHM_N8N_FAILURE_THRESHOLD" || true)"

  [[ -n "$target_id" ]] && present=1
  [[ -n "$live_url" ]] && present=1
  [[ -n "$ready_url" ]] && present=1
  [[ -n "$timeout_sec" ]] && present=1
  [[ -n "$threshold" ]] && present=1

  if [[ "$present" -eq 0 ]]; then
    emit_check info "n8n external" "disabled (no IHM_N8N_* keys)"
    return
  fi

  if [[ -z "$target_id" || -z "$live_url" || -z "$ready_url" ]]; then
    emit_check technical_error "n8n external" "incomplete targets config" "N8N_CONFIG_INVALID"
    return
  fi
  if [[ ! "$target_id" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
    emit_check technical_error "n8n external" "invalid target id" "N8N_CONFIG_INVALID"
    return
  fi

  # Mock is test-only for --only-n8n-external. Never replace live HTTPS probes.
  # HARNESS_AS_LIVE (only-mode) also ignores mock so live probe semantics can be tested.
  if [[ -n "$IHM_N8N_PROBE_MOCK" ]] && { [[ "$IHM_ONLY_N8N_EXTERNAL" -ne 1 ]] || [[ "${IHM_N8N_HARNESS_AS_LIVE:-}" == "1" ]]; }; then
    emit_check info "n8n external" "probe mock ignored (live path)"
  fi
  # CURL_BIN override is ignored on live path (including FORCE_LIVE_GATES simulation).
  if [[ -n "${IHM_N8N_CURL_BIN:-}" && "$IHM_ONLY_N8N_EXTERNAL" -ne 1 ]]; then
    emit_check info "n8n external" "curl bin override ignored (live path)"
  fi

  if [[ -z "$timeout_sec" ]]; then
    timeout_sec="$IHM_N8N_TIMEOUT_DEFAULT"
  fi
  if [[ -z "$threshold" ]]; then
    threshold="$IHM_N8N_FAILURE_THRESHOLD_DEFAULT"
  fi
  if [[ ! "$timeout_sec" =~ ^[0-9]+$ ]] || (( timeout_sec < 1 || timeout_sec > 60 )); then
    emit_check technical_error "n8n external" "invalid timeout" "N8N_CONFIG_INVALID"
    return
  fi
  if [[ ! "$threshold" =~ ^[0-9]+$ ]] || (( threshold < 1 || threshold > 10 )); then
    emit_check technical_error "n8n external" "invalid failure threshold" "N8N_CONFIG_INVALID"
    return
  fi

  set +e
  ihm_n8n_validate_https_url "$live_url" "/healthz"
  rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    emit_check technical_error "n8n external" "unsafe or non-canonical liveness URL class=${rc}" "N8N_CONFIG_INVALID"
    return
  fi
  set +e
  ihm_n8n_validate_https_url "$ready_url" "/healthz/readiness"
  rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    emit_check technical_error "n8n external" "unsafe or non-canonical readiness URL class=${rc}" "N8N_CONFIG_INVALID"
    return
  fi

  state_path="${IHM_STATE_DIR}/${IHM_N8N_STATE_NAME}"
  mkdir -p "$IHM_STATE_DIR" 2>/dev/null || true

  IHM_N8N_STREAK=0
  ihm_n8n_read_streak "$state_path" "liveness" "$target_id"
  live_streak="$IHM_N8N_STREAK"
  IHM_N8N_STREAK=0
  ihm_n8n_read_streak "$state_path" "readiness" "$target_id"
  ready_streak="$IHM_N8N_STREAK"

  live_ok=0
  ready_ok=0
  if ihm_n8n_probe_once "liveness" "$live_url" "$timeout_sec"; then
    live_ok=1
  fi
  live_http="$IHM_N8N_HTTP_CODE"
  live_err="$IHM_N8N_ERROR_CLASS"
  live_ms="$IHM_N8N_LATENCY_MS"

  if ihm_n8n_probe_once "readiness" "$ready_url" "$timeout_sec"; then
    ready_ok=1
  fi
  ready_http="$IHM_N8N_HTTP_CODE"
  ready_err="$IHM_N8N_ERROR_CLASS"
  ready_ms="$IHM_N8N_LATENCY_MS"

  if [[ "$live_ok" -eq 1 ]]; then
    live_fail=0
  else
    live_fail=$((live_streak + 1))
  fi
  if [[ "$ready_ok" -eq 1 ]]; then
    ready_fail=0
  else
    ready_fail=$((ready_streak + 1))
  fi

  # Persist bounded safe evidence only (no URL with secrets, no response body).
  if ! ihm_n8n_write_state \
    "$state_path" \
    "$target_id" \
    "$live_fail" \
    "$live_http" \
    "$live_err" \
    "$live_ms" \
    "$ready_fail" \
    "$ready_http" \
    "$ready_err" \
    "$ready_ms"; then
    emit_check technical_error "n8n external" "probe state write failed" "N8N_STATE_WRITE_FAILED"
  fi

  ihm_n8n_emit_probe_result "liveness" "$target_id" "$live_ok" "$live_http" "$live_err" "$live_ms" "$live_fail" "$threshold"
  ihm_n8n_emit_probe_result "readiness" "$target_id" "$ready_ok" "$ready_http" "$ready_err" "$ready_ms" "$ready_fail" "$threshold"
}

read_commit() {
  local checkout="$1"
  if git -C "$checkout" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$checkout" rev-parse --short HEAD 2>/dev/null || echo "unknown"
  else
    echo "unknown"
  fi
}

append_jsonl() {
  local journal="${IHM_STATE_DIR}/${IHM_JOURNAL_NAME}"
  local ts codes_json checks_json first code record level label detail
  local -a check_json_items=()

  mkdir -p "$IHM_STATE_DIR"
  chmod 750 "$IHM_STATE_DIR" 2>/dev/null || true
  touch "$journal"
  chmod 640 "$journal" 2>/dev/null || true

  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  codes_json="["
  first=1
  for code in "${IHM_PROBLEM_CODES[@]+"${IHM_PROBLEM_CODES[@]}"}"; do
    if [[ "$first" -eq 1 ]]; then
      first=0
    else
      codes_json+=","
    fi
    codes_json+="\"$(json_escape "$code")\""
  done
  codes_json+="]"

  for record in "${IHM_CHECK_RECORDS[@]+"${IHM_CHECK_RECORDS[@]}"}"; do
    IFS=$'\t' read -r level label code detail <<<"$record"
    if [[ -n "$code" && -n "$detail" ]]; then
      check_json_items+=("{\"id\":\"$(json_escape "$label")\",\"status\":\"$(json_escape "$level")\",\"code\":\"$(json_escape "$code")\",\"detail\":\"$(json_escape "$detail")\"}")
    elif [[ -n "$code" ]]; then
      check_json_items+=("{\"id\":\"$(json_escape "$label")\",\"status\":\"$(json_escape "$level")\",\"code\":\"$(json_escape "$code")\"}")
    elif [[ -n "$detail" ]]; then
      check_json_items+=("{\"id\":\"$(json_escape "$label")\",\"status\":\"$(json_escape "$level")\",\"detail\":\"$(json_escape "$detail")\"}")
    else
      check_json_items+=("{\"id\":\"$(json_escape "$label")\",\"status\":\"$(json_escape "$level")\"}")
    fi
  done

  checks_json="["
  first=1
  for record in "${check_json_items[@]+"${check_json_items[@]}"}"; do
    if [[ "$first" -eq 1 ]]; then
      first=0
    else
      checks_json+=","
    fi
    checks_json+="$record"
  done
  checks_json+="]"

  printf '%s\n' "{\"schemaVersion\":1,\"timestampUtc\":\"$(json_escape "$ts")\",\"overallStatus\":\"$(json_escape "$IHM_OVERALL")\",\"problemCodes\":${codes_json},\"checks\":${checks_json},\"commits\":{\"production\":\"$(json_escape "$IHM_COMMIT_PROD")\",\"staging\":\"$(json_escape "$IHM_COMMIT_STAGING")\"}}" >>"$journal"
}

print_footer() {
  case "$IHM_OVERALL" in
    healthy)
      echo "INTERNAL_HEALTH_MONITOR OK"
      ;;
    warning)
      echo "INTERNAL_HEALTH_MONITOR WARNING count=${IHM_FAIL_COUNT}"
      ;;
    *)
      echo "INTERNAL_HEALTH_MONITOR FAILED count=${IHM_FAIL_COUNT}"
      ;;
  esac
}

ihm_python3_bin() {
  # Optional absolute override for local/Windows regression tests.
  if [[ -n "${IHM_PYTHON3:-}" ]]; then
    if [[ -x "$IHM_PYTHON3" ]] || [[ -f "$IHM_PYTHON3" ]]; then
      if "$IHM_PYTHON3" -c 'import urllib.request' >/dev/null 2>&1; then
        printf '%s\n' "$IHM_PYTHON3"
        return 0
      fi
    fi
    return 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    return 1
  fi
  if ! python3 -c 'import urllib.request' >/dev/null 2>&1; then
    return 1
  fi
  command -v python3
}

build_telegram_payload() {
  local first=1 record level label code detail
  local -a problem_items=()

  for record in "${IHM_CHECK_RECORDS[@]+"${IHM_CHECK_RECORDS[@]}"}"; do
    IFS=$'\t' read -r level label code detail <<<"$record"
    if [[ "$level" == "healthy" || "$level" == "not_enforced" || "$level" == "info" || -z "$level" ]]; then
      continue
    fi
    if [[ -n "$code" && -n "$detail" ]]; then
      problem_items+=("{\"id\":\"$(json_escape "$label")\",\"status\":\"$(json_escape "$level")\",\"code\":\"$(json_escape "$code")\",\"detail\":\"$(json_escape "$detail")\"}")
    elif [[ -n "$code" ]]; then
      problem_items+=("{\"id\":\"$(json_escape "$label")\",\"status\":\"$(json_escape "$level")\",\"code\":\"$(json_escape "$code")\"}")
    elif [[ -n "$detail" ]]; then
      problem_items+=("{\"id\":\"$(json_escape "$label")\",\"status\":\"$(json_escape "$level")\",\"detail\":\"$(json_escape "$detail")\"}")
    else
      problem_items+=("{\"id\":\"$(json_escape "$label")\",\"status\":\"$(json_escape "$level")\"}")
    fi
  done

  printf '{"overallStatus":"%s","problems":[' "$(json_escape "$IHM_OVERALL")"
  first=1
  for record in "${problem_items[@]+"${problem_items[@]}"}"; do
    if [[ "$first" -eq 1 ]]; then
      first=0
    else
      printf ','
    fi
    printf '%s' "$record"
  done
  printf ']}\n'
}

maybe_notify_telegram() {
  local bin state_path dry_args=()

  if [[ "$IHM_SKIP_TELEGRAM" -eq 1 && -z "$IHM_TELEGRAM_DRY_RUN_DIR" ]]; then
    return 0
  fi

  if [[ ! -f "$IHM_TELEGRAM_NOTIFIER" ]]; then
    echo "INFO telegram: notifier script missing, skipping" >&2
    return 0
  fi

  if ! bin="$(ihm_python3_bin)"; then
    echo "INFO telegram: python3 unavailable, skipping" >&2
    return 0
  fi

  state_path="${IHM_STATE_DIR}/${IHM_TELEGRAM_STATE_NAME}"
  mkdir -p "$IHM_STATE_DIR" 2>/dev/null || true

  if [[ -n "$IHM_TELEGRAM_DRY_RUN_DIR" ]]; then
    dry_args=(--dry-run-dir "$IHM_TELEGRAM_DRY_RUN_DIR")
  fi

  # Payload on stdin; config path only in argv (never token/chat id).
  set +e
  build_telegram_payload | "$bin" "$IHM_TELEGRAM_NOTIFIER" \
    --config "$IHM_TELEGRAM_CONFIG" \
    --state "$state_path" \
    "${dry_args[@]+"${dry_args[@]}"}"
  set -e
  return 0
}

exit_with_overall() {
  local code=0
  case "$IHM_OVERALL" in
    healthy) code=0 ;;
    warning) code=10 ;;
    critical) code=20 ;;
    *) code=30 ;;
  esac
  # Fixtures skip Telegram unless a dry-run dir is provided for local tests.
  if [[ "$IHM_SKIP_TELEGRAM" -eq 1 && -z "$IHM_TELEGRAM_DRY_RUN_DIR" ]]; then
    exit "$code"
  fi
  maybe_notify_telegram
  exit "$code"
}

run_fixture() {
  IHM_SKIP_TELEGRAM=1
  echo "INTERNAL_HEALTH_MONITOR START"
  case "$IHM_FIXTURE" in
    healthy)
      emit_check healthy "docker production app"
      emit_check healthy "docker production postgres"
      emit_check healthy "docker staging app"
      emit_check healthy "docker staging postgres"
      emit_check healthy "http production"
      emit_check healthy "http staging"
      emit_check healthy "disk /" "usedPercent=40"
      emit_check healthy "inodes /" "usedPercent=40"
      emit_check healthy "systemd failed units"
      emit_check healthy "production backup timer"
      emit_check healthy "staging backup timer"
      emit_check healthy "production backup age" "name=fixture.dump ageHours=1"
      emit_check healthy "staging backup age" "name=fixture.dump ageHours=1"
      emit_check healthy "production dump readable" "name=fixture.dump"
      emit_check healthy "staging dump readable" "name=fixture.dump"
      emit_check not_enforced "production restore-test" "control not enabled (.enforce absent); not proof of restore readiness"
      emit_check not_enforced "staging restore-test" "control not enabled (.enforce absent); not proof of restore readiness"
      emit_check info "n8n external" "disabled (targets config absent)"
      ;;
    warning)
      emit_check healthy "docker production app"
      emit_check warning "disk /" "usedPercent=78" "DISK_USAGE_WARNING"
      ;;
    critical)
      emit_check critical "docker production app" "missing" "DOCKER_MISSING"
      ;;
    technical_error)
      emit_check technical_error "production dump readable" "image postgres:17-alpine missing locally" "PG_VERIFY_IMAGE_MISSING"
      ;;
    restore_test_not_enforced)
      emit_check not_enforced \
        "production restore-test" \
        "control not enabled (.enforce absent); not proof of restore readiness"
      emit_check not_enforced \
        "staging restore-test" \
        "control not enabled (.enforce absent); not proof of restore readiness"
      ;;
    *)
      die_usage "unknown fixture mode: ${IHM_FIXTURE}"
      ;;
  esac
  print_footer
  mkdir -p "$IHM_STATE_DIR"
  append_jsonl
  exit_with_overall
}

run_restore_test_only() {
  IHM_SKIP_TELEGRAM=1
  echo "INTERNAL_HEALTH_MONITOR START (restore-test only)"
  check_restore_test_evidence "production"
  check_restore_test_evidence "staging"
  print_footer
  mkdir -p "$IHM_STATE_DIR"
  append_jsonl || true
  exit_with_overall
}

run_n8n_external_only() {
  IHM_SKIP_TELEGRAM=1
  # Same monitor lock as run_live so streak RMW cannot race the timer.
  acquire_lock_or_skip
  # Test harness only: drop only-mode gates to match run_live (mock + CURL_BIN ignored).
  # Unreachable from run_live. HARNESS_AS_LIVE alone keeps only-mode so CURL_BIN stubs work.
  if [[ "${IHM_N8N_HARNESS_FORCE_LIVE_GATES:-}" == "1" ]]; then
    IHM_ONLY_N8N_EXTERNAL=0
  fi
  echo "INTERNAL_HEALTH_MONITOR START (n8n external only)"
  check_n8n_external_health
  print_footer
  mkdir -p "$IHM_STATE_DIR"
  append_jsonl || true
  exit_with_overall
}

acquire_lock_or_skip() {
  local lock="${IHM_STATE_DIR}/${IHM_LOCK_NAME}"
  mkdir -p "$IHM_STATE_DIR"
  chmod 750 "$IHM_STATE_DIR" 2>/dev/null || true
  # Production Ubuntu provides flock; without it, continuing is safer than a false SKIP.
  if ! command -v flock >/dev/null 2>&1; then
    echo "INFO lock: flock unavailable, continuing without exclusive lock" >&2
    return 0
  fi
  exec 9>"$lock"
  if ! flock -n 9; then
    echo "INTERNAL_HEALTH_MONITOR SKIP concurrent run"
    exit 0
  fi
}

run_live() {
  acquire_lock_or_skip

  echo "INTERNAL_HEALTH_MONITOR START"

  check_docker_container "$IHM_PROD_APP" "production app"
  check_docker_container "$IHM_PROD_PG" "production postgres"
  check_docker_container "$IHM_STAGING_APP" "staging app"
  check_docker_container "$IHM_STAGING_PG" "staging postgres"

  check_http_health "$IHM_PROD_HEALTH_URL" "production"
  check_http_health "$IHM_STAGING_HEALTH_URL" "staging"

  # Optional independent n8n HTTPS probes (config-driven; absent config = disabled).
  check_n8n_external_health

  # Root filesystem covers /opt checkouts and typical Docker data roots on this host.
  check_disk_root
  check_inode_root
  check_failed_units

  check_backup_timer "$IHM_PROD_BACKUP_TIMER" "$IHM_PROD_BACKUP_SERVICE" "production"
  check_backup_timer "$IHM_STAGING_BACKUP_TIMER" "$IHM_STAGING_BACKUP_SERVICE" "staging"

  check_backup_dump "$IHM_PROD_BACKUP_DIR" "production"
  check_backup_dump "$IHM_STAGING_BACKUP_DIR" "staging"

  check_restore_test_evidence "production"
  check_restore_test_evidence "staging"

  IHM_COMMIT_PROD="$(read_commit "$IHM_PROD_CHECKOUT")"
  IHM_COMMIT_STAGING="$(read_commit "$IHM_STAGING_CHECKOUT")"
  echo "INFO commits production=${IHM_COMMIT_PROD} staging=${IHM_COMMIT_STAGING}"

  if ! append_jsonl; then
    echo "FAIL journal append: write failed" >&2
    raise_overall technical_error
    record_problem "JOURNAL_WRITE_FAILED"
    IHM_FAIL_COUNT=$((IHM_FAIL_COUNT + 1))
  fi

  print_footer
  exit_with_overall
}

main() {
  parse_args "$@"
  if [[ "$IHM_HELP" -eq 1 ]]; then
    usage
    exit 0
  fi
  if [[ -n "$IHM_FIXTURE" ]]; then
    run_fixture
  fi
  if [[ "$IHM_ONLY_RESTORE_TEST" -eq 1 ]]; then
    run_restore_test_only
  fi
  if [[ "$IHM_ONLY_N8N_EXTERNAL" -eq 1 ]]; then
    run_n8n_external_only
  fi
  run_live
}

main "$@"
