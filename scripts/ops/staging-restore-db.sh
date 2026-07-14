#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/staging-ops-common.sh
source "${SCRIPT_DIR}/lib/staging-ops-common.sh"

RESTORE_HELP=0
BACKUP_ARG=""
PRE_RESTORE_BACKUP=""
RESTORE_MANIFEST=""
RESTORE_PG_USER=""
RESTORE_PG_PASSWORD=""
RESTORE_PG_DB=""
DOCKER_HEALTH_STATUS="pending"
HTTP_HEALTH_STATUS="pending"

usage() {
  cat <<'EOF'
Usage: scripts/ops/staging-restore-db.sh --backup PATH [--dry-run] [--help]

Manually restore staging PostgreSQL from a custom-format dump.
Never called automatically by staging deploy.

Options:
  --backup PATH  Required path to .dump inside backups/postgres/
  --dry-run      Validate and print plan only
  --help         Show this help

Confirmation phrase (case-sensitive): RESTORE STAGING DATABASE
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --backup)
        shift
        [[ $# -gt 0 ]] || ops_die "--backup requires a value"
        if [[ -n "$BACKUP_ARG" ]]; then
          ops_die "duplicate --backup"
        fi
        BACKUP_ARG="$1"
        ;;
      --dry-run)
        if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
          ops_die "duplicate --dry-run"
        fi
        OPS_DRY_RUN=1
        ;;
      --help|-h)
        if [[ "$RESTORE_HELP" -eq 1 ]]; then
          ops_die "duplicate --help"
        fi
        RESTORE_HELP=1
        ;;
      *)
        ops_die "unknown argument: $1"
        ;;
    esac
    shift
  done

  if [[ "$RESTORE_HELP" -eq 1 ]]; then
    if [[ "$OPS_DRY_RUN" -eq 1 || -n "$BACKUP_ARG" ]]; then
      ops_die "--help cannot be combined with other options"
    fi
    usage
    exit 0
  fi

  if [[ -z "$BACKUP_ARG" ]]; then
    ops_die "--backup is required"
  fi
}

assert_staging_only() {
  local app_env
  app_env="$(ops_read_env_value APP_ENV "$STAGING_ENV_FILE" || true)"
  if [[ "$app_env" != "staging" ]]; then
    ops_die "DB restore is allowed only when APP_ENV=staging"
  fi
}

load_restore_db_context() {
  local pg_user pg_password pg_db
  pg_user="$(ops_read_env_value POSTGRES_USER "$STAGING_ENV_FILE")"
  pg_password="$(ops_read_env_value POSTGRES_PASSWORD "$STAGING_ENV_FILE")"
  pg_db="$(ops_read_env_value POSTGRES_DB "$STAGING_ENV_FILE")"

  ops_validate_postgres_identifier "$pg_user" "POSTGRES_USER"
  ops_validate_postgres_identifier "$pg_db" "POSTGRES_DB"

  RESTORE_PG_USER="$pg_user"
  RESTORE_PG_PASSWORD="$pg_password"
  RESTORE_PG_DB="$pg_db"
}

restore_database_in_container() {
  local backup_path="$1"
  local remote_dump="/tmp/ops-restore-$$.dump"
  local copied=0
  local quoted_db quoted_user

  quoted_db="\"${RESTORE_PG_DB}\""
  quoted_user="\"${RESTORE_PG_USER}\""

  cleanup_remote() {
    if (( copied )); then
      docker exec "$STAGING_POSTGRES_CONTAINER" rm -f -- "$remote_dump" >/dev/null 2>&1 || true
    fi
  }
  trap cleanup_remote RETURN

  docker cp "$backup_path" "${STAGING_POSTGRES_CONTAINER}:${remote_dump}"
  copied=1

  docker exec -e PGPASSWORD="$RESTORE_PG_PASSWORD" "$STAGING_POSTGRES_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U "$RESTORE_PG_USER" -d postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${RESTORE_PG_DB}' AND pid <> pg_backend_pid();"

  docker exec -e PGPASSWORD="$RESTORE_PG_PASSWORD" "$STAGING_POSTGRES_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U "$RESTORE_PG_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS ${quoted_db};" \
    -c "CREATE DATABASE ${quoted_db} OWNER ${quoted_user};"

  docker exec -e PGPASSWORD="$RESTORE_PG_PASSWORD" "$STAGING_POSTGRES_CONTAINER" \
    pg_restore --exit-on-error -U "$RESTORE_PG_USER" -d "$RESTORE_PG_DB" "$remote_dump"

  docker exec "$STAGING_POSTGRES_CONTAINER" rm -f -- "$remote_dump"
  copied=0
  trap - RETURN
}

write_restore_manifest() {
  local ts status="$1"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  RESTORE_MANIFEST="${STAGING_DEPLOY_STATE_DIR}/${ts}_restore.env"

  ops_write_manifest_file "$RESTORE_MANIFEST" \
    "STATE_VERSION=${STAGING_STATE_VERSION}" \
    "TIMESTAMP_UTC=${ts}" \
    "RESTORE_SOURCE_BACKUP=$(ops_escape_manifest_value "$BACKUP_ARG")" \
    "PRE_RESTORE_BACKUP=$(ops_escape_manifest_value "$PRE_RESTORE_BACKUP")" \
    "RESTORE_STATUS=$(ops_escape_manifest_value "$status")" \
    "DOCKER_HEALTH_STATUS=$(ops_escape_manifest_value "$DOCKER_HEALTH_STATUS")" \
    "HTTP_HEALTH_STATUS=$(ops_escape_manifest_value "$HTTP_HEALTH_STATUS")"
}

main() {
  local resolved_backup

  parse_args "$@"
  ops_setup_common_traps
  ops_cd_repo_root "$(pwd)"
  ops_require_commands docker curl
  ops_check_docker_daemon
  ops_check_docker_compose
  ops_compose_preflight

  if [[ ! -f "$STAGING_ENV_FILE" ]]; then
    ops_die "${STAGING_ENV_FILE} does not exist"
  fi
  ops_check_env_file_permissions "$STAGING_ENV_FILE"
  assert_staging_only
  load_restore_db_context

  resolved_backup="$(ops_validate_backup_path "$BACKUP_ARG")"
  BACKUP_ARG="$resolved_backup"
  ops_verify_pg_dump_file "$BACKUP_ARG"

  ops_info "=== Staging database restore plan ==="
  ops_info "Source backup: ${BACKUP_ARG}"
  ops_warn "The current staging database will be replaced (DROP DATABASE + CREATE + pg_restore)."
  ops_info "App will be stopped during restore; PostgreSQL container and volume are preserved."

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_info "Dry-run complete — no database or Docker changes were made."
    exit 0
  fi

  ops_require_interactive_confirmation "RESTORE STAGING DATABASE" \
    "Type RESTORE STAGING DATABASE to continue:"

  if ! ops_container_healthy "$STAGING_POSTGRES_CONTAINER"; then
    ops_die "postgres container must be healthy before restore"
  fi

  PRE_RESTORE_BACKUP="$(ops_create_postgres_backup "prerestore")"
  ops_info "Pre-restore backup: ${PRE_RESTORE_BACKUP}"

  ops_compose stop app

  if ! restore_database_in_container "$BACKUP_ARG"; then
    write_restore_manifest "failed"
    ops_die "database restore failed (pre-restore backup: ${PRE_RESTORE_BACKUP})"
  fi

  ops_compose up -d --no-deps --no-build app

  if ops_wait_for_docker_health "$STAGING_APP_CONTAINER"; then
    DOCKER_HEALTH_STATUS="healthy"
  else
    DOCKER_HEALTH_STATUS="unhealthy"
    write_restore_manifest "failed_health"
    ops_die "docker health failed after restore"
  fi

  if ops_check_http_health; then
    HTTP_HEALTH_STATUS="ok"
  else
    HTTP_HEALTH_STATUS="failed"
    write_restore_manifest "failed_http"
    ops_die "HTTP health failed after restore"
  fi

  write_restore_manifest "success"
  ops_info "Database restore complete."
  ops_info "  source backup: ${BACKUP_ARG}"
  ops_info "  pre-restore backup: ${PRE_RESTORE_BACKUP}"
  ops_info "  manifest: ${RESTORE_MANIFEST}"
}

main "$@"
