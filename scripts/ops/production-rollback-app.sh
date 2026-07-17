#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/production-ops-common.sh
source "${SCRIPT_DIR}/lib/production-ops-common.sh"

ROLLBACK_HELP=0
MANIFEST_ARG="latest"
ROLLBACK_MANIFEST=""
ROLLBACK_RESULT_MANIFEST=""
DOCKER_HEALTH_STATUS="pending"
HTTP_HEALTH_STATUS="pending"

usage() {
  cat <<'EOF'
Usage: scripts/ops/production-rollback-app.sh [--manifest PATH|latest] [--dry-run] [--help]

Roll back only the production app container to a previous image from deploy state.

Does not change Git, database schema, or migrations.

Options:
  --manifest PATH  Deploy state manifest (default: latest symlink)
  --dry-run        Show plan without changing Docker state
  --help           Show this help

Interactive confirmation: type ROLLBACK PRODUCTION APP to continue.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --manifest)
        shift
        [[ $# -gt 0 ]] || ops_die "--manifest requires a value"
        MANIFEST_ARG="$1"
        ;;
      --dry-run)
        if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
          ops_die "duplicate --dry-run"
        fi
        OPS_DRY_RUN=1
        ;;
      --help|-h)
        if [[ "$ROLLBACK_HELP" -eq 1 ]]; then
          ops_die "duplicate --help"
        fi
        ROLLBACK_HELP=1
        ;;
      *)
        ops_die "unknown argument: $1"
        ;;
    esac
    shift
  done

  if [[ "$ROLLBACK_HELP" -eq 1 ]]; then
    if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
      ops_die "--help cannot be combined with other options"
    fi
    usage
    exit 0
  fi
}

load_manifest() {
  ROLLBACK_MANIFEST="$(ops_resolve_manifest_path "$MANIFEST_ARG")"
}

print_rollback_plan() {
  local previous target rollback_tag previous_image current_image migration_status
  local is_initial rollback_available

  previous="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" PREVIOUS_COMMIT_SHA || true)"
  target="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" TARGET_COMMIT_SHA || true)"
  rollback_tag="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" ROLLBACK_IMAGE_TAG || true)"
  previous_image="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" PREVIOUS_APP_IMAGE_ID || true)"
  migration_status="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" MIGRATION_STATUS || true)"
  is_initial="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" IS_INITIAL_DEPLOY || true)"
  rollback_available="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" APP_IMAGE_ROLLBACK_AVAILABLE || true)"
  current_image="$(ops_get_container_image_id "$PRODUCTION_APP_CONTAINER" | ops_normalize_image_id || true)"

  ops_info "=== Production app rollback plan ==="
  ops_info "Manifest: ${ROLLBACK_MANIFEST}"
  ops_info "Previous commit: ${previous:-unknown}"
  ops_info "Target commit: ${target:-unknown}"
  ops_info "Migration status (from deploy): ${migration_status:-unknown}"
  ops_info "Initial deploy (manifest): ${is_initial:-unknown}"
  ops_info "App image rollback available: ${rollback_available:-unknown}"
  ops_info "Rollback image tag: ${rollback_tag:-missing}"
  ops_info "Expected previous image: ${previous_image:-missing}"
  ops_info "Current app image: ${current_image:-unknown}"
  ops_info "PostgreSQL and database schema will NOT be restored."
  if [[ "$migration_status" == "applied" ]]; then
    ops_info "Warning: migrations were applied in this deploy; app rollback may be incompatible with DB schema."
  fi
  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_info "Mode: DRY-RUN"
  fi
}

assert_previous_app_rollback_available() {
  local rollback_tag previous_image is_initial rollback_available

  rollback_tag="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" ROLLBACK_IMAGE_TAG || true)"
  previous_image="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" PREVIOUS_APP_IMAGE_ID || true)"
  is_initial="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" IS_INITIAL_DEPLOY || true)"
  rollback_available="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" APP_IMAGE_ROLLBACK_AVAILABLE || true)"

  if [[ "$is_initial" == "true" || "$rollback_available" == "false" || -z "$rollback_tag" || -z "$previous_image" ]]; then
    ops_die "previous app rollback image is unavailable (initial deploy or incomplete deploy manifest); cannot roll back app image"
  fi
}

write_rollback_manifest() {
  local ts manifest status="$1"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  manifest="${PRODUCTION_DEPLOY_STATE_DIR}/${ts}_rollback.env"

  ops_write_manifest_file "$manifest" \
    "STATE_VERSION=${PRODUCTION_STATE_VERSION}" \
    "TIMESTAMP_UTC=${ts}" \
    "ENVIRONMENT=production" \
    "ROLLBACK_MANIFEST_SOURCE=$(ops_escape_manifest_value "$ROLLBACK_MANIFEST")" \
    "ROLLBACK_IMAGE_TAG=$(ops_escape_manifest_value "$(ops_read_manifest_value "$ROLLBACK_MANIFEST" ROLLBACK_IMAGE_TAG || true)")" \
    "PREVIOUS_COMMIT_SHA=$(ops_escape_manifest_value "$(ops_read_manifest_value "$ROLLBACK_MANIFEST" PREVIOUS_COMMIT_SHA || true)")" \
    "TARGET_COMMIT_SHA=$(ops_escape_manifest_value "$(ops_read_manifest_value "$ROLLBACK_MANIFEST" TARGET_COMMIT_SHA || true)")" \
    "PREVIOUS_APP_IMAGE_ID=$(ops_escape_manifest_value "$(ops_read_manifest_value "$ROLLBACK_MANIFEST" PREVIOUS_APP_IMAGE_ID || true)")" \
    "MIGRATION_STATUS_AT_ROLLBACK=$(ops_escape_manifest_value "$(ops_read_manifest_value "$ROLLBACK_MANIFEST" MIGRATION_STATUS || true)")" \
    "APP_ROLLBACK_STATUS=$(ops_escape_manifest_value "$status")" \
    "DOCKER_HEALTH_STATUS=$(ops_escape_manifest_value "${DOCKER_HEALTH_STATUS:-pending}")" \
    "HTTP_HEALTH_STATUS=$(ops_escape_manifest_value "${HTTP_HEALTH_STATUS:-pending}")"

  ROLLBACK_RESULT_MANIFEST="$manifest"
}

perform_rollback() {
  local rollback_tag expected_image_id

  assert_previous_app_rollback_available

  rollback_tag="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" ROLLBACK_IMAGE_TAG || true)"
  expected_image_id="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" PREVIOUS_APP_IMAGE_ID || true)"

  if ! docker image inspect "$rollback_tag" >/dev/null 2>&1; then
    ops_die "rollback image not found: ${rollback_tag}"
  fi

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    return 0
  fi

  ops_apply_compose_app_image "$rollback_tag"
  ops_recreate_app_container

  if ! ops_assert_container_image_matches "$PRODUCTION_APP_CONTAINER" "$expected_image_id"; then
    ops_die "rollback failed: container image id does not match expected previous image"
  fi
}

main() {
  parse_args "$@"
  ops_setup_common_traps
  ops_cd_repo_root "$(pwd)"
  ops_assert_production_checkout

  ops_require_commands docker curl flock
  ops_check_docker_daemon
  ops_check_docker_compose
  ops_compose_preflight

  if [[ "$OPS_DRY_RUN" -eq 0 ]]; then
    ops_acquire_production_ops_lock
  fi

  load_manifest
  ops_assess_rollback_migration_risk "$ROLLBACK_MANIFEST"
  print_rollback_plan
  assert_previous_app_rollback_available

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_info "Dry-run complete — no Docker changes were made."
    exit 0
  fi

  ops_require_interactive_confirmation "ROLLBACK PRODUCTION APP" "Type ROLLBACK PRODUCTION APP to restore the previous app image:"

  perform_rollback

  if ops_wait_for_docker_health "$PRODUCTION_APP_CONTAINER"; then
    DOCKER_HEALTH_STATUS="healthy"
  else
    DOCKER_HEALTH_STATUS="unhealthy"
    write_rollback_manifest "failed_health"
    ops_die "docker health check failed after rollback (manifest: ${ROLLBACK_RESULT_MANIFEST})"
  fi

  if ops_check_http_health_production; then
    HTTP_HEALTH_STATUS="ok"
  else
    HTTP_HEALTH_STATUS="failed"
    write_rollback_manifest "failed_http"
    ops_die "HTTP health check failed after rollback (manifest: ${ROLLBACK_RESULT_MANIFEST})"
  fi

  write_rollback_manifest "success"
  ops_info "Production app rollback complete (database unchanged). Manifest: ${ROLLBACK_RESULT_MANIFEST}"
}

main "$@"
