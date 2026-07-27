#!/usr/bin/env bash
# Shared constants/helpers for isolated PostgreSQL restore-test.
# Never prints credentials, dump object lists, or row data.

set -Eeuo pipefail

IRT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=isolated-restore-test-policy.sh
source "${IRT_LIB_DIR}/isolated-restore-test-policy.sh"

readonly IRT_PG_IMAGE="postgres:17-alpine"
readonly IRT_EVIDENCE_ROOT_DEFAULT="/var/lib/online-zapis-tv/restore-test"
readonly IRT_LOCK_NAME="run.lock"
readonly IRT_ENFORCE_MARKER=".enforce"
readonly IRT_HISTORY_KEEP=20

readonly IRT_OVERALL_TIMEOUT_SEC=1800
# Overridable in harness only (units never set this).
IRT_PG_READY_TIMEOUT_SEC="${IRT_PG_READY_TIMEOUT_SEC:-120}"
readonly IRT_DOCKER_MEMORY="1g"
readonly IRT_DOCKER_CPUS="1.0"
# PostgreSQL forks workers during restore; 256 caps runaway without starving restore.
readonly IRT_DOCKER_PIDS_LIMIT=256

readonly IRT_DUMP_NAME_RE='^[0-9]{8}T[0-9]{6}Z_[A-Za-z0-9._-]+\.dump$'
readonly IRT_CONTAINER_NAME_RE='^oz-rt-(production|staging)-[a-f0-9]{16}$'
readonly IRT_CID_RE='^[a-f0-9]{12,64}$'
readonly IRT_RUN_ID_RE='^[a-f0-9]{16,64}$'

readonly IRT_LABEL_COMPONENT="com.online-zapis-tv.component"
readonly IRT_LABEL_ENV="com.online-zapis-tv.environment"
readonly IRT_LABEL_RUN="com.online-zapis-tv.run-id"
readonly IRT_COMPONENT_VALUE="isolated-restore-test"

readonly IRT_PROD_CHECKOUT="/opt/online-zapis-tv-production"
readonly IRT_STAGING_CHECKOUT="/opt/online-zapis-tv"
readonly IRT_PROD_DUMP_DIR="${IRT_PROD_CHECKOUT}/backups/production/postgres"
readonly IRT_STAGING_DUMP_DIR="${IRT_STAGING_CHECKOUT}/backups/postgres"

readonly IRT_FORBIDDEN_CONTAINERS=(
  tvoe-vremya-production-postgres
  tvoe-vremya-staging-postgres
  tvoe-vremya-production-app
  tvoe-vremya-staging-app
)

# Test overrides (empty in production). Set only by harness.
IRT_EVIDENCE_ROOT="${IRT_EVIDENCE_ROOT:-$IRT_EVIDENCE_ROOT_DEFAULT}"
IRT_DUMP_DIR_OVERRIDE="${IRT_DUMP_DIR_OVERRIDE:-}"
IRT_SKIP_FORBIDDEN_CHECK="${IRT_SKIP_FORBIDDEN_CHECK:-0}"

irt_die() {
  echo "error: $*" >&2
  exit 70
}

irt_info() {
  echo "$*"
}

irt_escape_manifest_value() {
  local value="${1-}"
  value="${value//\\/\\\\}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  printf '%s' "$value"
}

irt_require_commands() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || irt_die "required command not found: ${cmd}"
  done
}

irt_resolve_environment() {
  local env_name="$1"
  case "$env_name" in
    production|staging) ;;
    *) irt_die "environment must be production or staging" ;;
  esac
  IRT_ENV="$env_name"
  if [[ -n "$IRT_DUMP_DIR_OVERRIDE" ]]; then
    IRT_DUMP_DIR="$IRT_DUMP_DIR_OVERRIDE"
  elif [[ "$IRT_ENV" == "production" ]]; then
    IRT_DUMP_DIR="$IRT_PROD_DUMP_DIR"
    IRT_CHECKOUT="$IRT_PROD_CHECKOUT"
  else
    IRT_DUMP_DIR="$IRT_STAGING_DUMP_DIR"
    IRT_CHECKOUT="$IRT_STAGING_CHECKOUT"
  fi
  IRT_ENV_EVIDENCE_DIR="${IRT_EVIDENCE_ROOT}/${IRT_ENV}"
  IRT_HISTORY_DIR="${IRT_ENV_EVIDENCE_DIR}/history"
  IRT_RUNTIME_DIR="${IRT_ENV_EVIDENCE_DIR}/runtime"
}

irt_ensure_evidence_dirs() {
  # Create missing directories only. Never chmod existing dirs: repairing modes would
  # mask a read-only evidence store and defeat fail-closed write checks.
  local created_root=0 created_env=0 created_hist=0 created_rt=0
  [[ -d "$IRT_EVIDENCE_ROOT" ]] || created_root=1
  [[ -d "$IRT_ENV_EVIDENCE_DIR" ]] || created_env=1
  [[ -d "$IRT_HISTORY_DIR" ]] || created_hist=1
  [[ -d "$IRT_RUNTIME_DIR" ]] || created_rt=1
  mkdir -p "$IRT_ENV_EVIDENCE_DIR" "$IRT_HISTORY_DIR" "$IRT_RUNTIME_DIR" || return 1
  if [[ "$created_root" -eq 1 ]]; then chmod 750 "$IRT_EVIDENCE_ROOT" 2>/dev/null || true; fi
  if [[ "$created_env" -eq 1 ]]; then chmod 750 "$IRT_ENV_EVIDENCE_DIR" 2>/dev/null || true; fi
  if [[ "$created_hist" -eq 1 ]]; then chmod 750 "$IRT_HISTORY_DIR" 2>/dev/null || true; fi
  if [[ "$created_rt" -eq 1 ]]; then chmod 700 "$IRT_RUNTIME_DIR" 2>/dev/null || true; fi
  return 0
}

irt_realpath() {
  local path="$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath -e -- "$path" 2>/dev/null || return 1
  else
    readlink -f -- "$path" 2>/dev/null || return 1
  fi
}

irt_file_identity() {
  # prints: device inode size mtime
  local path="$1"
  stat -c '%d %i %s %Y' -- "$path" 2>/dev/null
}

irt_sha256_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$path" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$path" | awk '{print $1}'
  else
    irt_die "sha256sum or shasum required"
  fi
}

irt_validate_dump_path() {
  local candidate="$1"
  local resolved expected_root base

  [[ -n "$candidate" ]] || return 1
  [[ -e "$candidate" ]] || return 1
  [[ ! -L "$candidate" ]] || return 1
  [[ -f "$candidate" ]] || return 1

  resolved="$(irt_realpath "$candidate" || true)"
  expected_root="$(irt_realpath "$IRT_DUMP_DIR" || true)"
  [[ -n "$resolved" && -n "$expected_root" ]] || return 1
  [[ "$resolved" == "$expected_root"/* ]] || return 1
  [[ -f "$resolved" && ! -L "$resolved" ]] || return 1

  base="$(basename -- "$resolved")"
  [[ "$base" =~ $IRT_DUMP_NAME_RE ]] || return 1
  [[ -r "$resolved" ]] || return 1
  [[ -s "$resolved" ]] || return 1

  printf '%s' "$resolved"
}

irt_newest_dump() {
  local dir="$1"
  local newest="" newest_epoch=0 f epoch base

  [[ -d "$dir" ]] || return 1
  shopt -s nullglob
  for f in "${dir}"/*.dump; do
    [[ -f "$f" && ! -L "$f" ]] || continue
    base="$(basename -- "$f")"
    [[ "$base" =~ $IRT_DUMP_NAME_RE ]] || continue
    epoch="$(stat -c '%Y' "$f" 2>/dev/null || echo 0)"
    if (( epoch > newest_epoch )); then
      newest_epoch="$epoch"
      newest="$f"
    fi
  done
  shopt -u nullglob
  [[ -n "$newest" ]] || return 1
  irt_validate_dump_path "$newest"
}

irt_dump_age_hours() {
  local path="$1"
  local mtime now
  mtime="$(stat -c '%Y' "$path")"
  now="$(date +%s)"
  echo $(( (now - mtime) / 3600 ))
}

irt_write_evidence_file() {
  # Atomic publish via temp+rename. Explicit status checks: callers may invoke
  # this under `if ! ...` where set -e is suppressed for the whole function body.
  local target="$1"
  shift
  local tmp line
  tmp="${target}.tmp.$$.$RANDOM"
  if ! : >"$tmp" 2>/dev/null; then
    return 1
  fi
  for line in "$@"; do
    if ! printf '%s\n' "$line" >>"$tmp" 2>/dev/null; then
      rm -f -- "$tmp" 2>/dev/null || true
      return 1
    fi
  done
  if ! chmod 600 "$tmp" 2>/dev/null; then
    rm -f -- "$tmp" 2>/dev/null || true
    return 1
  fi
  if ! mv -f -- "$tmp" "$target" 2>/dev/null; then
    rm -f -- "$tmp" 2>/dev/null || true
    return 1
  fi
  if ! chmod 600 "$target" 2>/dev/null; then
    return 1
  fi
  return 0
}

irt_read_evidence_key() {
  local file="$1"
  local key="$2"
  local line
  [[ -f "$file" && -r "$file" ]] || return 1
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || return 1
  line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1
  printf '%s' "${line#*=}"
}

irt_marker_get() {
  # Safe key=value read from current.env (never source/eval).
  local file="$1"
  local key="$2"
  local line value
  [[ -f "$file" && -r "$file" ]] || return 1
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || return 1
  line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1
  value="${line#*=}"
  # Reject values that could confuse path/shell handling.
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* || "$value" == *'`'* || "$value" == *'$'* ]]; then
    return 1
  fi
  printf '%s' "$value"
}

irt_prune_history() {
  local keep="$IRT_HISTORY_KEEP"
  local files
  mapfile -t files < <(ls -1t "${IRT_HISTORY_DIR}"/*.env 2>/dev/null || true)
  local i
  for (( i = keep; i < ${#files[@]}; i++ )); do
    rm -f -- "${files[$i]}"
  done
  # Diagnostic logs are keyed by RUN_ID; prune with the same retention window.
  files=()
  if compgen -G "${IRT_HISTORY_DIR}/pg_restore_*.error.log" >/dev/null 2>&1; then
    mapfile -t files < <(ls -1t "${IRT_HISTORY_DIR}"/pg_restore_*.error.log)
  fi
  for (( i = keep; i < ${#files[@]}; i++ )); do
    rm -f -- "${files[$i]}"
  done
}

irt_random_hex() {
  local nbytes="${1:-8}"
  if [[ -r /dev/urandom ]]; then
    head -c "$nbytes" /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c "$((nbytes * 2))"
  else
    # Fallback: still mix PID+time; not ideal but better than fixed.
    printf '%s' "${RANDOM}${BASHPID}$(date +%s%N 2>/dev/null || date +%s)" | sha256sum | awk '{print substr($1,1,16)}'
  fi
}

irt_is_safe_temp_name() {
  local name="$1"
  [[ "$name" =~ $IRT_CONTAINER_NAME_RE ]]
}

irt_is_safe_cid() {
  local cid="$1"
  [[ "$cid" =~ $IRT_CID_RE ]]
}

irt_container_exists() {
  local ref="$1"
  [[ -n "$ref" ]] || return 1
  docker inspect "$ref" >/dev/null 2>&1
}

irt_container_label() {
  local ref="$1"
  local key="$2"
  docker inspect --format "{{index .Config.Labels \"${key}\"}}" "$ref" 2>/dev/null || true
}

irt_validate_owned_container() {
  local ref="$1"
  local expect_env="$2"
  local expect_run="${3-}"
  local name component env_label run_label

  irt_is_safe_cid "$ref" || irt_is_safe_temp_name "$ref" || return 1
  irt_container_exists "$ref" || return 1

  name="$(docker inspect --format '{{.Name}}' "$ref" 2>/dev/null | sed 's#^/##')"
  irt_is_safe_temp_name "$name" || return 1

  component="$(irt_container_label "$ref" "$IRT_LABEL_COMPONENT")"
  env_label="$(irt_container_label "$ref" "$IRT_LABEL_ENV")"
  run_label="$(irt_container_label "$ref" "$IRT_LABEL_RUN")"

  [[ "$component" == "$IRT_COMPONENT_VALUE" ]] || return 1
  [[ "$env_label" == "$expect_env" ]] || return 1
  if [[ -n "$expect_run" ]]; then
    [[ "$run_label" == "$expect_run" ]] || return 1
  fi
  return 0
}

irt_forbidden_snapshot() {
  # Aggregate metadata only: name id running restartcount startedat
  local name id running restarts started
  for name in "${IRT_FORBIDDEN_CONTAINERS[@]}"; do
    if ! docker inspect "$name" >/dev/null 2>&1; then
      printf 'missing %s\n' "$name"
      continue
    fi
    id="$(docker inspect --format '{{.Id}}' "$name" 2>/dev/null | cut -c1-12)"
    running="$(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null || echo unknown)"
    restarts="$(docker inspect --format '{{.RestartCount}}' "$name" 2>/dev/null || echo unknown)"
    started="$(docker inspect --format '{{.State.StartedAt}}' "$name" 2>/dev/null || echo unknown)"
    printf '%s %s running=%s restarts=%s started=%s\n' "$name" "$id" "$running" "$restarts" "$started"
  done
}
