#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/production-ops-common.sh
source "${SCRIPT_DIR}/lib/production-ops-common.sh"

BACKUP_HELP=0
RETENTION_DAYS="$PRODUCTION_BACKUP_RETENTION_DAYS"
BACKUP_PATH=""
BACKUP_MANIFEST=""
PURGED_COUNT=0

usage() {
  cat <<'EOF'
Usage: scripts/ops/production-backup.sh [--dry-run] [--retention-days N] [--help]

Create a PostgreSQL backup for production (custom-format pg_dump).
Does not stop the app. Scheduled runs use systemd timer on the server.

Options:
  --dry-run            Validate environment and print plan only (no lock, backup, or deletion)
  --retention-days N   Keep production backups for N days (default: 30)
  --help               Show this help

Backup files: backups/production/postgres/YYYYMMDDTHHMMSSZ_<short-sha>.dump
Retention removes only verified *.dump files older than N days inside that directory.

Requires: git, docker, flock; run as deploy user from /opt/online-zapis-tv-production.
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
  ops_require_commands git docker flock
  ops_check_docker_daemon
  ops_check_docker_compose
  ops_assert_backups_gitignored
  ops_compose_preflight
  ops_validate_production_env_file
}

print_plan() {
  local short_sha
  short_sha="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

  ops_info "=== Production database backup plan ==="
  ops_info "  repository: ${OPS_REPO_ROOT}"
  ops_info "  target directory: ${PRODUCTION_BACKUPS_POSTGRES_DIR}/"
  ops_info "  filename pattern: YYYYMMDDTHHMMSSZ_${short_sha}.dump"
  ops_info "  retention days: ${RETENTION_DAYS} (verified *.dump in production directory only)"
  ops_info "  postgres container: ${PRODUCTION_POSTGRES_CONTAINER} (not stopped)"
  ops_info "  lock file: ${PRODUCTION_LOCK_FILE} (skipped in dry-run)"
  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_info "Dry-run — no backup file, lock, or retention changes will be made."
  fi
}

main() {
  parse_args "$@"
  ops_setup_common_traps
  ops_cd_repo_root "$(pwd)"
  ops_assert_production_checkout
  check_prerequisites
  print_plan

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    BACKUP_PATH="${PRODUCTION_BACKUPS_POSTGRES_DIR}/$(date -u +%Y%m%dT%H%M%SZ)_$(git rev-parse --short HEAD).dump"
    ops_info "  would create: ${BACKUP_PATH}"
    PURGED_COUNT="$(ops_purge_expired_production_backups "$RETENTION_DAYS")"
    ops_info "  would purge backups older than ${RETENTION_DAYS} days: ${PURGED_COUNT}"
    ops_info "Dry-run complete — no changes were made."
    exit 0
  fi

  ops_acquire_production_ops_lock

  BACKUP_PATH="$(ops_create_production_postgres_backup "$(git rev-parse --short HEAD)")"
  ops_info "Backup created: ${BACKUP_PATH}"

  PURGED_COUNT="$(ops_purge_expired_production_backups "$RETENTION_DAYS")"
  if (( PURGED_COUNT > 0 )); then
    ops_info "Retention: removed ${PURGED_COUNT} expired backup(s)"
  fi

  BACKUP_MANIFEST="$(ops_write_production_backup_manifest "$BACKUP_PATH" "$RETENTION_DAYS" "$PURGED_COUNT" "success")"
  ops_info "Manifest: ${BACKUP_MANIFEST}"
  ops_info "Production backup complete."
}

main "$@"
