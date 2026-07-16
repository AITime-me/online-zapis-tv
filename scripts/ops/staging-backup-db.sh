#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/staging-ops-common.sh
source "${SCRIPT_DIR}/lib/staging-ops-common.sh"

BACKUP_HELP=0
RETENTION_DAYS="$STAGING_SCHEDULED_BACKUP_DEFAULT_RETENTION_DAYS"
BACKUP_PATH=""
BACKUP_MANIFEST=""
PURGED_COUNT=0

usage() {
  cat <<'EOF'
Usage: scripts/ops/staging-backup-db.sh [--dry-run] [--retention-days N] [--help]

Create a scheduled PostgreSQL backup for staging (custom-format pg_dump).
Does not stop the app. Does not run automatically — use systemd timer on the server.

Options:
  --dry-run            Validate environment and print plan only
  --retention-days N   Keep scheduled backups for N days (default: 14)
  --help               Show this help

Scheduled backup files: backups/postgres/YYYYMMDDTHHMMSSZ_scheduled.dump
Only files matching that pattern are subject to retention cleanup.
Deploy, pre-restore, and manual backups are never deleted by this script.

Requires: docker, flock; run as deploy user from repository root.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
          ops_die "duplicate --dry-run"
        fi
        OPS_DRY_RUN=1
        ;;
      --retention-days)
        shift
        [[ $# -gt 0 ]] || ops_die "--retention-days requires a value"
        if [[ -n "${RETENTION_DAYS_SET:-}" ]]; then
          ops_die "duplicate --retention-days"
        fi
        RETENTION_DAYS="$1"
        RETENTION_DAYS_SET=1
        ;;
      --help|-h)
        if [[ "$BACKUP_HELP" -eq 1 ]]; then
          ops_die "duplicate --help"
        fi
        BACKUP_HELP=1
        ;;
      *)
        ops_die "unknown argument: $1"
        ;;
    esac
    shift
  done

  if [[ "$BACKUP_HELP" -eq 1 ]]; then
    if [[ "$OPS_DRY_RUN" -eq 1 || -n "${RETENTION_DAYS_SET:-}" ]]; then
      ops_die "--help cannot be combined with other options"
    fi
    usage
    exit 0
  fi

  ops_validate_retention_days "$RETENTION_DAYS"
}

check_prerequisites() {
  ops_require_commands docker flock
  ops_check_docker_daemon
  ops_check_docker_compose
  ops_assert_backups_gitignored
  ops_compose_preflight

  if [[ ! -f "$STAGING_ENV_FILE" ]]; then
    ops_die "${STAGING_ENV_FILE} does not exist"
  fi
  ops_check_env_file_permissions "$STAGING_ENV_FILE"
  ops_assert_staging_app_env
}

print_plan() {
  ops_info "=== Staging scheduled database backup plan ==="
  ops_info "  target directory: ${STAGING_BACKUPS_POSTGRES_DIR}/"
  ops_info "  filename pattern: YYYYMMDDTHHMMSSZ_scheduled.dump"
  ops_info "  retention days: ${RETENTION_DAYS} (scheduled files only)"
  ops_info "  app container: not stopped"
  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_info "Dry-run — no backup file, lock, or retention changes will be made."
  fi
}

main() {
  parse_args "$@"
  ops_setup_common_traps
  ops_cd_repo_root "$(pwd)"
  check_prerequisites
  print_plan

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    BACKUP_PATH="${STAGING_BACKUPS_POSTGRES_DIR}/$(date -u +%Y%m%dT%H%M%SZ)_scheduled.dump"
    ops_info "  would create: ${BACKUP_PATH}"
    PURGED_COUNT="$(ops_purge_expired_scheduled_backups "$RETENTION_DAYS")"
    ops_info "  would purge scheduled backups older than ${RETENTION_DAYS} days: ${PURGED_COUNT}"
    ops_info "Dry-run complete — no changes were made."
    exit 0
  fi

  ops_acquire_staging_ops_lock

  BACKUP_PATH="$(ops_create_scheduled_postgres_backup)"
  ops_info "Backup created: ${BACKUP_PATH}"

  PURGED_COUNT="$(ops_purge_expired_scheduled_backups "$RETENTION_DAYS")"
  if (( PURGED_COUNT > 0 )); then
    ops_info "Retention: removed ${PURGED_COUNT} expired scheduled backup(s)"
  fi

  BACKUP_MANIFEST="$(ops_write_scheduled_backup_manifest "$BACKUP_PATH" "$RETENTION_DAYS" "$PURGED_COUNT" "success")"
  ops_info "Manifest: ${BACKUP_MANIFEST}"
  ops_info "Scheduled backup complete."
}

main "$@"
