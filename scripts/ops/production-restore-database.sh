#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/production-ops-common.sh
source "${SCRIPT_DIR}/lib/production-ops-common.sh"

RESTORE_HELP=0
RESTORE_APPLY=0
BACKUP_ARG=""
PRE_RESTORE_BACKUP=""
RESTORE_MANIFEST=""
RESTORE_PG_USER=""
RESTORE_PG_PASSWORD=""
RESTORE_PG_DB=""
TEMP_DB_NAME=""
ROLLBACK_DB_NAME=""
COMMIT_SHA=""
VERIFY_STATUS="pending"
TEMP_RESTORE_STATUS="pending"
SWITCH_STATUS="pending"
DOCKER_HEALTH_STATUS="pending"
HTTP_HEALTH_STATUS="pending"
RESTORE_STATUS="pending"
LAST_ERROR_SUMMARY=""

usage() {
  cat <<'EOF'
Usage: scripts/ops/production-restore-database.sh --backup PATH [--dry-run | --apply] [--help]

Manually restore production PostgreSQL from an explicit custom-format dump.
Never called automatically by deploy, rollback, or backup timer.

Options:
  --backup PATH  Required path to .dump inside backups/production/postgres/
  --dry-run      Validate source dump and print plan only (no lock or mutations)
  --apply        Perform restore (requires interactive confirmation)
  --help         Show this help

Real restore requires both --apply and --backup.
Confirmation phrase (case-sensitive): RESTORE PRODUCTION DATABASE

Requires: git, docker, flock, curl; run from /opt/online-zapis-tv-production.
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
      --apply)
        if [[ "$RESTORE_APPLY" -eq 1 ]]; then
          ops_die "duplicate --apply"
        fi
        RESTORE_APPLY=1
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
    if [[ "$OPS_DRY_RUN" -eq 1 || "$RESTORE_APPLY" -eq 1 || -n "$BACKUP_ARG" ]]; then
      ops_die "--help cannot be combined with other options"
    fi
    usage
    exit 0
  fi

  if [[ -z "$BACKUP_ARG" ]]; then
    ops_die "--backup is required"
  fi

  if [[ "$RESTORE_APPLY" -eq 1 && "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_die "--apply cannot be combined with --dry-run"
  fi

  if [[ "$RESTORE_APPLY" -eq 0 && "$OPS_DRY_RUN" -eq 0 ]]; then
    ops_die "specify --dry-run to validate safely or --apply to restore"
  fi
}

load_restore_db_context() {
  RESTORE_PG_USER="$(ops_read_env_value POSTGRES_USER "$PRODUCTION_ENV_FILE")"
  RESTORE_PG_PASSWORD="$(ops_read_env_value POSTGRES_PASSWORD "$PRODUCTION_ENV_FILE")"
  RESTORE_PG_DB="$(ops_read_env_value POSTGRES_DB "$PRODUCTION_ENV_FILE")"

  ops_validate_postgres_identifier "$RESTORE_PG_USER" "POSTGRES_USER"
  ops_validate_postgres_identifier "$RESTORE_PG_DB" "POSTGRES_DB"
}

persist_restore_manifest() {
  local ts="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"

  if [[ -z "$RESTORE_MANIFEST" ]]; then
    RESTORE_MANIFEST="${PRODUCTION_DEPLOY_STATE_DIR}/${ts}_restore.env"
  fi

  ops_ensure_private_dir "$PRODUCTION_DEPLOY_STATE_DIR"

  ops_write_manifest_file "$RESTORE_MANIFEST" \
    "STATE_VERSION=${PRODUCTION_STATE_VERSION}" \
    "TIMESTAMP_UTC=${ts}" \
    "ENVIRONMENT=production" \
    "COMMIT_SHA=$(ops_escape_manifest_value "$COMMIT_SHA")" \
    "SOURCE_BACKUP_PATH=$(ops_escape_manifest_value "$BACKUP_ARG")" \
    "PRE_RESTORE_BACKUP_PATH=$(ops_escape_manifest_value "${PRE_RESTORE_BACKUP:-}")" \
    "TEMP_DB_NAME=$(ops_escape_manifest_value "${TEMP_DB_NAME:-}")" \
    "ROLLBACK_DB_NAME=$(ops_escape_manifest_value "${ROLLBACK_DB_NAME:-}")" \
    "VERIFY_STATUS=$(ops_escape_manifest_value "$VERIFY_STATUS")" \
    "TEMP_RESTORE_STATUS=$(ops_escape_manifest_value "$TEMP_RESTORE_STATUS")" \
    "SWITCH_STATUS=$(ops_escape_manifest_value "$SWITCH_STATUS")" \
    "DOCKER_HEALTH_STATUS=$(ops_escape_manifest_value "$DOCKER_HEALTH_STATUS")" \
    "HTTP_HEALTH_STATUS=$(ops_escape_manifest_value "$HTTP_HEALTH_STATUS")" \
    "RESTORE_STATUS=$(ops_escape_manifest_value "$RESTORE_STATUS")" \
    "LAST_ERROR_SUMMARY=$(ops_escape_manifest_value "${LAST_ERROR_SUMMARY:-}")"
}

print_restore_plan() {
  ops_info "=== Production database restore plan ==="
  ops_info "  source backup: ${BACKUP_ARG}"
  ops_info "  production database: ${RESTORE_PG_DB}"
  ops_info "  temp database: ${TEMP_DB_NAME:-<generated at apply>}"
  ops_info "  rollback database: ${ROLLBACK_DB_NAME:-<generated at switch>}"
  ops_info "  strategy: restore to temp DB → verify → stop app → rename switch → start app → health"
  ops_info "  pre-restore backup: required before switch (name contains prerestore)"
  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_info "Mode: DRY-RUN (no lock, no database or Docker mutations)"
  else
    ops_info "Mode: APPLY (interactive confirmation required)"
  fi
}

cleanup_temp_database() {
  if [[ -z "$TEMP_DB_NAME" ]]; then
    return 0
  fi
  ops_production_restore_drop_database "$RESTORE_PG_USER" "$RESTORE_PG_PASSWORD" "$TEMP_DB_NAME" \
    >/dev/null 2>&1 || true
}

restore_to_temp_database() {
  if ! ops_production_restore_create_database "$RESTORE_PG_USER" "$RESTORE_PG_PASSWORD" "$TEMP_DB_NAME"; then
    TEMP_RESTORE_STATUS="failed_create"
    LAST_ERROR_SUMMARY="failed to create temporary database"
    persist_restore_manifest
    return 1
  fi

  if ! ops_production_restore_pg_restore_into_db \
    "$RESTORE_PG_USER" "$RESTORE_PG_PASSWORD" "$TEMP_DB_NAME" "$BACKUP_ARG"; then
    TEMP_RESTORE_STATUS="failed_pg_restore"
    LAST_ERROR_SUMMARY="pg_restore into temporary database failed"
    cleanup_temp_database
    persist_restore_manifest
    return 1
  fi

  if ! ops_production_restore_verify_temp_database "$RESTORE_PG_USER" "$RESTORE_PG_PASSWORD" "$TEMP_DB_NAME"; then
    TEMP_RESTORE_STATUS="failed_verify"
    LAST_ERROR_SUMMARY="temporary database verification failed"
    cleanup_temp_database
    persist_restore_manifest
    return 1
  fi

  TEMP_RESTORE_STATUS="success"
  persist_restore_manifest
  return 0
}

switch_production_database() {
  ops_compose stop app

  if ! ops_production_restore_rename_database \
    "$RESTORE_PG_USER" "$RESTORE_PG_PASSWORD" "$RESTORE_PG_DB" "$ROLLBACK_DB_NAME"; then
    SWITCH_STATUS="failed_rename_production"
    LAST_ERROR_SUMMARY="failed to rename production database to rollback name"
    cleanup_temp_database
    ops_compose up -d --no-deps --no-build app || true
    persist_restore_manifest
    return 1
  fi

  if ! ops_production_restore_rename_database \
    "$RESTORE_PG_USER" "$RESTORE_PG_PASSWORD" "$TEMP_DB_NAME" "$RESTORE_PG_DB"; then
    SWITCH_STATUS="failed_rename_temp"
    LAST_ERROR_SUMMARY="failed to promote temporary database; attempting to restore production name"
    if ! ops_production_restore_rename_database \
      "$RESTORE_PG_USER" "$RESTORE_PG_PASSWORD" "$ROLLBACK_DB_NAME" "$RESTORE_PG_DB"; then
        LAST_ERROR_SUMMARY="critical: failed to restore production database name after partial switch"
      fi
    cleanup_temp_database
    ops_compose up -d --no-deps --no-build app || true
    persist_restore_manifest
    return 1
  fi

  TEMP_DB_NAME=""
  SWITCH_STATUS="success"
  persist_restore_manifest
  return 0
}

rollback_database_switch() {
  local failed_restore_name="${ROLLBACK_DB_NAME/tv_restore_rb_/tv_restore_fail_}"

  ops_validate_postgres_identifier "$failed_restore_name" "failed restore database"
  ops_compose stop app

  if ops_production_restore_rename_database \
    "$RESTORE_PG_USER" "$RESTORE_PG_PASSWORD" "$RESTORE_PG_DB" "$failed_restore_name"; then
    if ops_production_restore_rename_database \
      "$RESTORE_PG_USER" "$RESTORE_PG_PASSWORD" "$ROLLBACK_DB_NAME" "$RESTORE_PG_DB"; then
      RESTORE_STATUS="rolled_back"
      SWITCH_STATUS="rolled_back"
      persist_restore_manifest
      ops_compose up -d --no-deps --no-build app
      return 0
    fi
  fi

  RESTORE_STATUS="failed_rollback"
  LAST_ERROR_SUMMARY="automatic database rollback failed; manual intervention required"
  persist_restore_manifest
  return 1
}

verify_app_health_after_restore() {
  if ! ops_container_running "$PRODUCTION_APP_CONTAINER"; then
    DOCKER_HEALTH_STATUS="not_running"
    HTTP_HEALTH_STATUS="skipped"
    LAST_ERROR_SUMMARY="app container is not running after restore"
    return 1
  fi

  if ops_wait_for_docker_health "$PRODUCTION_APP_CONTAINER"; then
    DOCKER_HEALTH_STATUS="healthy"
  else
    DOCKER_HEALTH_STATUS="unhealthy"
    HTTP_HEALTH_STATUS="skipped"
    LAST_ERROR_SUMMARY="docker health check failed after restore"
    return 1
  fi

  if ops_check_http_health_production; then
    HTTP_HEALTH_STATUS="ok"
    return 0
  fi

  HTTP_HEALTH_STATUS="failed"
  LAST_ERROR_SUMMARY="http health check failed after restore"
  return 1
}

main() {
  parse_args "$@"
  ops_setup_common_traps
  ops_cd_repo_root "$(pwd)"
  ops_assert_production_checkout

  ops_require_commands git docker flock curl
  ops_check_docker_daemon
  ops_check_docker_compose
  ops_assert_backups_gitignored
  ops_compose_preflight
  ops_validate_production_env_file
  load_restore_db_context

  COMMIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  BACKUP_ARG="$(ops_validate_backup_path "$BACKUP_ARG")"
  local backup_basename
  backup_basename="$(basename "$BACKUP_ARG")"
  if ! ops_is_production_backup_dump_basename "$backup_basename"; then
    ops_die "source backup filename does not match production dump pattern"
  fi

  if ! ops_production_restore_verify_source_dump "$BACKUP_ARG"; then
    ops_die "source backup verification failed (pg_restore -l)"
  fi
  VERIFY_STATUS="verified"

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    TEMP_DB_NAME="$(ops_production_restore_generate_temp_db_name)"
    ROLLBACK_DB_NAME="$(ops_production_restore_generate_rollback_db_name)"
    print_restore_plan
    ops_info "Dry-run complete — no database or Docker changes were made."
    exit 0
  fi

  if [[ "$RESTORE_APPLY" -ne 1 ]]; then
    ops_die "internal error: apply mode expected"
  fi

  TEMP_DB_NAME="$(ops_production_restore_generate_temp_db_name)"
  ROLLBACK_DB_NAME="$(ops_production_restore_generate_rollback_db_name)"
  print_restore_plan

  ops_acquire_production_ops_lock

  ops_require_interactive_confirmation "RESTORE PRODUCTION DATABASE" \
    "Type RESTORE PRODUCTION DATABASE to continue:"

  if ! ops_container_healthy "$PRODUCTION_POSTGRES_CONTAINER"; then
    ops_die "postgres container must be healthy before restore"
  fi

  persist_restore_manifest

  PRE_RESTORE_BACKUP="$(ops_create_production_postgres_backup "prerestore")"
  if [[ "$PRE_RESTORE_BACKUP" != *prerestore* ]]; then
    RESTORE_STATUS="failed"
    LAST_ERROR_SUMMARY="pre-restore backup path missing prerestore marker"
    persist_restore_manifest
    ops_die "pre-restore backup validation failed"
  fi
  ops_info "Pre-restore backup: ${PRE_RESTORE_BACKUP}"
  persist_restore_manifest

  if ! restore_to_temp_database; then
    RESTORE_STATUS="failed"
    persist_restore_manifest
    ops_die "restore failed before database switch (pre-restore backup: ${PRE_RESTORE_BACKUP}; manifest: ${RESTORE_MANIFEST})"
  fi

  if ! switch_production_database; then
    RESTORE_STATUS="failed"
    persist_restore_manifest
    ops_die "database switch failed (pre-restore backup: ${PRE_RESTORE_BACKUP}; manifest: ${RESTORE_MANIFEST})"
  fi

  ops_compose up -d --no-deps --no-build app

  if ! verify_app_health_after_restore; then
    RESTORE_STATUS="failed_health"
    persist_restore_manifest
    if rollback_database_switch && verify_app_health_after_restore; then
      ops_die "restore rolled back to previous database after health failure (manifest: ${RESTORE_MANIFEST})"
    fi
    ops_die "restore failed after health check (manifest: ${RESTORE_MANIFEST})"
  fi

  RESTORE_STATUS="success"
  persist_restore_manifest

  ops_info "=== Production database restore complete ==="
  ops_info "  source backup: ${BACKUP_ARG}"
  ops_info "  pre-restore backup: ${PRE_RESTORE_BACKUP}"
  ops_info "  preserved rollback database: ${ROLLBACK_DB_NAME}"
  ops_info "  manifest: ${RESTORE_MANIFEST}"
}

main "$@"
