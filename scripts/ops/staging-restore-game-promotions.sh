#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/staging-ops-common.sh
source "${SCRIPT_DIR}/lib/staging-ops-common.sh"

RESTORE_HELP=0
BACKUP_PATH=""
RESTORE_MANIFEST=""
CLI_REL="scripts/ops/lib/staging-restore-game-promotions-cli.ts"

usage() {
  cat <<'EOF'
Usage: scripts/ops/staging-restore-game-promotions.sh [--dry-run] [--help]

Idempotently restore canonical Catch-Time gifts and the homepage showcase
discount card on staging. Does NOT enable the game. Does NOT run on deploy.

Options:
  --dry-run   Validate staging env, print plan, run read-only DB checks
  --help      Show this help

Apply mode requires interactive confirmation phrase:
  RESTORE GAME PROMOTIONS

Requires: docker, flock; run as deploy from repository root with APP_ENV=staging.
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
    if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
      ops_die "--help cannot be combined with other options"
    fi
    usage
    exit 0
  fi
}

assert_staging_only() {
  local app_env
  app_env="$(ops_read_env_value APP_ENV "$STAGING_ENV_FILE" || true)"
  if [[ "$app_env" != "staging" ]]; then
    ops_die "game promotions restore is allowed only when APP_ENV=staging"
  fi
}

run_restore_cli() {
  local mode="$1"
  ops_info "Running restore CLI in migrator (${mode})..."
  ops_compose --profile ops build migrator >/dev/null
  ops_compose --profile ops run --rm --no-TTY \
    --entrypoint "$STAGING_MIGRATOR_TSX" \
    migrator "/app/${CLI_REL}" "${mode}"
}

write_restore_manifest() {
  local status="$1"
  local ts
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  RESTORE_MANIFEST="${STAGING_DEPLOY_STATE_DIR}/${ts}_game_promotions_restore.env"

  ops_ensure_private_dir "$STAGING_DEPLOY_STATE_DIR"
  ops_write_manifest_file "$RESTORE_MANIFEST" \
    "STATE_VERSION=${STAGING_STATE_VERSION}" \
    "TIMESTAMP_UTC=${ts}" \
    "OPERATION=game_promotions_restore" \
    "RESTORE_STATUS=$(ops_escape_manifest_value "$status")" \
    "BACKUP_PATH=$(ops_escape_manifest_value "${BACKUP_PATH:-}")" \
    "DRY_RUN=${OPS_DRY_RUN}" \
    "GAME_REMAINS_DISABLED=1" \
    "SHOWCASE_PROMOTION_ID=dddddddd-dddd-4ddd-8ddd-dddddddddddd" \
    "CATALOG_SLUG=procedure-gift"
}

main() {
  parse_args "$@"
  ops_setup_common_traps
  ops_cd_repo_root "$(pwd)"
  ops_require_commands docker flock
  ops_check_docker_daemon
  ops_check_docker_compose
  ops_assert_backups_gitignored
  ops_compose_preflight

  if [[ ! -f "$STAGING_ENV_FILE" ]]; then
    ops_die "${STAGING_ENV_FILE} does not exist"
  fi
  ops_check_env_file_permissions "$STAGING_ENV_FILE"
  assert_staging_only

  if [[ ! -f "$CLI_REL" ]]; then
    ops_die "missing CLI script: ${CLI_REL}"
  fi

  ops_info "=== Staging restore game promotions ==="
  ops_info "  catalog: procedure-gift"
  ops_info "  gifts: 4 canonical UUIDs"
  ops_info "  promotion: skidka-30-holodnaya-plazma (homepage showcase only)"
  ops_info "  game enable: NEVER"
  ops_info "  deploy hook: NOT wired"

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    run_restore_cli --dry-run
    ops_info "Dry-run complete — no backup, lock, or writes."
    exit 0
  fi

  ops_acquire_staging_ops_lock
  ops_require_interactive_confirmation "RESTORE GAME PROMOTIONS" \
    "Type RESTORE GAME PROMOTIONS to continue:"

  if ! ops_container_healthy "$STAGING_POSTGRES_CONTAINER"; then
    ops_die "postgres container must be healthy before restore"
  fi

  BACKUP_PATH="$(ops_create_postgres_backup "pre-game-promotions")"
  ops_info "Pre-change backup: ${BACKUP_PATH}"

  if ! run_restore_cli --apply; then
    write_restore_manifest "failed"
    ops_die "restore apply failed (backup preserved: ${BACKUP_PATH})"
  fi

  write_restore_manifest "success"
  ops_info "Game promotions restore complete."
  ops_info "  backup: ${BACKUP_PATH}"
  ops_info "  manifest: ${RESTORE_MANIFEST}"
  ops_info "  game remains disabled — enable manually in admin when ready"
}

main "$@"
