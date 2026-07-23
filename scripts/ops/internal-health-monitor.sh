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
readonly IHM_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly IHM_TELEGRAM_NOTIFIER_MJS="${IHM_SCRIPT_DIR}/internal-health-monitor-telegram.mjs"
readonly IHM_TELEGRAM_NOTIFIER_PY="${IHM_SCRIPT_DIR}/internal-health-monitor-telegram.py"

readonly IHM_DISK_WARN_PERCENT=75
readonly IHM_DISK_CRIT_PERCENT=90
readonly IHM_INODE_WARN_PERCENT=80
readonly IHM_INODE_CRIT_PERCENT=95
readonly IHM_BACKUP_MAX_AGE_HOURS=30
readonly IHM_HTTP_TIMEOUT_SEC=10
readonly IHM_PG_RESTORE_TIMEOUT_SEC=60
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
readonly IHM_PROD_BACKUP_DIR="/opt/online-zapis-tv-production/backups/production/postgres"
readonly IHM_STAGING_BACKUP_DIR="/opt/online-zapis-tv/backups/postgres"

readonly IHM_PROD_BACKUP_TIMER="online-zapis-tv-production-backup.timer"
readonly IHM_PROD_BACKUP_SERVICE="online-zapis-tv-production-backup.service"
readonly IHM_STAGING_BACKUP_TIMER="online-zapis-tv-staging-backup.timer"
readonly IHM_STAGING_BACKUP_SERVICE="online-zapis-tv-staging-backup.service"

IHM_STATE_DIR="${IHM_STATE_DIR_DEFAULT}"
IHM_TELEGRAM_CONFIG="${IHM_TELEGRAM_CONFIG:-$IHM_TELEGRAM_CONFIG_DEFAULT}"
IHM_TELEGRAM_DRY_RUN_DIR="${IHM_TELEGRAM_DRY_RUN_DIR:-}"
IHM_FIXTURE=""
IHM_HELP=0
IHM_SKIP_TELEGRAM=0

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
                      healthy | warning | critical | technical_error
                      (skips Telegram notify)

Exit codes:
  0   healthy
  10  warning
  20  critical
  30  technical_error

This script never restarts containers, restores databases, migrates, prunes Docker,
or sends alerts.
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

verify_dump_readable() {
  local path="$1"

  if ! docker image inspect "$IHM_PG_VERIFY_IMAGE" >/dev/null 2>&1; then
    return 2
  fi

  if ! timeout "$IHM_PG_RESTORE_TIMEOUT_SEC" docker run --rm \
    --network none \
    --pull=never \
    --read-only \
    -v "${path}:/dump:ro" \
    "$IHM_PG_VERIFY_IMAGE" \
    pg_restore -l /dump >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

check_backup_dump() {
  local dir="$1"
  local label="$2"
  local path name size age rc

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

  set +e
  verify_dump_readable "$path"
  rc=$?
  set -e
  if [[ "$rc" -eq 2 ]]; then
    emit_check technical_error "${label} dump readable" "image ${IHM_PG_VERIFY_IMAGE} missing locally" "PG_VERIFY_IMAGE_MISSING"
  elif [[ "$rc" -ne 0 ]]; then
    emit_check critical "${label} dump readable" "pg_restore -l failed name=${name}" "BACKUP_DUMP_UNREADABLE_LIST"
  else
    emit_check healthy "${label} dump readable" "name=${name}"
  fi
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

ihm_telegram_runner() {
  # Prefer working python3 (typical on Ubuntu host). Fall back to Node for local/dev.
  if [[ -f "$IHM_TELEGRAM_NOTIFIER_PY" ]] && command -v python3 >/dev/null 2>&1; then
    if python3 -c 'import urllib.request' >/dev/null 2>&1; then
      echo "python3|$IHM_TELEGRAM_NOTIFIER_PY"
      return 0
    fi
  fi
  if [[ -f "$IHM_TELEGRAM_NOTIFIER_MJS" ]]; then
    if command -v node >/dev/null 2>&1; then
      echo "node|$IHM_TELEGRAM_NOTIFIER_MJS"
      return 0
    fi
    if command -v nodejs >/dev/null 2>&1; then
      echo "nodejs|$IHM_TELEGRAM_NOTIFIER_MJS"
      return 0
    fi
  fi
  if [[ -f "$IHM_TELEGRAM_NOTIFIER_PY" ]] && command -v python >/dev/null 2>&1; then
    if python -c 'import urllib.request' >/dev/null 2>&1; then
      echo "python|$IHM_TELEGRAM_NOTIFIER_PY"
      return 0
    fi
  fi
  return 1
}

build_telegram_payload() {
  local first=1 record level label code detail
  local -a problem_items=()

  for record in "${IHM_CHECK_RECORDS[@]+"${IHM_CHECK_RECORDS[@]}"}"; do
    IFS=$'\t' read -r level label code detail <<<"$record"
    if [[ "$level" == "healthy" || -z "$level" ]]; then
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
  local runner bin notifier state_path dry_args=()

  if [[ "$IHM_SKIP_TELEGRAM" -eq 1 && -z "$IHM_TELEGRAM_DRY_RUN_DIR" ]]; then
    return 0
  fi

  if ! runner="$(ihm_telegram_runner)"; then
    echo "INFO telegram: notifier runtime missing (node or python3), skipping" >&2
    return 0
  fi
  bin="${runner%%|*}"
  notifier="${runner#*|}"

  state_path="${IHM_STATE_DIR}/${IHM_TELEGRAM_STATE_NAME}"
  mkdir -p "$IHM_STATE_DIR" 2>/dev/null || true

  if [[ -n "$IHM_TELEGRAM_DRY_RUN_DIR" ]]; then
    dry_args=(--dry-run-dir "$IHM_TELEGRAM_DRY_RUN_DIR")
  fi

  # Payload on stdin; config path only in argv (never token/chat id).
  set +e
  build_telegram_payload | "$bin" "$notifier" \
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
    *)
      die_usage "unknown fixture mode: ${IHM_FIXTURE}"
      ;;
  esac
  print_footer
  mkdir -p "$IHM_STATE_DIR"
  append_jsonl
  exit_with_overall
}

acquire_lock_or_skip() {
  local lock="${IHM_STATE_DIR}/${IHM_LOCK_NAME}"
  mkdir -p "$IHM_STATE_DIR"
  chmod 750 "$IHM_STATE_DIR" 2>/dev/null || true
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

  # Root filesystem covers /opt checkouts and typical Docker data roots on this host.
  check_disk_root
  check_inode_root
  check_failed_units

  check_backup_timer "$IHM_PROD_BACKUP_TIMER" "$IHM_PROD_BACKUP_SERVICE" "production"
  check_backup_timer "$IHM_STAGING_BACKUP_TIMER" "$IHM_STAGING_BACKUP_SERVICE" "staging"

  check_backup_dump "$IHM_PROD_BACKUP_DIR" "production"
  check_backup_dump "$IHM_STAGING_BACKUP_DIR" "staging"

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
  run_live
}

main "$@"
