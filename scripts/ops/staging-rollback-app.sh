#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/staging-ops-common.sh
source "${SCRIPT_DIR}/lib/staging-ops-common.sh"

ROLLBACK_HELP=0
MANIFEST_ARG="latest"
ROLLBACK_MANIFEST=""
ROLLBACK_RESULT_MANIFEST=""
ROLLBACK_TARGET_IMAGE_ID=""
ROLLBACK_TARGET_COMMIT=""
ROLLBACK_TARGET_FULL_BUSY_COMPAT="unknown"

usage() {
  cat <<'EOF'
Usage: scripts/ops/staging-rollback-app.sh [--manifest PATH|latest] [--dry-run] [--help]

Roll back only the staging app container to a previous image from deploy state.

Does not change Git, database schema, or migrations.

Options:
  --manifest PATH  Deploy state manifest (default: latest symlink)
  --dry-run        Show plan without changing Docker state
  --help           Show this help
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
  local previous target rollback_tag previous_image current_image

  previous="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" PREVIOUS_COMMIT_SHA || true)"
  target="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" TARGET_COMMIT_SHA || true)"
  rollback_tag="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" ROLLBACK_IMAGE_TAG || true)"
  previous_image="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" PREVIOUS_APP_IMAGE_ID || true)"
  current_image="$(ops_get_container_image_id "$STAGING_APP_CONTAINER" | ops_normalize_image_id)"

  ops_info "=== Staging app rollback plan ==="
  ops_info "Manifest: ${ROLLBACK_MANIFEST}"
  ops_info "Previous commit: ${previous:-unknown}"
  ops_info "Target commit: ${target:-unknown}"
  ops_info "Rollback image tag: ${rollback_tag:-missing}"
  ops_info "Expected previous image: ${previous_image:-unknown}"
  ops_info "Rollback target commit: ${ROLLBACK_TARGET_COMMIT:-unknown}"
  ops_info "Rollback target full-busy compatibility: ${ROLLBACK_TARGET_FULL_BUSY_COMPAT}"
  ops_info "Current app image: ${current_image:-unknown}"
  ops_info "Database will NOT be restored."
  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_info "Mode: DRY-RUN"
  fi
}

write_rollback_manifest() {
  local ts manifest status="$1"

  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  manifest="${STAGING_DEPLOY_STATE_DIR}/${ts}_rollback.env"

  ops_write_manifest_file "$manifest" \
    "STATE_VERSION=${STAGING_STATE_VERSION}" \
    "TIMESTAMP_UTC=${ts}" \
    "ROLLBACK_MANIFEST_SOURCE=$(ops_escape_manifest_value "$ROLLBACK_MANIFEST")" \
    "ROLLBACK_IMAGE_TAG=$(ops_escape_manifest_value "$(ops_read_manifest_value "$ROLLBACK_MANIFEST" ROLLBACK_IMAGE_TAG || true)")" \
    "PREVIOUS_COMMIT_SHA=$(ops_escape_manifest_value "$(ops_read_manifest_value "$ROLLBACK_MANIFEST" PREVIOUS_COMMIT_SHA || true)")" \
    "TARGET_COMMIT_SHA=$(ops_escape_manifest_value "$(ops_read_manifest_value "$ROLLBACK_MANIFEST" TARGET_COMMIT_SHA || true)")" \
    "PREVIOUS_APP_IMAGE_ID=$(ops_escape_manifest_value "$(ops_read_manifest_value "$ROLLBACK_MANIFEST" PREVIOUS_APP_IMAGE_ID || true)")" \
    "ROLLBACK_TARGET_APP_COMMIT=$(ops_escape_manifest_value "$ROLLBACK_TARGET_COMMIT")" \
    "ROLLBACK_TARGET_APP_FULL_BUSY_COMPAT=$(ops_escape_manifest_value "$ROLLBACK_TARGET_FULL_BUSY_COMPAT")" \
    "APP_ROLLBACK_STATUS=$(ops_escape_manifest_value "$status")" \
    "DOCKER_HEALTH_STATUS=$(ops_escape_manifest_value "${DOCKER_HEALTH_STATUS:-pending}")" \
    "HTTP_HEALTH_STATUS=$(ops_escape_manifest_value "${HTTP_HEALTH_STATUS:-pending}")"

  ROLLBACK_RESULT_MANIFEST="$manifest"
}

main() {
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

  load_manifest
  ops_resolve_full_busy_rollback_target "$ROLLBACK_MANIFEST"
  print_rollback_plan

  # timing pre-rollback audit → eligibility (before confirm / dry-run success)
  ops_assert_pre_compat_timing_rollback_allowed \
    "$STAGING_ENV_FILE" \
    "$STAGING_COMPOSE_FILE" \
    "$ROLLBACK_TARGET_FULL_BUSY_COMPAT"

  if [[ "$OPS_DRY_RUN" -eq 0 ]]; then
    ops_require_interactive_confirmation "ROLLBACK" "Type ROLLBACK to restore the previous app image:"
  else
    ops_info "Dry-run complete — no Docker changes were made."
    exit 0
  fi

  perform_rollback

  if ops_wait_for_docker_health "$STAGING_APP_CONTAINER"; then
    DOCKER_HEALTH_STATUS="healthy"
  else
    DOCKER_HEALTH_STATUS="unhealthy"
    write_rollback_manifest "failed_health"
    ops_die "docker health check failed after rollback (manifest: ${ROLLBACK_RESULT_MANIFEST})"
  fi

  if ops_check_http_health; then
    HTTP_HEALTH_STATUS="ok"
  else
    HTTP_HEALTH_STATUS="failed"
    write_rollback_manifest "failed_http"
    ops_die "HTTP health check failed after rollback (manifest: ${ROLLBACK_RESULT_MANIFEST})"
  fi

  write_rollback_manifest "success"
  ops_info "App rollback complete (DB unchanged). Manifest: ${ROLLBACK_RESULT_MANIFEST}"
}

perform_rollback() {
  local rollback_tag expected_image_id

  # Defense in depth: eligibility guard also inside apply path.
  ops_assert_pre_compat_timing_rollback_allowed \
    "$STAGING_ENV_FILE" \
    "$STAGING_COMPOSE_FILE" \
    "${ROLLBACK_TARGET_FULL_BUSY_COMPAT:-unknown}"

  rollback_tag="$(ops_read_manifest_value "$ROLLBACK_MANIFEST" ROLLBACK_IMAGE_TAG || true)"
  expected_image_id="${ROLLBACK_TARGET_IMAGE_ID:-}"

  if [[ -z "$rollback_tag" ]]; then
    ops_die "ROLLBACK_IMAGE_TAG missing in manifest"
  fi
  if [[ -z "$expected_image_id" ]]; then
    ops_die "PREVIOUS_APP_IMAGE_ID missing in manifest"
  fi
  if ! docker image inspect "$rollback_tag" >/dev/null 2>&1; then
    ops_die "rollback image not found: ${rollback_tag}"
  fi

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    return 0
  fi

  ops_apply_compose_app_image "$rollback_tag"
  ops_recreate_app_container

  if ! ops_assert_container_image_matches "$STAGING_APP_CONTAINER" "$expected_image_id"; then
    ops_die "rollback failed: container image id does not match expected previous image"
  fi
}

main "$@"
