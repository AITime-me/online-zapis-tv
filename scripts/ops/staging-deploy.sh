#!/usr/bin/env bash

set -Eeuo pipefail



SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/staging-ops-common.sh

source "${SCRIPT_DIR}/lib/staging-ops-common.sh"



DEPLOY_YES=0

DEPLOY_HELP=0



MANIFEST_PATH=""

PREVIOUS_COMMIT_SHA=""

TARGET_COMMIT_SHA=""

BACKUP_PATH=""

PREVIOUS_APP_IMAGE_ID=""

ROLLBACK_IMAGE_TAG=""

NEW_APP_IMAGE_ID=""

MIGRATION_STATUS="pending"

DEPLOY_STATUS="pending"

APP_ROLLBACK_STATUS="not_needed"

DOCKER_HEALTH_STATUS="pending"

HTTP_HEALTH_STATUS="pending"

LAST_ERROR_SUMMARY=""



usage() {

  cat <<'EOF'

Usage: scripts/ops/staging-deploy.sh [--dry-run] [--yes] [--help]



Safely deploy staging from origin/main with backup, migrations, and health checks.



Options:

  --dry-run   Run safe preflight checks and print the plan only

  --yes       Skip interactive DEPLOY confirmation (for future CI)

  --help      Show this help



Requires: git, docker, flock, curl; run as deploy user from repository root.

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

      --yes)

        if [[ "$DEPLOY_YES" -eq 1 ]]; then

          ops_die "duplicate --yes"

        fi

        DEPLOY_YES=1

        ;;

      --help|-h)

        if [[ "$DEPLOY_HELP" -eq 1 ]]; then

          ops_die "duplicate --help"

        fi

        DEPLOY_HELP=1

        ;;

      *)

        ops_die "unknown argument: $1"

        ;;

    esac

    shift

  done



  if [[ "$DEPLOY_HELP" -eq 1 ]]; then

    if [[ "$OPS_DRY_RUN" -eq 1 || "$DEPLOY_YES" -eq 1 ]]; then

      ops_die "--help cannot be combined with other options"

    fi

    usage

    exit 0

  fi

}



check_prerequisites() {

  ops_require_commands git docker flock curl

  ops_check_docker_daemon

  ops_check_docker_compose

  ops_assert_backups_gitignored

  ops_compose_preflight

}



check_git_clean() {

  if [[ -n "$(git status --porcelain)" ]]; then

    ops_die "git working tree is not clean (staged, unstaged, or untracked changes present)"

  fi

}



check_git_branch() {

  local branch

  if ! branch="$(git symbolic-ref -q --short HEAD 2>/dev/null)"; then

    ops_die "detached HEAD is not allowed for staging deploy"

  fi

  if [[ "$branch" != "main" ]]; then

    ops_die "staging deploy is allowed only from main branch (current: ${branch})"

  fi

}



fetch_and_plan_git() {

  local current_sha target_sha merge_base local_ahead



  if [[ "$OPS_DRY_RUN" -eq 0 ]]; then

    git fetch origin main

  else

    git fetch --dry-run origin main >/dev/null 2>&1 || git fetch origin main

  fi



  if ! git rev-parse --verify origin/main >/dev/null 2>&1; then

    ops_die "origin/main does not exist"

  fi



  current_sha="$(git rev-parse HEAD)"

  target_sha="$(git rev-parse origin/main)"

  merge_base="$(git merge-base HEAD origin/main)"

  local_ahead="$(git rev-list --count origin/main..HEAD)"



  PREVIOUS_COMMIT_SHA="$current_sha"

  TARGET_COMMIT_SHA="$target_sha"



  if (( local_ahead > 0 )); then

    ops_die "local main contains commits not present on origin/main"

  fi



  if [[ "$merge_base" != "$current_sha" ]]; then

    ops_die "local main has diverged from origin/main"

  fi



  ops_info "Git plan:"

  ops_info "  current: $(git rev-parse --short "$current_sha")"

  ops_info "  target:  $(git rev-parse --short "$target_sha")"



  if [[ "$current_sha" == "$target_sha" ]]; then

    ops_info "  commits to deploy: none (already at origin/main)"

    ops_die "no new commits to deploy; refusing no-op deploy"

  fi



  ops_info "  commits to fast-forward:"

  git log --oneline "${current_sha}..${target_sha}" | sed 's/^/    /'

}



fast_forward_git() {

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then

    return 0

  fi



  git merge --ff-only origin/main

  local head_sha

  head_sha="$(git rev-parse HEAD)"

  if [[ "$head_sha" != "$TARGET_COMMIT_SHA" ]]; then

    ops_die "fast-forward failed: HEAD does not match target SHA"

  fi

}



prepare_rollback_tag() {

  local ts short_sha



  if ! ops_container_exists "$STAGING_APP_CONTAINER"; then

    ops_die "app container does not exist"

  fi



  PREVIOUS_APP_IMAGE_ID="$(ops_get_container_image_id "$STAGING_APP_CONTAINER" | ops_normalize_image_id)"

  if [[ -z "$PREVIOUS_APP_IMAGE_ID" ]]; then

    ops_die "cannot determine current app image id"

  fi



  ts="$(date -u +%Y%m%dT%H%M%SZ)"

  short_sha="$(git rev-parse --short "$PREVIOUS_COMMIT_SHA")"

  ROLLBACK_IMAGE_TAG="online-zapis-tv-staging-rollback:${ts}_${short_sha}"



  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then

    return 0

  fi



  docker tag "$PREVIOUS_APP_IMAGE_ID" "$ROLLBACK_IMAGE_TAG"

  local tagged_id

  tagged_id="$(ops_get_image_id_from_ref "$ROLLBACK_IMAGE_TAG")"

  if [[ "$tagged_id" != "$PREVIOUS_APP_IMAGE_ID" ]]; then

    ops_die "rollback tag does not reference previous app image"

  fi

}



persist_state_manifest() {

  local ts short_target



  if [[ -z "$MANIFEST_PATH" ]]; then

    ts="$(date -u +%Y%m%dT%H%M%SZ)"

    short_target="$(git rev-parse --short "$TARGET_COMMIT_SHA")"

    MANIFEST_PATH="${STAGING_DEPLOY_STATE_DIR}/${ts}_${short_target}.env"

  fi



  ops_ensure_private_dir "$STAGING_DEPLOY_STATE_DIR"



  ops_write_manifest_file "$MANIFEST_PATH" \

    "STATE_VERSION=${STAGING_STATE_VERSION}" \

    "TIMESTAMP_UTC=$(date -u +%Y%m%dT%H%M%SZ)" \

    "PREVIOUS_COMMIT_SHA=$(ops_escape_manifest_value "$PREVIOUS_COMMIT_SHA")" \

    "TARGET_COMMIT_SHA=$(ops_escape_manifest_value "$TARGET_COMMIT_SHA")" \

    "BACKUP_PATH=$(ops_escape_manifest_value "$BACKUP_PATH")" \

    "PREVIOUS_APP_IMAGE_ID=$(ops_escape_manifest_value "$PREVIOUS_APP_IMAGE_ID")" \

    "ROLLBACK_IMAGE_TAG=$(ops_escape_manifest_value "$ROLLBACK_IMAGE_TAG")" \

    "NEW_APP_IMAGE_ID=$(ops_escape_manifest_value "${NEW_APP_IMAGE_ID:-}")" \

    "MIGRATION_STATUS=$(ops_escape_manifest_value "$MIGRATION_STATUS")" \

    "DEPLOY_STATUS=$(ops_escape_manifest_value "$DEPLOY_STATUS")" \

    "APP_ROLLBACK_STATUS=$(ops_escape_manifest_value "$APP_ROLLBACK_STATUS")" \

    "DOCKER_HEALTH_STATUS=$(ops_escape_manifest_value "$DOCKER_HEALTH_STATUS")" \

    "HTTP_HEALTH_STATUS=$(ops_escape_manifest_value "$HTTP_HEALTH_STATUS")" \

    "LAST_ERROR_SUMMARY=$(ops_escape_manifest_value "${LAST_ERROR_SUMMARY:-}")"



  ops_update_latest_symlink "$MANIFEST_PATH"

}



init_state_manifest() {

  DEPLOY_STATUS="started"

  MIGRATION_STATUS="pending"

  APP_ROLLBACK_STATUS="not_needed"

  DOCKER_HEALTH_STATUS="pending"

  HTTP_HEALTH_STATUS="pending"

  LAST_ERROR_SUMMARY=""

  persist_state_manifest

}



build_images() {

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then

    return 0

  fi



  ops_compose build app

  ops_compose --profile ops build migrator



  NEW_APP_IMAGE_ID="$(ops_get_image_id_from_ref "$STAGING_APP_IMAGE_REF")"

  if [[ -z "$NEW_APP_IMAGE_ID" ]]; then

    ops_die "new app image id is empty after build"

  fi



  DEPLOY_STATUS="images_built"

  persist_state_manifest

}



run_migrations() {

  if ! ops_container_healthy "$STAGING_POSTGRES_CONTAINER"; then

    ops_die "postgres must be healthy before migrations"

  fi



  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then

    MIGRATION_STATUS="dry_run_skipped"

    return 0

  fi



  ops_info "Checking migration status (pre-deploy)..."

  if ! ops_run_prisma_migrate_status "pre"; then

    MIGRATION_STATUS="precheck_failed"

    LAST_ERROR_SUMMARY="migrate status precheck failed"

    persist_state_manifest

    return 1

  fi



  if ! ops_compose --profile ops run --rm --no-TTY migrator migrate deploy; then

    MIGRATION_STATUS="failed"

    LAST_ERROR_SUMMARY="prisma migrate deploy failed"

    persist_state_manifest

    return 1

  fi



  ops_info "Checking migration status (post-deploy)..."

  if ! ops_run_prisma_migrate_status "post"; then

    MIGRATION_STATUS="postcheck_failed"

    LAST_ERROR_SUMMARY="migrate status postcheck failed"

    persist_state_manifest

    return 1

  fi



  MIGRATION_STATUS="applied"

  DEPLOY_STATUS="migrations_applied"

  persist_state_manifest

  return 0

}



restart_app_only() {

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then

    return 0

  fi



  ops_recreate_app_container



  local new_running_image

  new_running_image="$(ops_get_container_image_id "$STAGING_APP_CONTAINER" | ops_normalize_image_id)"

  if [[ -n "$new_running_image" ]]; then

    NEW_APP_IMAGE_ID="$new_running_image"

  fi



  if [[ -n "$NEW_APP_IMAGE_ID" && "$new_running_image" != "$NEW_APP_IMAGE_ID" ]]; then

    ops_die "app container image id does not match newly built image"

  fi



  DEPLOY_STATUS="app_restarted"

  persist_state_manifest

}



verify_health() {

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then

    DOCKER_HEALTH_STATUS="dry_run_skipped"

    HTTP_HEALTH_STATUS="dry_run_skipped"

    return 0

  fi



  if ! ops_container_running "$STAGING_APP_CONTAINER"; then

    DOCKER_HEALTH_STATUS="not_running"

    HTTP_HEALTH_STATUS="skipped"

    LAST_ERROR_SUMMARY="app container is not running"

    return 1

  fi



  if ops_wait_for_docker_health "$STAGING_APP_CONTAINER"; then

    DOCKER_HEALTH_STATUS="healthy"

  else

    DOCKER_HEALTH_STATUS="unhealthy"

    HTTP_HEALTH_STATUS="skipped"

    LAST_ERROR_SUMMARY="docker health check failed"

    return 1

  fi



  if ops_check_http_health; then

    HTTP_HEALTH_STATUS="ok"

    return 0

  fi



  HTTP_HEALTH_STATUS="failed"

  LAST_ERROR_SUMMARY="http health check failed"

  return 1

}



rollback_app_image() {

  if [[ -z "$ROLLBACK_IMAGE_TAG" || -z "$PREVIOUS_APP_IMAGE_ID" ]]; then

    APP_ROLLBACK_STATUS="missing_tag"

    LAST_ERROR_SUMMARY="rollback metadata missing in deploy state"

    return 1

  fi



  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then

    APP_ROLLBACK_STATUS="dry_run_skipped"

    return 0

  fi



  if ! docker image inspect "$ROLLBACK_IMAGE_TAG" >/dev/null 2>&1; then

    APP_ROLLBACK_STATUS="missing_image"

    LAST_ERROR_SUMMARY="rollback image tag not found"

    ops_warn "rollback image ${ROLLBACK_IMAGE_TAG} not found; manual intervention required"

    return 1

  fi



  ops_warn "app health check failed — rolling back app image only (database schema may already have changed)"

  ops_apply_compose_app_image "$ROLLBACK_IMAGE_TAG"

  ops_recreate_app_container



  if ! ops_assert_container_image_matches "$STAGING_APP_CONTAINER" "$PREVIOUS_APP_IMAGE_ID"; then

    APP_ROLLBACK_STATUS="image_mismatch"

    LAST_ERROR_SUMMARY="container image id does not match previous app image"

    return 1

  fi



  if ops_wait_for_docker_health "$STAGING_APP_CONTAINER" && ops_check_http_health; then

    APP_ROLLBACK_STATUS="restored_healthy"

    return 0

  fi



  APP_ROLLBACK_STATUS="restored_unhealthy"

  LAST_ERROR_SUMMARY="health checks failed after app rollback"

  return 1

}



print_plan() {

  ops_info ""

  ops_info "=== Staging deploy plan ==="

  ops_info "Repository: ${OPS_REPO_ROOT}"

  ops_info "Compose: ${STAGING_COMPOSE_FILE}"

  ops_info "Env file: ${STAGING_ENV_FILE} (contents will not be shown)"

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then

    ops_info "Mode: DRY-RUN (no mutating operations)"

  elif [[ "$DEPLOY_YES" -eq 1 ]]; then

    ops_info "Mode: automated (--yes)"

  else

    ops_info "Mode: interactive"

  fi

  ops_info "Steps:"

  ops_info "  1. Validate environment, compose config, and git state"

  ops_info "  2. Fast-forward main to origin/main"

  ops_info "  3. Create and verify PostgreSQL backup"

  ops_info "  4. Tag current app image for rollback"

  ops_info "  5. Write initial deploy state manifest"

  ops_info "  6. Build app and migrator images"

  ops_info "  7. Run prisma migrate status/deploy via ops profile"

  ops_info "  8. Restart app container only"

  ops_info "  9. Wait for Docker health and HTTP /api/health"

  ops_info " 10. Update deploy state manifest after each critical stage"

  ops_info ""

}



main() {

  parse_args "$@"

  ops_setup_common_traps

  ops_cd_repo_root "$(pwd)"

  check_prerequisites



  if [[ "$OPS_DRY_RUN" -eq 0 ]]; then

    ops_acquire_deploy_lock

  fi



  ops_info "Validating ${STAGING_ENV_FILE}..."

  ops_validate_staging_env_file



  check_git_clean

  check_git_branch

  fetch_and_plan_git

  print_plan



  if [[ "$DEPLOY_YES" -eq 0 && "$OPS_DRY_RUN" -eq 0 ]]; then

    ops_require_interactive_confirmation "DEPLOY" "Type DEPLOY to continue:"

  fi



  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then

    ops_info "Dry-run complete — no changes were made."

    exit 0

  fi



  fast_forward_git



  BACKUP_PATH="$(ops_create_postgres_backup "$(git rev-parse --short "$TARGET_COMMIT_SHA")")"

  ops_info "Backup: ${BACKUP_PATH}"



  prepare_rollback_tag

  ops_info "Rollback tag: ${ROLLBACK_IMAGE_TAG}"



  init_state_manifest

  ops_info "State manifest: ${MANIFEST_PATH}"



  build_images



  if ! run_migrations; then

    DEPLOY_STATUS="failed_migration"

    persist_state_manifest

    ops_die "migration failed — app was not restarted; backup preserved at ${BACKUP_PATH}"

  fi



  restart_app_only



  if ! verify_health; then

    DEPLOY_STATUS="failed_health"

    persist_state_manifest

    ops_show_safe_app_logs "$STAGING_APP_CONTAINER"

    rollback_app_image || true

    persist_state_manifest

    ops_die "deploy failed after health check (app rollback attempted; DB schema may differ)"

  fi



  DEPLOY_STATUS="success"

  persist_state_manifest



  ops_info ""

  ops_info "=== Deploy complete ==="

  ops_info "  commit: $(git rev-parse --short HEAD)"

  ops_info "  backup: ${BACKUP_PATH}"

  ops_info "  app image: ${NEW_APP_IMAGE_ID}"

  ops_info "  migration: ${MIGRATION_STATUS}"

  ops_info "  docker health: ${DOCKER_HEALTH_STATUS}"

  ops_info "  http health: ${HTTP_HEALTH_STATUS}"

  ops_info "  manifest: ${MANIFEST_PATH}"

}



main "$@"
