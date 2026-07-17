#!/usr/bin/env bash
# Общие безопасные хелперы для production ops-скриптов.
# Полностью изолированы от staging-ops-common.sh — не source .env.production.

if [[ -n "${PRODUCTION_OPS_COMMON_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
PRODUCTION_OPS_COMMON_LOADED=1

readonly PRODUCTION_EXPECTED_REPO_ROOT="/opt/online-zapis-tv-production"
readonly PRODUCTION_STAGING_REPO_ROOT="/opt/online-zapis-tv"
readonly PRODUCTION_COMPOSE_FILE="docker-compose.production.yml"
readonly PRODUCTION_ENV_FILE=".env.production"
readonly PRODUCTION_COMPOSE_PROJECT="tvoe-vremya-production"
readonly PRODUCTION_APP_CONTAINER="tvoe-vremya-production-app"
readonly PRODUCTION_POSTGRES_CONTAINER="tvoe-vremya-production-postgres"
readonly PRODUCTION_BACKUPS_POSTGRES_DIR="backups/production/postgres"
readonly PRODUCTION_DEPLOY_STATE_DIR="backups/production/deploy-state"
readonly PRODUCTION_LOCK_FILE="backups/production/deploy-state/.production-ops.lock"
readonly PRODUCTION_HEALTH_URL="http://127.0.0.1:3100/api/health"
readonly PRODUCTION_STATE_VERSION="1"
readonly PRODUCTION_DOCKER_HEALTH_TIMEOUT_SEC=180
readonly PRODUCTION_DOCKER_HEALTH_INTERVAL_SEC=5
readonly PRODUCTION_HTTP_HEALTH_TIMEOUT_SEC=10
readonly PRODUCTION_APP_IMAGE_REF="online-zapis-tv-production-app:current"
readonly PRODUCTION_MIGRATOR_TSX="/app/node_modules/.bin/tsx"
readonly PRODUCTION_CLASSIFIER_CLI="/app/scripts/ops/lib/classify-migrate-status-cli.ts"
readonly PRODUCTION_BACKUP_RETENTION_DAYS=30
readonly PRODUCTION_BACKUP_DUMP_NAME_RE='^[0-9]{8}T[0-9]{6}Z_[A-Za-z0-9._-]+\.dump$'

OPS_REPO_ROOT=""
OPS_DRY_RUN=0
OPS_TEMP_FILES=()
OPS_LAST_MIGRATE_CLASSIFICATION=""

ops_die() {
  echo "error: $*" >&2
  exit 1
}

ops_info() {
  echo "$*"
}

ops_warn() {
  echo "warning: $*" >&2
}

ops_require_commands() {
  local missing=()
  local cmd
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      missing+=("$cmd")
    fi
  done
  if ((${#missing[@]} > 0)); then
    ops_die "missing required commands: ${missing[*]}"
  fi
}

ops_find_repo_root() {
  local start_dir="${1:-$(pwd)}"
  local dir="$start_dir"
  while [[ "$dir" != "/" ]]; do
    if [[ -d "${dir}/.git" ]]; then
      OPS_REPO_ROOT="$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  ops_die "not inside a git repository (started from ${start_dir})"
}

ops_cd_repo_root() {
  ops_find_repo_root "${1:-$(pwd)}"
  cd "$OPS_REPO_ROOT" || ops_die "cannot cd to repository root"
}

ops_check_docker_daemon() {
  if ! docker info >/dev/null 2>&1; then
    ops_die "docker daemon is not available"
  fi
}

ops_check_docker_compose() {
  if ! docker compose version >/dev/null 2>&1; then
    ops_die "docker compose plugin is not available"
  fi
}

ops_compose() {
  docker compose \
    -f "$PRODUCTION_COMPOSE_FILE" \
    --env-file "$PRODUCTION_ENV_FILE" \
    "$@"
}

ops_compose_preflight() {
  if ! ops_compose --profile ops config --quiet >/dev/null 2>&1; then
    ops_die "docker compose config validation failed (check .env.production interpolation)"
  fi

  local services rendered
  services="$(ops_compose --profile ops config --services 2>/dev/null || true)"
  for required in app postgres migrator; do
    if ! grep -qx "$required" <<<"$services"; then
      ops_die "compose preflight: missing service ${required}"
    fi
  done

  rendered="$(ops_compose --profile ops config 2>/dev/null || true)"
  if grep -qE 'tvoe-vremya-staging' <<<"$rendered"; then
    ops_die "compose preflight: staging container names detected"
  fi
  if ! grep -q 'tvoe-vremya-production-app' <<<"$rendered"; then
    ops_die "compose preflight: production app container name missing"
  fi
  if ! grep -q 'tvoe-vremya-production-postgres' <<<"$rendered"; then
    ops_die "compose preflight: production postgres container name missing"
  fi

  local migrator_block
  migrator_block="$(ops_compose --profile ops config 2>/dev/null | awk '/^  migrator:/{flag=1} flag{print} /^  [a-z_]+:/{if(flag && $1!="migrator:") exit}')"
  if grep -qE '^    ports:' <<<"$migrator_block"; then
    ops_die "compose preflight: migrator must not publish ports"
  fi
  if ! grep -q 'profiles:' <<<"$migrator_block" || ! grep -q 'ops' <<<"$migrator_block"; then
    ops_die "compose preflight: migrator must use profile ops"
  fi
}

ops_assert_production_checkout() {
  local resolved

  ops_find_repo_root "$(pwd)"
  resolved="$(cd "$OPS_REPO_ROOT" && pwd -P 2>/dev/null || cd "$OPS_REPO_ROOT" && pwd)"

  if [[ "$resolved" == "$PRODUCTION_STAGING_REPO_ROOT" ]]; then
    ops_die "staging checkout detected (${PRODUCTION_STAGING_REPO_ROOT}); production ops are forbidden here"
  fi

  if [[ "$resolved" != "$PRODUCTION_EXPECTED_REPO_ROOT" ]]; then
    ops_die "production ops must run from ${PRODUCTION_EXPECTED_REPO_ROOT} (current: ${resolved})"
  fi

  if [[ ! -f "$PRODUCTION_COMPOSE_FILE" ]]; then
    ops_die "${PRODUCTION_COMPOSE_FILE} is missing in production checkout"
  fi

  if [[ ! -f "$PRODUCTION_ENV_FILE" ]]; then
    ops_die "${PRODUCTION_ENV_FILE} does not exist"
  fi
}

ops_sanitize_prisma_output() {
  grep -viE 'DATABASE_URL|postgresql://|PGPASSWORD|password=' "$@" 2>/dev/null || true
}

ops_print_pending_migration_names() {
  local output_file="$1"
  local names=()
  local line in_block=0

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ Following\ migration(s)?\ have\ not\ yet\ been\ applied: ]]; then
      in_block=1
      continue
    fi
    if (( in_block )); then
      line="${line#"${line%%[![:space:]]*}"}"
      [[ -z "$line" ]] && break
      [[ "$line" =~ ^To\ apply\ migrations ]] && break
      names+=("$line")
    fi
  done <"$output_file"

  if ((${#names[@]} == 0)); then
    ops_warn "pending migrations detected but names could not be parsed safely"
    return 1
  fi

  for line in "${names[@]}"; do
    ops_info "  - ${line}"
  done
}

ops_classify_prisma_migrate_output() {
  local exit_code="$1"
  local output_file="$2"
  local classification

  if [[ ! -f "$output_file" ]]; then
    ops_die "migrate status output file is missing"
  fi

  classification="$(ops_compose --profile ops run --rm --no-TTY -i \
    --entrypoint "$PRODUCTION_MIGRATOR_TSX" \
    migrator "$PRODUCTION_CLASSIFIER_CLI" "$exit_code" <"$output_file")" \
    || ops_die "migrate status classification failed inside migrator container"

  printf '%s' "$classification"
}

ops_run_prisma_migrate_status() {
  local phase="$1"
  local output_file exit_code classification

  output_file="$(mktemp)"
  ops_register_temp_file "$output_file"

  set +e
  ops_compose --profile ops run --rm --no-TTY migrator migrate status >"$output_file" 2>&1
  exit_code=$?
  set -e

  classification="$(ops_classify_prisma_migrate_output "$exit_code" "$output_file")"
  OPS_LAST_MIGRATE_CLASSIFICATION="$classification"

  case "$classification" in
    up_to_date)
      ops_info "Migration status: database schema is up to date"
      ;;
    pending)
      if [[ "$phase" == "post" ]]; then
        ops_warn "post-deploy migration status is not up to date"
        ops_sanitize_prisma_output "$output_file" >&2
        return 1
      fi
      ops_info "Migration status: pending migrations detected"
      ops_print_pending_migration_names "$output_file" || true
      ;;
    error:*)
      ops_warn "migration status failed (${classification#error:})"
      ops_sanitize_prisma_output "$output_file" >&2
      return 1
      ;;
    *)
      ops_warn "migration status returned unrecognized classification"
      ops_sanitize_prisma_output "$output_file" >&2
      return 1
      ;;
  esac

  return 0
}

ops_normalize_image_id() {
  local image_id
  local stdin_line extra_line

  if (( $# >= 1 )); then
    image_id="$1"
  else
    if ! IFS= read -r stdin_line; then
      echo "ops_normalize_image_id: missing image id input" >&2
      return 1
    fi
    image_id="$stdin_line"
    if IFS= read -r extra_line && [[ -n "$extra_line" ]]; then
      echo "ops_normalize_image_id: expected a single image id line" >&2
      return 1
    fi
  fi

  image_id="${image_id#sha256:}"

  if [[ -z "$image_id" ]]; then
    echo "ops_normalize_image_id: empty image id" >&2
    return 1
  fi

  if [[ ! "$image_id" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo "ops_normalize_image_id: invalid docker image id" >&2
    return 1
  fi

  printf '%s' "$image_id"
}

ops_get_image_id_from_ref() {
  local ref="$1"
  local raw_id

  raw_id="$(docker image inspect --format '{{.Id}}' "$ref")"
  ops_normalize_image_id "$raw_id"
}

ops_get_image_id_from_ref_optional() {
  local ref="$1"
  local raw_id

  if ! docker image inspect "$ref" >/dev/null 2>&1; then
    return 0
  fi

  raw_id="$(docker image inspect --format '{{.Id}}' "$ref")"
  ops_normalize_image_id "$raw_id"
}

ops_assert_container_image_matches() {
  local container="$1"
  local expected_id="$2"
  local actual_id

  actual_id="$(ops_get_container_image_id "$container" | ops_normalize_image_id)"
  expected_id="$(ops_normalize_image_id "$expected_id")"

  if [[ -z "$actual_id" || -z "$expected_id" ]]; then
    return 1
  fi
  [[ "$actual_id" == "$expected_id" ]]
}

ops_apply_compose_app_image() {
  local source_ref="$1"
  docker tag "$source_ref" "$PRODUCTION_APP_IMAGE_REF"
  local tagged_id expected_id
  tagged_id="$(ops_get_image_id_from_ref "$PRODUCTION_APP_IMAGE_REF")"
  expected_id="$(ops_get_image_id_from_ref "$source_ref")"
  if [[ -z "$tagged_id" || "$tagged_id" != "$expected_id" ]]; then
    ops_die "failed to tag source image onto ${PRODUCTION_APP_IMAGE_REF}"
  fi
}

ops_recreate_app_container() {
  ops_compose up -d --no-deps --no-build --force-recreate app
}

ops_is_true() {
  [[ "${1,,}" == "true" ]]
}

ops_is_disabled_mail_provider() {
  local provider="${1:-}"
  provider="${provider,,}"
  [[ -z "$provider" || "$provider" == "disabled" ]]
}

ops_read_env_value() {
  local name="$1"
  local file="$2"
  local line key value

  if [[ ! -f "$file" ]]; then
    return 1
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      if [[ "$key" != "$name" ]]; then
        continue
      fi
      value="${value%%#*}"
      value="${value%"${value##*[![:space:]]}"}"
      value="${value#"${value%%[![:space:]]*}"}"
      if [[ "$value" =~ ^\"(.*)\"$ ]]; then
        printf '%s' "${BASH_REMATCH[1]}"
        return 0
      fi
      if [[ "$value" =~ ^\'(.*)\'$ ]]; then
        printf '%s' "${BASH_REMATCH[1]}"
        return 0
      fi
      printf '%s' "$value"
      return 0
    fi
  done <"$file"

  return 1
}

ops_validate_auth_url_production() {
  local auth_url="$1"

  [[ -n "$auth_url" && "$auth_url" =~ ^https://[^[:space:]]+$ ]]
}

ops_validate_secret_min_length() {
  local value="$1"
  local min_len="$2"
  [[ -n "$value" && "${#value}" -ge "$min_len" ]]
}

ops_check_env_file_permissions() {
  local file="$1"
  local mode owner

  if [[ ! -f "$file" ]]; then
    ops_die "${file} does not exist"
  fi

  if [[ -L "$file" ]]; then
    ops_die "${file} must not be a symlink"
  fi

  owner="$(stat -c '%U' "$file" 2>/dev/null || true)"
  if [[ -z "$owner" ]]; then
    ops_die "cannot read owner of ${file}"
  fi
  if [[ "$owner" != "$(whoami)" ]]; then
    ops_die "${file} must be owned by $(whoami), found ${owner}"
  fi

  mode="$(stat -c '%a' "$file")"
  local other=$((mode % 10))
  local group=$(((mode / 10) % 10))
  if (( (group & 4) != 0 || (other & 4) != 0 )); then
    ops_die "${file} must not be readable by group or others (mode ${mode})"
  fi
}

ops_report_env_check() {
  local name="$1"
  local status="$2"
  ops_info "  ${name}: ${status}"
}

ops_validate_production_env_file() {
  local file="$PRODUCTION_ENV_FILE"
  local app_env auth_secret auth_url schedule_token
  local postgres_user postgres_password postgres_db
  local trust_proxy mail_provider
  local mail_from_address smtp_host smtp_user smtp_password smtp_port smtp_secure

  ops_check_env_file_permissions "$file"

  app_env="$(ops_read_env_value APP_ENV "$file" || true)"
  if [[ -z "$app_env" ]]; then
    ops_report_env_check APP_ENV MISSING
    ops_die "APP_ENV is required"
  fi
  if [[ "$app_env" != "production" ]]; then
    ops_report_env_check APP_ENV INVALID
    ops_die "APP_ENV must be exactly production"
  fi
  ops_report_env_check APP_ENV OK

  postgres_user="$(ops_read_env_value POSTGRES_USER "$file" || true)"
  postgres_password="$(ops_read_env_value POSTGRES_PASSWORD "$file" || true)"
  postgres_db="$(ops_read_env_value POSTGRES_DB "$file" || true)"

  for pair in "POSTGRES_USER:$postgres_user" "POSTGRES_PASSWORD:$postgres_password" "POSTGRES_DB:$postgres_db"; do
    local key="${pair%%:*}"
    local val="${pair#*:}"
    if [[ -z "$val" ]]; then
      ops_report_env_check "$key" MISSING
      ops_die "${key} must not be empty"
    fi
    ops_report_env_check "$key" OK
  done

  auth_secret="$(ops_read_env_value AUTH_SECRET "$file" || true)"
  if ! ops_validate_secret_min_length "$auth_secret" 32; then
    ops_report_env_check AUTH_SECRET INVALID
    ops_die "AUTH_SECRET must be at least 32 characters"
  fi
  ops_report_env_check AUTH_SECRET OK

  schedule_token="$(ops_read_env_value SCHEDULE_VIEW_TOKEN "$file" || true)"
  if ! ops_validate_secret_min_length "$schedule_token" 32; then
    ops_report_env_check SCHEDULE_VIEW_TOKEN INVALID
    ops_die "SCHEDULE_VIEW_TOKEN must be at least 32 characters"
  fi
  ops_report_env_check SCHEDULE_VIEW_TOKEN OK

  auth_url="$(ops_read_env_value AUTH_URL "$file" || true)"
  if ! ops_validate_auth_url_production "$auth_url"; then
    ops_report_env_check AUTH_URL INVALID
    ops_die "AUTH_URL must be a public HTTPS URL (https://...)"
  fi
  ops_report_env_check AUTH_URL OK

  trust_proxy="$(ops_read_env_value TRUST_PROXY_HEADERS "$file" || true)"
  if ! ops_is_true "$trust_proxy"; then
    ops_report_env_check TRUST_PROXY_HEADERS INVALID
    ops_die "TRUST_PROXY_HEADERS must be true in production (reverse proxy expected)"
  fi
  ops_report_env_check TRUST_PROXY_HEADERS OK

  mail_provider="$(ops_read_env_value MAIL_PROVIDER "$file" || true)"
  if ops_is_disabled_mail_provider "$mail_provider"; then
    ops_report_env_check MAIL_PROVIDER OK
    return 0
  fi

  mail_from_address="$(ops_read_env_value MAIL_FROM_ADDRESS "$file" || true)"
  smtp_host="$(ops_read_env_value SMTP_HOST "$file" || true)"
  smtp_user="$(ops_read_env_value SMTP_USER "$file" || true)"
  smtp_password="$(ops_read_env_value SMTP_PASSWORD "$file" || true)"
  smtp_port="$(ops_read_env_value SMTP_PORT "$file" || true)"
  smtp_secure="$(ops_read_env_value SMTP_SECURE "$file" || true)"

  for pair in \
    "MAIL_FROM_ADDRESS:$mail_from_address" \
    "SMTP_HOST:$smtp_host" \
    "SMTP_USER:$smtp_user" \
    "SMTP_PASSWORD:$smtp_password" \
    "SMTP_PORT:$smtp_port" \
    "SMTP_SECURE:$smtp_secure"; do
    local key="${pair%%:*}"
    local val="${pair#*:}"
    if [[ -z "$val" ]]; then
      ops_report_env_check "$key" MISSING
      ops_die "${key} is required when MAIL_PROVIDER is not disabled"
    fi
    ops_report_env_check "$key" OK
  done
}

ops_ensure_private_dir() {
  local dir="$1"
  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    return 0
  fi
  if [[ ! -d "$dir" ]]; then
    mkdir -p "$dir"
  fi
  chmod 700 "$dir"
}

ops_register_temp_file() {
  OPS_TEMP_FILES+=("$1")
}

ops_cleanup_temp_files() {
  local f
  for f in "${OPS_TEMP_FILES[@]}"; do
    if [[ -n "$f" && -f "$f" ]]; then
      rm -f -- "$f"
    fi
  done
}

ops_on_exit_cleanup() {
  ops_cleanup_temp_files
}

ops_setup_common_traps() {
  trap 'ops_on_exit_cleanup' EXIT
  trap 'ops_on_exit_cleanup; exit 130' INT
  trap 'ops_on_exit_cleanup; exit 143' TERM
}

ops_assert_backups_gitignored() {
  if [[ ! -f .gitignore ]]; then
    ops_die ".gitignore is missing"
  fi
  if ! grep -qE '^/backups/' .gitignore; then
    ops_die "backups/ must be listed in .gitignore"
  fi
}

ops_container_exists() {
  docker inspect "$1" >/dev/null 2>&1
}

ops_container_running() {
  local state
  state="$(docker inspect --format '{{.State.Running}}' "$1" 2>/dev/null || echo false)"
  [[ "$state" == "true" ]]
}

ops_container_healthy() {
  local status
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo missing)"
  [[ "$status" == "healthy" ]]
}

ops_get_container_image_id() {
  docker inspect --format '{{.Image}}' "$1" 2>/dev/null || true
}

ops_get_container_image_reference() {
  local container="$1"
  local image_id tags config_image

  image_id="$(ops_get_container_image_id "$container")"
  if [[ -z "$image_id" ]]; then
    return 1
  fi

  tags="$(docker image inspect --format '{{if .RepoTags}}{{join .RepoTags ","}}{{end}}' "$image_id" 2>/dev/null || true)"
  if [[ -n "$tags" ]]; then
    printf '%s' "$tags"
    return 0
  fi

  config_image="$(docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null || true)"
  if [[ -n "$config_image" ]]; then
    printf '%s' "$config_image"
    return 0
  fi

  printf '%s' "$image_id"
}

ops_wait_for_docker_health() {
  local container="$1"
  local deadline=$((SECONDS + PRODUCTION_DOCKER_HEALTH_TIMEOUT_SEC))
  local status

  while (( SECONDS < deadline )); do
    if ! ops_container_running "$container"; then
      return 1
    fi
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo missing)"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    if [[ "$status" == "unhealthy" ]]; then
      return 1
    fi
    sleep "$PRODUCTION_DOCKER_HEALTH_INTERVAL_SEC"
  done
  return 1
}

ops_check_http_health_production() {
  local body_file

  body_file="$(mktemp)"
  ops_register_temp_file "$body_file"

  if ! curl \
    --fail \
    --silent \
    --show-error \
    --max-time "$PRODUCTION_HTTP_HEALTH_TIMEOUT_SEC" \
    --no-location \
    -o "$body_file" \
    "$PRODUCTION_HEALTH_URL"; then
    return 1
  fi

  if ! grep -qE '"ok"[[:space:]]*:[[:space:]]*true' "$body_file"; then
    return 1
  fi
  if ! grep -qE '"status"[[:space:]]*:[[:space:]]*"healthy"' "$body_file"; then
    return 1
  fi

  return 0
}

ops_show_safe_app_logs() {
  local container="$1"
  local lines="${2:-15}"
  ops_warn "last ${lines} lines of app logs (sanitized output not guaranteed — review carefully):"
  docker logs --tail "$lines" "$container" 2>&1 || true
}

ops_escape_manifest_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  printf '%s' "$value"
}

ops_write_manifest_file() {
  local path="$1"
  shift
  local -a lines=("$@")
  local tmp line

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    return 0
  fi

  tmp="${path}.tmp.$$"
  ops_register_temp_file "$tmp"
  : >"$tmp"
  for line in "${lines[@]}"; do
    printf '%s\n' "$line" >>"$tmp"
  done
  chmod 600 "$tmp"
  mv -f -- "$tmp" "$path"
}

ops_update_latest_symlink() {
  local manifest_path="$1"
  local dir="$PRODUCTION_DEPLOY_STATE_DIR"
  local base tmp_link

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    return 0
  fi

  base="$(basename "$manifest_path")"
  if [[ "$manifest_path" != "${dir}/${base}" ]]; then
    ops_die "manifest must be inside ${dir}"
  fi

  tmp_link="${dir}/latest.tmp.$$"
  ln -sfn "$base" "$tmp_link"
  mv -Tf "$tmp_link" "${dir}/latest"
}

ops_read_manifest_value() {
  local file="$1"
  local key="$2"
  local line k v

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      k="${BASH_REMATCH[1]}"
      v="${BASH_REMATCH[2]}"
      if [[ "$k" == "$key" ]]; then
        printf '%s' "$v"
        return 0
      fi
    fi
  done <"$file"
  return 1
}

ops_resolve_manifest_path() {
  local requested="$1"
  local dir="$PRODUCTION_DEPLOY_STATE_DIR"
  local resolved base_dir

  if [[ -z "$requested" || "$requested" == "latest" ]]; then
    if [[ ! -L "${dir}/latest" && ! -f "${dir}/latest" ]]; then
      ops_die "no production deploy state manifest found (missing ${dir}/latest)"
    fi
    requested="${dir}/latest"
  fi

  if [[ "$requested" != /* ]]; then
    requested="${OPS_REPO_ROOT}/${requested}"
  fi

  base_dir="$(cd "$dir" && pwd)"
  resolved="$(readlink -f "$requested" 2>/dev/null || realpath "$requested" 2>/dev/null || true)"
  if [[ -z "$resolved" ]]; then
    ops_die "cannot resolve manifest path"
  fi

  if [[ "$resolved" != "${base_dir}/"* ]]; then
    ops_die "manifest path must stay inside ${dir}"
  fi
  if [[ -L "$resolved" ]]; then
    ops_die "manifest must not be a symlink"
  fi
  if [[ ! -f "$resolved" ]]; then
    ops_die "manifest file does not exist"
  fi

  printf '%s' "$resolved"
}

ops_validate_backup_path() {
  local backup_path="$1"
  local dir="${OPS_REPO_ROOT}/${PRODUCTION_BACKUPS_POSTGRES_DIR}"
  local resolved base

  if [[ -z "$backup_path" ]]; then
    ops_die "backup path is required"
  fi
  if [[ "$backup_path" == /tmp/* ]]; then
    ops_die "backup must not be in /tmp"
  fi
  if [[ "$backup_path" != /* ]]; then
    backup_path="${OPS_REPO_ROOT}/${backup_path}"
  fi

  base="$(cd "$dir" && pwd)"
  resolved="$(readlink -f "$backup_path" 2>/dev/null || realpath "$backup_path" 2>/dev/null || true)"
  if [[ -z "$resolved" || "$resolved" != "${base}/"* ]]; then
    ops_die "backup must be inside ${PRODUCTION_BACKUPS_POSTGRES_DIR}"
  fi
  if [[ -L "$resolved" ]]; then
    ops_die "backup must not be a symlink"
  fi
  if [[ ! -f "$resolved" ]]; then
    ops_die "backup file does not exist"
  fi
  if [[ "$resolved" != *.dump ]]; then
    ops_die "backup must have .dump extension"
  fi

  local mode owner size
  owner="$(stat -c '%U' "$resolved")"
  if [[ "$owner" != "$(whoami)" ]]; then
    ops_die "backup must be owned by $(whoami)"
  fi
  mode="$(stat -c '%a' "$resolved")"
  local other=$((mode % 10))
  local group=$(((mode / 10) % 10))
  if (( (group & 4) != 0 || (other & 4) != 0 )); then
    ops_die "backup must not be readable by group or others"
  fi
  size="$(stat -c '%s' "$resolved")"
  if (( size <= 0 )); then
    ops_die "backup file is empty"
  fi

  printf '%s' "$resolved"
}

ops_verify_pg_dump_file() {
  local dump_path="$1"
  local container="$PRODUCTION_POSTGRES_CONTAINER"
  local remote_path="/tmp/ops-verify-$$.dump"
  local copied=0
  local status=0

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    return 0
  fi

  ops_pg_dump_verify_remove_remote() {
    if (( copied )); then
      docker exec "$container" rm -f -- "$remote_path" >/dev/null 2>&1 || true
      copied=0
    fi
  }

  ops_pg_dump_verify_on_signal() {
    ops_pg_dump_verify_remove_remote
    trap - INT TERM
    exit "$1"
  }

  trap 'ops_pg_dump_verify_on_signal 130' INT
  trap 'ops_pg_dump_verify_on_signal 143' TERM

  if ! docker cp "$dump_path" "${container}:${remote_path}"; then
    trap - INT TERM
    return 1
  fi
  copied=1

  set +e
  docker exec "$container" pg_restore -l "$remote_path" >/dev/null
  status=$?
  set -e

  ops_pg_dump_verify_remove_remote
  trap - INT TERM

  set +e
  return "$status"
}

ops_create_production_postgres_backup() {
  local target_sha="$1"
  local timestamp_utc backup_name backup_path tmp_path pg_user pg_db

  timestamp_utc="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_name="${timestamp_utc}_${target_sha}.dump"
  backup_path="${PRODUCTION_BACKUPS_POSTGRES_DIR}/${backup_name}"
  tmp_path="${backup_path}.tmp.$$"

  ops_ensure_private_dir "$PRODUCTION_BACKUPS_POSTGRES_DIR"

  if [[ -e "$backup_path" ]]; then
    ops_die "backup already exists: ${backup_path}"
  fi

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    printf '%s' "$backup_path"
    return 0
  fi

  if ! ops_container_exists "$PRODUCTION_POSTGRES_CONTAINER"; then
    ops_die "postgres container does not exist"
  fi
  if ! ops_container_running "$PRODUCTION_POSTGRES_CONTAINER"; then
    ops_die "postgres container is not running"
  fi
  if ! ops_container_healthy "$PRODUCTION_POSTGRES_CONTAINER"; then
    ops_die "postgres container is not healthy"
  fi

  pg_user="$(ops_read_env_value POSTGRES_USER "$PRODUCTION_ENV_FILE")"
  pg_db="$(ops_read_env_value POSTGRES_DB "$PRODUCTION_ENV_FILE")"

  ops_register_temp_file "$tmp_path"

  docker exec "$PRODUCTION_POSTGRES_CONTAINER" \
    pg_dump -U "$pg_user" -d "$pg_db" -Fc \
    >"$tmp_path"

  chmod 600 "$tmp_path"
  if [[ ! -f "$tmp_path" ]] || [[ -L "$tmp_path" ]]; then
    ops_die "backup temp file was not created correctly"
  fi
  if [[ ! -s "$tmp_path" ]]; then
    ops_die "backup file is empty"
  fi

  if ! ops_verify_pg_dump_file "$tmp_path"; then
    ops_die "backup verification failed"
  fi

  mv -f -- "$tmp_path" "$backup_path"
  printf '%s' "$backup_path"
}

ops_acquire_production_ops_lock() {
  ops_ensure_private_dir "$PRODUCTION_DEPLOY_STATE_DIR"
  exec 9>"$PRODUCTION_LOCK_FILE"
  if ! flock -n 9; then
    ops_die "another production operation is already in progress (lock: ${PRODUCTION_LOCK_FILE})"
  fi
}

ops_require_interactive_confirmation() {
  local expected="$1"
  local prompt="$2"
  local answer

  if [[ ! -t 0 ]]; then
    ops_die "interactive confirmation required but no TTY available"
  fi

  ops_info "$prompt"
  IFS= read -r answer
  if [[ "$answer" != "$expected" ]]; then
    ops_die "confirmation failed; expected exact input: ${expected}"
  fi
}

ops_assess_rollback_migration_risk() {
  local manifest="$1"
  local migration_status deploy_status

  migration_status="$(ops_read_manifest_value "$manifest" MIGRATION_STATUS || true)"
  deploy_status="$(ops_read_manifest_value "$manifest" DEPLOY_STATUS || true)"

  case "$migration_status" in
    applied)
      ops_warn "MIGRATION_STATUS=applied: app rollback may be incompatible with the current database schema."
      ops_warn "Database will NOT be restored automatically. Plan manual recovery if needed."
      ;;
    precheck_failed|postcheck_failed|failed)
      ops_die "migration status is ${migration_status}; resolve database state manually before app rollback"
      ;;
  esac

  case "$deploy_status" in
    failed_migration)
      ops_warn "deploy failed during migrations; app rollback alone may not restore service."
      ;;
  esac
}

ops_validate_retention_days() {
  local value="$1"
  if [[ -z "$value" || ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    ops_die "--retention-days must be a positive integer"
  fi
  if (( value > 3650 )); then
    ops_die "--retention-days exceeds safe maximum (3650)"
  fi
}

ops_is_production_backup_dump_basename() {
  local name="$1"
  [[ "$name" =~ $PRODUCTION_BACKUP_DUMP_NAME_RE ]]
}

ops_production_backup_epoch() {
  local basename="$1"
  local ts="${basename%%_*}"
  if [[ ! "$ts" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
    return 1
  fi
  date -u -d \
    "${ts:0:4}-${ts:4:2}-${ts:6:2} ${ts:9:2}:${ts:11:2}:${ts:13:2}" \
    +%s 2>/dev/null
}

ops_purge_expired_production_backups() {
  local retention_days="${1:-$PRODUCTION_BACKUP_RETENTION_DAYS}"
  local dir resolved cutoff_epoch purged=0 basename file file_epoch file_resolved

  ops_validate_retention_days "$retention_days"
  dir="${OPS_REPO_ROOT}/${PRODUCTION_BACKUPS_POSTGRES_DIR}"
  if [[ ! -d "$dir" ]]; then
    if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
      printf '%s' "0"
      return 0
    fi
    ops_die "production backup directory does not exist: ${dir}"
  fi
  resolved="$(cd "$dir" && pwd)"
  cutoff_epoch="$(date -u -d "${retention_days} days ago" +%s)"

  shopt -s nullglob
  for file in "${resolved}"/*.dump; do
    [[ -f "$file" ]] || continue
    [[ -L "$file" ]] && continue
    basename="$(basename "$file")"
    if ! ops_is_production_backup_dump_basename "$basename"; then
      ops_warn "skipping non-production backup filename: ${basename}"
      continue
    fi
    file_epoch="$(ops_production_backup_epoch "$basename" || true)"
    if [[ -z "$file_epoch" ]]; then
      ops_warn "skipping backup with unparseable timestamp: ${basename}"
      continue
    fi
    if (( file_epoch >= cutoff_epoch )); then
      continue
    fi
    file_resolved="$(readlink -f "$file" 2>/dev/null || realpath "$file" 2>/dev/null || true)"
    if [[ -z "$file_resolved" || "$file_resolved" != "${resolved}/"* ]]; then
      ops_die "retention safety: file is outside ${PRODUCTION_BACKUPS_POSTGRES_DIR}"
    fi
    if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
      ops_info "  retention: would remove ${basename}"
    else
      rm -f -- "$file_resolved"
    fi
    purged=$((purged + 1))
  done
  shopt -u nullglob

  printf '%s' "$purged"
}

ops_write_production_backup_manifest() {
  local backup_path="$1"
  local retention_days="$2"
  local purged_count="$3"
  local status="$4"
  local ts manifest_path commit_sha

  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  commit_sha="$(git -C "$OPS_REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  manifest_path="${PRODUCTION_DEPLOY_STATE_DIR}/${ts}_backup.env"

  ops_write_manifest_file "$manifest_path" \
    "STATE_VERSION=${PRODUCTION_STATE_VERSION}" \
    "TIMESTAMP_UTC=${ts}" \
    "ENVIRONMENT=production" \
    "BACKUP_KIND=manual_or_scheduled" \
    "COMMIT_SHA=$(ops_escape_manifest_value "$commit_sha")" \
    "BACKUP_PATH=$(ops_escape_manifest_value "$backup_path")" \
    "BACKUP_STATUS=$(ops_escape_manifest_value "$status")" \
    "RETENTION_DAYS=${retention_days}" \
    "PURGED_COUNT=${purged_count}"

  printf '%s' "$manifest_path"
}
