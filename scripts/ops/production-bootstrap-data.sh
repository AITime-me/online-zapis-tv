#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/production-ops-common.sh
source "${SCRIPT_DIR}/lib/production-ops-common.sh"

BOOTSTRAP_HELP=0
BOOTSTRAP_APPLY=0
BACKUP_PATH=""
BOOTSTRAP_MANIFEST=""
CLI_REL="scripts/ops/lib/production-bootstrap-data-cli.ts"
COMMIT_SHA=""
BOOTSTRAP_STATUS="pending"

usage() {
  cat <<'EOF'
Usage: scripts/ops/production-bootstrap-data.sh [--dry-run | --apply] [--help]

Bootstrap canonical production working data (masters, catalog, gifts, showcase
discount card) on a clean production database. Never called by deploy/backup/timer.

Prerequisites (separate stages):
  1. database migrations (separate stage)
  2. production foundation seed (separate npm script)
  3. this bootstrap
  4. create first OWNER via the dedicated owner CLI (not this script)

Options:
  --dry-run   Plan + pre-check only (no lock, backup, or writes)
  --apply     Apply bootstrap (requires interactive confirmation)
  --help      Show this help

Confirmation phrase (case-sensitive): BOOTSTRAP PRODUCTION DATA

Requires: git, docker, flock; run from /opt/online-zapis-tv-production.
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
      --apply)
        if [[ "$BOOTSTRAP_APPLY" -eq 1 ]]; then
          ops_die "duplicate --apply"
        fi
        BOOTSTRAP_APPLY=1
        ;;
      --help|-h)
        if [[ "$BOOTSTRAP_HELP" -eq 1 ]]; then
          ops_die "duplicate --help"
        fi
        BOOTSTRAP_HELP=1
        ;;
      *)
        ops_die "unknown argument: $1"
        ;;
    esac
    shift
  done

  if [[ "$BOOTSTRAP_HELP" -eq 1 ]]; then
    if [[ "$OPS_DRY_RUN" -eq 1 || "$BOOTSTRAP_APPLY" -eq 1 ]]; then
      ops_die "--help cannot be combined with other options"
    fi
    usage
    exit 0
  fi

  if [[ "$BOOTSTRAP_APPLY" -eq 1 && "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_die "--apply cannot be combined with --dry-run"
  fi

  if [[ "$BOOTSTRAP_APPLY" -eq 0 && "$OPS_DRY_RUN" -eq 0 ]]; then
    ops_die "specify --dry-run to validate safely or --apply to bootstrap"
  fi
}

persist_bootstrap_manifest() {
  local status="$1"
  local ts="${2:-$(date -u +%Y%m%dT%H%M%SZ)}"

  if [[ -z "$BOOTSTRAP_MANIFEST" ]]; then
    BOOTSTRAP_MANIFEST="${PRODUCTION_DEPLOY_STATE_DIR}/${ts}_bootstrap.env"
  fi

  ops_ensure_private_dir "$PRODUCTION_DEPLOY_STATE_DIR"
  ops_write_manifest_file "$BOOTSTRAP_MANIFEST" \
    "STATE_VERSION=${PRODUCTION_STATE_VERSION}" \
    "TIMESTAMP_UTC=${ts}" \
    "ENVIRONMENT=production" \
    "OPERATION=bootstrap_data" \
    "COMMIT_SHA=$(ops_escape_manifest_value "${COMMIT_SHA:-unknown}")" \
    "BACKUP_PATH=$(ops_escape_manifest_value "${BACKUP_PATH:-}")" \
    "BOOTSTRAP_STATUS=$(ops_escape_manifest_value "$status")" \
    "DRY_RUN=${OPS_DRY_RUN}" \
    "GAME_REMAINS_DISABLED=1" \
    "SHOWCASE_PROMOTION_ID=dddddddd-dddd-4ddd-8ddd-dddddddddddd" \
    "CATALOG_SLUG=procedure-gift" \
    "CANONICAL_MASTERS=5" \
    "CANONICAL_CATEGORIES=11" \
    "CANONICAL_SERVICES=101" \
    "CANONICAL_GIFTS=4"
}

run_bootstrap_cli() {
  local mode="$1"
  ops_info "Running bootstrap CLI in migrator (${mode})..."
  ops_compose --profile ops build migrator >/dev/null
  ops_compose --profile ops run --rm --no-TTY \
    --entrypoint "$PRODUCTION_MIGRATOR_TSX" \
    migrator "/app/${CLI_REL}" "${mode}"
}

main() {
  parse_args "$@"
  ops_setup_common_traps
  ops_cd_repo_root "$(pwd)"
  ops_assert_production_checkout

  ops_require_commands git docker flock
  ops_check_docker_daemon
  ops_check_docker_compose
  ops_assert_backups_gitignored
  ops_compose_preflight
  ops_validate_production_env_file

  if [[ ! -f "$CLI_REL" ]]; then
    ops_die "missing CLI script: ${CLI_REL}"
  fi

  COMMIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

  ops_info "=== Production bootstrap data ==="
  ops_info "  source catalog: scripts/data/import-services-data.ts"
  ops_info "  gifts/promo: scripts/ops/lib/game-promotions-canonical.ts"
  ops_info "  game enable: NEVER"
  ops_info "  deploy hook: NOT wired"

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    run_bootstrap_cli --dry-run
    ops_info "Dry-run complete — no lock, backup, or database writes."
    exit 0
  fi

  if [[ "$BOOTSTRAP_APPLY" -ne 1 ]]; then
    ops_die "internal error: apply mode expected"
  fi

  ops_acquire_production_ops_lock

  ops_require_interactive_confirmation "BOOTSTRAP PRODUCTION DATA" \
    "Type BOOTSTRAP PRODUCTION DATA to continue:"

  if ! ops_container_healthy "$PRODUCTION_POSTGRES_CONTAINER"; then
    ops_die "postgres container must be healthy before bootstrap"
  fi

  persist_bootstrap_manifest "pending"

  BACKUP_PATH="$(ops_create_production_postgres_backup "prebootstrap")"
  if [[ "$BACKUP_PATH" != *prebootstrap* ]]; then
    BOOTSTRAP_STATUS="failed"
    persist_bootstrap_manifest "failed"
    ops_die "pre-bootstrap backup validation failed"
  fi
  ops_info "Pre-bootstrap backup: ${BACKUP_PATH}"
  persist_bootstrap_manifest "pending"

  if ! run_bootstrap_cli --apply; then
    BOOTSTRAP_STATUS="failed"
    persist_bootstrap_manifest "failed"
    ops_die "bootstrap apply failed (backup preserved: ${BACKUP_PATH}; manifest: ${BOOTSTRAP_MANIFEST})"
  fi

  BOOTSTRAP_STATUS="success"
  persist_bootstrap_manifest "success"
  ops_info "=== Production bootstrap data complete ==="
  ops_info "  backup: ${BACKUP_PATH}"
  ops_info "  manifest: ${BOOTSTRAP_MANIFEST}"
}

main "$@"
