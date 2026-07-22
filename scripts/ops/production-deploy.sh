#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/production-ops-common.sh
source "${SCRIPT_DIR}/lib/production-ops-common.sh"

DEPLOY_HELP=0
DEPLOY_REDEPLOY_CURRENT=0
DEPLOY_MODE="fast_forward"
IS_INITIAL_DEPLOY=0
APP_IMAGE_ROLLBACK_AVAILABLE=0
POSTGRES_EXISTED_AT_START=0
IS_CLEAN_INITIAL_BOOTSTRAP=0
PRE_DEPLOY_BACKUP_REQUIRED=1

MANIFEST_PATH=""
PREVIOUS_COMMIT_SHA=""
TARGET_COMMIT_SHA=""
BACKUP_PATH=""
PREVIOUS_APP_IMAGE_ID=""
ROLLBACK_IMAGE_TAG=""
NEW_APP_IMAGE_ID=""
CURRENT_CONTAINER_IMAGE_REF=""
CURRENT_CONTAINER_IMAGE_ID=""
COMPOSE_APP_IMAGE_ID=""
GIT_STATUS_STAGE="planned"
BACKUP_STATUS="pending"
BUILD_STATUS="pending"
POSTGRES_START_STATUS="not_needed"
MIGRATION_STATUS="pending"
APP_RESTART_STATUS="pending"
DEPLOY_STATUS="pending"
APP_ROLLBACK_STATUS="not_needed"
DOCKER_HEALTH_STATUS="pending"
HTTP_HEALTH_STATUS="pending"
LAST_ERROR_SUMMARY=""

usage() {
  cat <<'EOF'
Usage: scripts/ops/production-deploy.sh [--dry-run] [--redeploy-current] [--help]

Safely deploy production from origin/main with backup, migrations, and health checks.

Options:
  --dry-run            Run safe preflight checks and print the plan only
  --redeploy-current   Rebuild and redeploy the current commit when HEAD already
                       matches origin/main. Does not change Git state.
  --help               Show this help

Requires: git, docker, flock, curl; run as deploy user from /opt/online-zapis-tv-production.
Interactive confirmation: type DEPLOY PRODUCTION to continue.
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
      --redeploy-current)
        if [[ "$DEPLOY_REDEPLOY_CURRENT" -eq 1 ]]; then
          ops_die "duplicate --redeploy-current"
        fi
        DEPLOY_REDEPLOY_CURRENT=1
        DEPLOY_MODE="redeploy_current"
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
    if [[ "$OPS_DRY_RUN" -eq 1 || "$DEPLOY_REDEPLOY_CURRENT" -eq 1 ]]; then
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
    ops_die "detached HEAD is not allowed for production deploy"
  fi
  if [[ "$branch" != "main" ]]; then
    ops_die "production deploy is allowed only from main branch (current: ${branch})"
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
    ops_die "local main has diverged from origin/main (fast-forward only)"
  fi

  ops_info "Git plan:"
  ops_info "  current: $(git rev-parse --short "$current_sha")"
  ops_info "  target:  $(git rev-parse --short "$target_sha")"

  if [[ "$DEPLOY_REDEPLOY_CURRENT" -eq 1 ]]; then
    if [[ "$current_sha" != "$target_sha" ]]; then
      ops_die "origin/main has new commits; use normal deploy without --redeploy-current"
    fi
    ops_info "  commits to deploy: none (redeploy-current: HEAD already matches origin/main)"
    return 0
  fi

  if [[ "$current_sha" == "$target_sha" ]]; then
    ops_info "  commits to deploy: none (already at origin/main)"
    ops_die "no new commits to deploy; refusing no-op deploy. Use --redeploy-current if you need to rebuild and redeploy the current commit."
  fi

  ops_info "  commits to fast-forward:"
  git log --oneline "${current_sha}..${target_sha}" | sed 's/^/    /'
}

collect_app_image_state() {
  COMPOSE_APP_IMAGE_ID="$(ops_get_image_id_from_ref_optional "$PRODUCTION_APP_IMAGE_REF")"

  if ! ops_container_exists "$PRODUCTION_APP_CONTAINER"; then
    IS_INITIAL_DEPLOY=1
    APP_IMAGE_ROLLBACK_AVAILABLE=0
    CURRENT_CONTAINER_IMAGE_ID=""
    CURRENT_CONTAINER_IMAGE_REF="(none — initial deploy)"
    ops_info "Initial deploy: app container ${PRODUCTION_APP_CONTAINER} does not exist yet"
  else
    IS_INITIAL_DEPLOY=0
    APP_IMAGE_ROLLBACK_AVAILABLE=1

    CURRENT_CONTAINER_IMAGE_ID="$(ops_get_container_image_id "$PRODUCTION_APP_CONTAINER" | ops_normalize_image_id)"
    if [[ -z "$CURRENT_CONTAINER_IMAGE_ID" ]]; then
      ops_die "cannot determine current app container image id"
    fi

    CURRENT_CONTAINER_IMAGE_REF="$(ops_get_container_image_reference "$PRODUCTION_APP_CONTAINER" || true)"
    if [[ -z "$CURRENT_CONTAINER_IMAGE_REF" ]]; then
      CURRENT_CONTAINER_IMAGE_REF="(image id ${CURRENT_CONTAINER_IMAGE_ID})"
    fi
  fi

  detect_postgres_deploy_state
}

detect_postgres_deploy_state() {
  if ops_container_exists "$PRODUCTION_POSTGRES_CONTAINER"; then
    POSTGRES_EXISTED_AT_START=1
    IS_CLEAN_INITIAL_BOOTSTRAP=0
    PRE_DEPLOY_BACKUP_REQUIRED=1
    ops_info "Production PostgreSQL container exists: pre-deploy backup is required"
    return 0
  fi

  POSTGRES_EXISTED_AT_START=0

  if [[ "$IS_INITIAL_DEPLOY" -eq 1 ]]; then
    IS_CLEAN_INITIAL_BOOTSTRAP=1
    PRE_DEPLOY_BACKUP_REQUIRED=0
    ops_info "Clean initial bootstrap: PostgreSQL container does not exist; pre-deploy backup is not applicable"
    return 0
  fi

  IS_CLEAN_INITIAL_BOOTSTRAP=0
  PRE_DEPLOY_BACKUP_REQUIRED=1
  ops_warn "Production PostgreSQL container is missing while app container exists; deploy will fail closed at backup"
}

fast_forward_git() {
  if [[ "$OPS_DRY_RUN" -eq 1 || "$DEPLOY_REDEPLOY_CURRENT" -eq 1 ]]; then
    return 0
  fi

  git merge --ff-only origin/main
  local head_sha
  head_sha="$(git rev-parse HEAD)"
  if [[ "$head_sha" != "$TARGET_COMMIT_SHA" ]]; then
    ops_die "fast-forward failed: HEAD does not match target SHA"
  fi
  GIT_STATUS_STAGE="fast_forwarded"
  persist_state_manifest
}

prepare_rollback_tag() {
  local ts short_sha

  if [[ "$IS_INITIAL_DEPLOY" -eq 1 ]]; then
    PREVIOUS_APP_IMAGE_ID=""
    ROLLBACK_IMAGE_TAG=""
    APP_IMAGE_ROLLBACK_AVAILABLE=0
    ops_info "Initial deploy: skipping previous app image capture (app rollback to a prior image is impossible)"
    return 0
  fi

  if ! ops_container_exists "$PRODUCTION_APP_CONTAINER"; then
    ops_die "app container does not exist (required to capture previous image for rollback)"
  fi

  PREVIOUS_APP_IMAGE_ID="$(ops_get_container_image_id "$PRODUCTION_APP_CONTAINER" | ops_normalize_image_id)"
  if [[ -z "$PREVIOUS_APP_IMAGE_ID" ]]; then
    ops_die "cannot determine current app image id"
  fi

  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  short_sha="$(git rev-parse --short "$PREVIOUS_COMMIT_SHA")"
  ROLLBACK_IMAGE_TAG="online-zapis-tv-production-rollback:${ts}_${short_sha}"
  APP_IMAGE_ROLLBACK_AVAILABLE=1

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
    MANIFEST_PATH="${PRODUCTION_DEPLOY_STATE_DIR}/${ts}_${short_target}.env"
  fi

  ops_ensure_private_dir "$PRODUCTION_DEPLOY_STATE_DIR"

  ops_write_manifest_file "$MANIFEST_PATH" \
    "STATE_VERSION=${PRODUCTION_STATE_VERSION}" \
    "TIMESTAMP_UTC=$(date -u +%Y%m%dT%H%M%SZ)" \
    "ENVIRONMENT=production" \
    "DEPLOY_MODE=$(ops_escape_manifest_value "$DEPLOY_MODE")" \
    "IS_INITIAL_DEPLOY=$(ops_escape_manifest_value "$([[ "$IS_INITIAL_DEPLOY" -eq 1 ]] && echo true || echo false)")" \
    "APP_IMAGE_ROLLBACK_AVAILABLE=$(ops_escape_manifest_value "$([[ "$APP_IMAGE_ROLLBACK_AVAILABLE" -eq 1 ]] && echo true || echo false)")" \
    "IS_CLEAN_INITIAL_BOOTSTRAP=$(ops_escape_manifest_value "$([[ "$IS_CLEAN_INITIAL_BOOTSTRAP" -eq 1 ]] && echo true || echo false)")" \
    "POSTGRES_EXISTED_AT_START=$(ops_escape_manifest_value "$([[ "$POSTGRES_EXISTED_AT_START" -eq 1 ]] && echo true || echo false)")" \
    "PRE_DEPLOY_BACKUP_APPLICABLE=$(ops_escape_manifest_value "$([[ "$PRE_DEPLOY_BACKUP_REQUIRED" -eq 1 ]] && echo true || echo false)")" \
    "PREVIOUS_COMMIT_SHA=$(ops_escape_manifest_value "$PREVIOUS_COMMIT_SHA")" \
    "TARGET_COMMIT_SHA=$(ops_escape_manifest_value "$TARGET_COMMIT_SHA")" \
    "GIT_STATUS_STAGE=$(ops_escape_manifest_value "$GIT_STATUS_STAGE")" \
    "BACKUP_PATH=$(ops_escape_manifest_value "$BACKUP_PATH")" \
    "BACKUP_STATUS=$(ops_escape_manifest_value "$BACKUP_STATUS")" \
    "PREVIOUS_APP_IMAGE_ID=$(ops_escape_manifest_value "$PREVIOUS_APP_IMAGE_ID")" \
    "ROLLBACK_IMAGE_TAG=$(ops_escape_manifest_value "$ROLLBACK_IMAGE_TAG")" \
    "NEW_APP_IMAGE_ID=$(ops_escape_manifest_value "${NEW_APP_IMAGE_ID:-}")" \
    "BUILD_STATUS=$(ops_escape_manifest_value "$BUILD_STATUS")" \
    "POSTGRES_START_STATUS=$(ops_escape_manifest_value "$POSTGRES_START_STATUS")" \
    "MIGRATION_STATUS=$(ops_escape_manifest_value "$MIGRATION_STATUS")" \
    "APP_RESTART_STATUS=$(ops_escape_manifest_value "$APP_RESTART_STATUS")" \
    "DEPLOY_STATUS=$(ops_escape_manifest_value "$DEPLOY_STATUS")" \
    "APP_ROLLBACK_STATUS=$(ops_escape_manifest_value "$APP_ROLLBACK_STATUS")" \
    "DOCKER_HEALTH_STATUS=$(ops_escape_manifest_value "$DOCKER_HEALTH_STATUS")" \
    "HTTP_HEALTH_STATUS=$(ops_escape_manifest_value "$HTTP_HEALTH_STATUS")" \
    "LAST_ERROR_SUMMARY=$(ops_escape_manifest_value "${LAST_ERROR_SUMMARY:-}")" \
    "COMPAT_COMMIT_SHA=$(ops_escape_manifest_value "${COMPAT_COMMIT_SHA:-$TARGET_COMMIT_SHA}")" \
    "FULL_BUSY_WRITES_FLAG=$(ops_escape_manifest_value "${FULL_BUSY_WRITES_FLAG:-$(ops_read_env_value APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED "$PRODUCTION_ENV_FILE" || true)}")" \
    "DEPLOY_AT_UTC=$(ops_escape_manifest_value "${DEPLOY_AT_UTC:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}")" \
    "PHASE1_VERSION_ONLY_V2_COUNT=$(ops_escape_manifest_value "${PHASE1_VERSION_ONLY_V2_COUNT:-}")" \
    "CANONICAL_V2_WRITE_COUNT_BEFORE=$(ops_escape_manifest_value "${CANONICAL_V2_WRITE_COUNT_BEFORE:-}")" \
    "CANONICAL_V2_WRITE_COUNT_AFTER=$(ops_escape_manifest_value "${CANONICAL_V2_WRITE_COUNT_AFTER:-}")" \
    "FIRST_CANONICAL_V2_WRITE_AT=$(ops_escape_manifest_value "${FIRST_CANONICAL_V2_WRITE_AT:-}")" \
    "PRE_COMPAT_ROLLBACK_ALLOWED=$(ops_escape_manifest_value "${PRE_COMPAT_ROLLBACK_ALLOWED:-}")" \
    "ALLOWED_ROLLBACK_TARGET=$(ops_escape_manifest_value "${ALLOWED_ROLLBACK_TARGET:-}")" \
    "APP_FULL_BUSY_COMPAT=$(ops_escape_manifest_value "${APP_FULL_BUSY_COMPAT:-yes}")"

  ops_update_latest_symlink "$MANIFEST_PATH"
}

init_state_manifest() {
  DEPLOY_STATUS="started"
  BACKUP_STATUS="${BACKUP_STATUS:-pending}"
  BUILD_STATUS="pending"
  if [[ "$IS_CLEAN_INITIAL_BOOTSTRAP" -eq 1 ]]; then
    POSTGRES_START_STATUS="pending"
  else
    POSTGRES_START_STATUS="not_needed"
  fi
  MIGRATION_STATUS="pending"
  APP_RESTART_STATUS="pending"
  APP_ROLLBACK_STATUS="not_needed"
  DOCKER_HEALTH_STATUS="pending"
  HTTP_HEALTH_STATUS="pending"
  LAST_ERROR_SUMMARY=""
  persist_state_manifest
}

build_images() {
  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    BUILD_STATUS="dry_run_skipped"
    return 0
  fi

  if ! ops_compose build app; then
    BUILD_STATUS="failed"
    DEPLOY_STATUS="failed_build"
    LAST_ERROR_SUMMARY="docker compose build app failed"
    persist_state_manifest
    return 1
  fi
  if ! ops_compose --profile ops build migrator; then
    BUILD_STATUS="failed"
    DEPLOY_STATUS="failed_build"
    LAST_ERROR_SUMMARY="docker compose build migrator failed"
    persist_state_manifest
    return 1
  fi

  NEW_APP_IMAGE_ID="$(ops_get_image_id_from_ref "$PRODUCTION_APP_IMAGE_REF")"
  if [[ -z "$NEW_APP_IMAGE_ID" ]]; then
    BUILD_STATUS="failed"
    DEPLOY_STATUS="failed_build"
    LAST_ERROR_SUMMARY="new app image id is empty after build"
    persist_state_manifest
    return 1
  fi

  BUILD_STATUS="success"
  DEPLOY_STATUS="images_built"
  persist_state_manifest
}

start_production_postgres_for_bootstrap() {
  if [[ "$IS_CLEAN_INITIAL_BOOTSTRAP" -ne 1 ]]; then
    return 0
  fi

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    POSTGRES_START_STATUS="dry_run_skipped"
    return 0
  fi

  ops_info "Clean initial bootstrap: creating production PostgreSQL container..."
  POSTGRES_START_STATUS="starting"
  persist_state_manifest

  if ! ops_compose up -d --no-deps --no-build postgres; then
    POSTGRES_START_STATUS="failed"
    DEPLOY_STATUS="failed_postgres"
    LAST_ERROR_SUMMARY="failed to create production PostgreSQL container"
    persist_state_manifest
    return 1
  fi

  if ! ops_wait_for_docker_health "$PRODUCTION_POSTGRES_CONTAINER"; then
    POSTGRES_START_STATUS="unhealthy"
    DEPLOY_STATUS="failed_postgres"
    LAST_ERROR_SUMMARY="production PostgreSQL container did not become healthy"
    persist_state_manifest
    return 1
  fi

  POSTGRES_START_STATUS="healthy"
  DEPLOY_STATUS="postgres_ready"
  persist_state_manifest
}

run_migrations() {
  local migration_action=""

  if ! ops_container_healthy "$PRODUCTION_POSTGRES_CONTAINER"; then
    ops_die "postgres must be healthy before migrations"
  fi

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    MIGRATION_STATUS="dry_run_skipped"
    return 0
  fi

  ops_info "Checking migration status (pre-deploy)..."
  if ! ops_run_prisma_migrate_status "pre"; then
    MIGRATION_STATUS="precheck_failed"
    DEPLOY_STATUS="failed_migration"
    LAST_ERROR_SUMMARY="migrate status precheck failed"
    persist_state_manifest
    return 1
  fi

  if [[ "$OPS_LAST_MIGRATE_CLASSIFICATION" == "pending" ]]; then
    if ! ops_compose --profile ops run --rm --no-TTY migrator migrate deploy; then
      MIGRATION_STATUS="failed"
      DEPLOY_STATUS="failed_migration"
      LAST_ERROR_SUMMARY="prisma migrate deploy failed"
      persist_state_manifest
      return 1
    fi
    migration_action="applied"
  else
    ops_info "No pending migrations; skipping migrate deploy"
    migration_action="up_to_date"
  fi

  ops_info "Checking migration status (post-deploy)..."
  if ! ops_run_prisma_migrate_status "post"; then
    MIGRATION_STATUS="postcheck_failed"
    DEPLOY_STATUS="failed_migration"
    LAST_ERROR_SUMMARY="migrate status postcheck failed"
    persist_state_manifest
    return 1
  fi

  MIGRATION_STATUS="$migration_action"
  DEPLOY_STATUS="migrations_applied"
  persist_state_manifest
  return 0
}

restart_app_only() {
  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    APP_RESTART_STATUS="dry_run_skipped"
    return 0
  fi

  ops_recreate_app_container

  local new_running_image
  new_running_image="$(ops_get_container_image_id "$PRODUCTION_APP_CONTAINER" | ops_normalize_image_id)"
  if [[ -n "$new_running_image" ]]; then
    NEW_APP_IMAGE_ID="$new_running_image"
  fi

  if [[ -n "$NEW_APP_IMAGE_ID" && "$new_running_image" != "$NEW_APP_IMAGE_ID" ]]; then
    APP_RESTART_STATUS="failed"
    DEPLOY_STATUS="failed_restart"
    LAST_ERROR_SUMMARY="app container image id does not match newly built image"
    persist_state_manifest
    return 1
  fi

  APP_RESTART_STATUS="restarted"
  DEPLOY_STATUS="app_restarted"
  persist_state_manifest
}

verify_health() {
  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    DOCKER_HEALTH_STATUS="dry_run_skipped"
    HTTP_HEALTH_STATUS="dry_run_skipped"
    return 0
  fi

  if ! ops_container_running "$PRODUCTION_APP_CONTAINER"; then
    DOCKER_HEALTH_STATUS="not_running"
    HTTP_HEALTH_STATUS="skipped"
    LAST_ERROR_SUMMARY="app container is not running"
    return 1
  fi

  if ops_wait_for_docker_health "$PRODUCTION_APP_CONTAINER"; then
    DOCKER_HEALTH_STATUS="healthy"
  else
    DOCKER_HEALTH_STATUS="unhealthy"
    HTTP_HEALTH_STATUS="skipped"
    LAST_ERROR_SUMMARY="docker health check failed"
    return 1
  fi

  if ops_check_http_health_production; then
    HTTP_HEALTH_STATUS="ok"
    return 0
  fi

  HTTP_HEALTH_STATUS="failed"
  LAST_ERROR_SUMMARY="http health check failed (expected ok=true and status=healthy)"
  return 1
}

rollback_app_image() {
  if [[ "$IS_INITIAL_DEPLOY" -eq 1 || -z "$ROLLBACK_IMAGE_TAG" || -z "$PREVIOUS_APP_IMAGE_ID" ]]; then
    APP_ROLLBACK_STATUS="unavailable"
    LAST_ERROR_SUMMARY="no previous app image available for rollback (initial deploy or missing rollback metadata)"
    ops_warn "Automatic app image rollback is impossible; previous image was not captured."
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

  if ! ops_assert_container_image_matches "$PRODUCTION_APP_CONTAINER" "$PREVIOUS_APP_IMAGE_ID"; then
    APP_ROLLBACK_STATUS="image_mismatch"
    LAST_ERROR_SUMMARY="container image id does not match previous app image"
    return 1
  fi

  if ops_wait_for_docker_health "$PRODUCTION_APP_CONTAINER" && ops_check_http_health_production; then
    APP_ROLLBACK_STATUS="restored_healthy"
    return 0
  fi

  APP_ROLLBACK_STATUS="restored_unhealthy"
  LAST_ERROR_SUMMARY="health checks failed after app rollback"
  return 1
}

print_plan() {
  local short_sha
  short_sha="$(git rev-parse --short "$TARGET_COMMIT_SHA")"

  ops_info ""
  ops_info "=== Production deploy plan ==="
  ops_info "Repository: ${OPS_REPO_ROOT}"
  ops_info "Compose: ${PRODUCTION_COMPOSE_FILE}"
  ops_info "Env file: ${PRODUCTION_ENV_FILE} (contents will not be shown)"
  ops_info "App URL: http://127.0.0.1:3100"
  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_info "Mode: DRY-RUN (no mutating operations)"
  else
    ops_info "Mode: interactive"
  fi
  if [[ "$IS_INITIAL_DEPLOY" -eq 1 ]]; then
    ops_info "Deploy kind: INITIAL (app container does not exist yet)"
    ops_info "App image rollback: UNAVAILABLE (no previous image to capture)"
  else
    ops_info "Deploy kind: REDEPLOY (existing app container will be replaced)"
    ops_info "App image rollback: AVAILABLE after tagging previous image"
  fi
  if [[ "$POSTGRES_EXISTED_AT_START" -eq 1 ]]; then
    ops_info "PostgreSQL: EXISTS (pre-deploy backup required)"
  else
    ops_info "PostgreSQL: MISSING"
  fi
  if [[ "$IS_CLEAN_INITIAL_BOOTSTRAP" -eq 1 ]]; then
    ops_info "Bootstrap: CLEAN INITIAL (app + PostgreSQL absent)"
    ops_info "Pre-deploy backup: NOT APPLICABLE (no production database yet)"
  elif [[ "$PRE_DEPLOY_BACKUP_REQUIRED" -eq 1 ]]; then
    ops_info "Pre-deploy backup: REQUIRED (verified pg_dump before migrations)"
  fi
  if [[ "$DEPLOY_REDEPLOY_CURRENT" -eq 1 ]]; then
    ops_info "Deploy mode: redeploy-current (Git will not change)"
  else
    ops_info "Deploy mode: fast-forward"
  fi

  if [[ "$DEPLOY_REDEPLOY_CURRENT" -eq 1 ]]; then
    ops_info ""
    ops_info "Redeploy-current summary:"
    ops_info "  commit (current == target): ${short_sha}"
    ops_info "  running container image ref: ${CURRENT_CONTAINER_IMAGE_REF}"
    ops_info "  running container image id:  ${CURRENT_CONTAINER_IMAGE_ID:-none}"
    ops_info "  compose app image ref:       ${PRODUCTION_APP_IMAGE_REF}"
    if [[ -n "$COMPOSE_APP_IMAGE_ID" ]]; then
      ops_info "  compose app image id:        ${COMPOSE_APP_IMAGE_ID}"
    else
      ops_info "  compose app image id:        (not present locally until build)"
    fi
  fi

  ops_info "Steps:"
  ops_info "  1. Validate production checkout, env, compose, and git state"
  if [[ "$IS_CLEAN_INITIAL_BOOTSTRAP" -eq 1 ]]; then
    if [[ "$DEPLOY_REDEPLOY_CURRENT" -eq 1 ]]; then
      ops_info "  2. Skip pre-deploy backup (not applicable — production database absent)"
      ops_info "  3. Skip previous app image tag (initial deploy — no rollback image)"
      ops_info "  4. Write initial deploy state manifest"
      ops_info "  5. Build app and migrator images"
      ops_info "  6. Create and wait for healthy production PostgreSQL"
      ops_info "  7. Run prisma migrate status/deploy via ops profile"
      ops_info "  8. Create production app container"
      ops_info "  9. Wait for Docker health and HTTP /api/health"
    else
      ops_info "  2. Fast-forward main to origin/main"
      ops_info "  3. Skip pre-deploy backup (not applicable — production database absent)"
      ops_info "  4. Skip previous app image tag (initial deploy — no rollback image)"
      ops_info "  5. Write initial deploy state manifest"
      ops_info "  6. Build app and migrator images"
      ops_info "  7. Create and wait for healthy production PostgreSQL"
      ops_info "  8. Run prisma migrate status/deploy via ops profile"
      ops_info "  9. Create production app container"
      ops_info " 10. Wait for Docker health and HTTP /api/health"
    fi
  elif [[ "$DEPLOY_REDEPLOY_CURRENT" -eq 1 ]]; then
    ops_info "  2. Create and verify PostgreSQL backup (atomic)"
    if [[ "$IS_INITIAL_DEPLOY" -eq 1 ]]; then
      ops_info "  3. Skip previous app image tag (initial deploy — no rollback image)"
    else
      ops_info "  3. Tag current app image for rollback"
    fi
    ops_info "  4. Write initial deploy state manifest"
    ops_info "  5. Build app and migrator images"
    ops_info "  6. Run prisma migrate status/deploy via ops profile"
    ops_info "  7. Create/recreate production app container only"
    ops_info "  8. Wait for Docker health and HTTP /api/health"
  else
    ops_info "  2. Fast-forward main to origin/main"
    ops_info "  3. Create and verify PostgreSQL backup (atomic)"
    if [[ "$IS_INITIAL_DEPLOY" -eq 1 ]]; then
      ops_info "  4. Skip previous app image tag (initial deploy — no rollback image)"
    else
      ops_info "  4. Tag current app image for rollback"
    fi
    ops_info "  5. Write initial deploy state manifest"
    ops_info "  6. Build app and migrator images"
    ops_info "  7. Run prisma migrate status/deploy via ops profile"
    ops_info "  8. Create/recreate production app container only"
    ops_info "  9. Wait for Docker health and HTTP /api/health"
  fi
  ops_info "Manifest directory: ${PRODUCTION_DEPLOY_STATE_DIR}"
  ops_info "Backup directory: ${PRODUCTION_BACKUPS_POSTGRES_DIR}"
  ops_info ""
}

main() {
  parse_args "$@"
  ops_setup_common_traps
  ops_cd_repo_root "$(pwd)"
  ops_assert_production_checkout
  check_prerequisites

  if [[ "$OPS_DRY_RUN" -eq 0 ]]; then
    ops_acquire_production_ops_lock
  fi

  ops_info "Validating ${PRODUCTION_ENV_FILE}..."
  ops_validate_production_env_file

  check_git_clean
  check_git_branch
  fetch_and_plan_git

  collect_app_image_state

  print_plan

  if [[ "$OPS_DRY_RUN" -eq 0 ]]; then
    ops_require_interactive_confirmation "DEPLOY PRODUCTION" "Type DEPLOY PRODUCTION to continue:"
  fi

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_info "Dry-run complete — no changes were made."
    exit 0
  fi

  fast_forward_git

  if [[ "$PRE_DEPLOY_BACKUP_REQUIRED" -eq 1 ]]; then
    BACKUP_PATH="$(ops_create_production_postgres_backup "$(git rev-parse --short "$TARGET_COMMIT_SHA")")"
    BACKUP_STATUS="verified"
    ops_info "Backup: ${BACKUP_PATH}"
  else
    BACKUP_PATH=""
    BACKUP_STATUS="not_applicable_no_database"
    ops_info "Pre-deploy backup: not applicable (production database / PostgreSQL container was absent)"
  fi

  prepare_rollback_tag
  if [[ "$IS_INITIAL_DEPLOY" -eq 1 ]]; then
    ops_info "Rollback tag: (none — initial deploy)"
  else
    ops_info "Rollback tag: ${ROLLBACK_IMAGE_TAG}"
  fi

  init_state_manifest
  ops_info "State manifest: ${MANIFEST_PATH}"

  if ! build_images; then
    ops_die "build failed (manifest: ${MANIFEST_PATH})"
  fi

  if [[ "$IS_CLEAN_INITIAL_BOOTSTRAP" -eq 1 ]]; then
    if ! start_production_postgres_for_bootstrap; then
      ops_die "failed to start production PostgreSQL (manifest: ${MANIFEST_PATH})"
    fi
  fi

  if ! run_migrations; then
    if [[ -n "$BACKUP_PATH" ]]; then
      ops_die "migration failed — app was not restarted; backup preserved at ${BACKUP_PATH} (manifest: ${MANIFEST_PATH})"
    fi
    ops_die "migration failed — app was not restarted; no pre-deploy backup (clean initial bootstrap; manifest: ${MANIFEST_PATH})"
  fi

  if ! restart_app_only; then
    ops_die "app restart failed (manifest: ${MANIFEST_PATH})"
  fi

  if ! verify_health; then
    DEPLOY_STATUS="failed_health"
    persist_state_manifest
    ops_show_safe_app_logs "$PRODUCTION_APP_CONTAINER"
    rollback_app_image || true
    persist_state_manifest
    if [[ "$IS_INITIAL_DEPLOY" -eq 1 ]]; then
      ops_die "deploy failed after health check (initial deploy has no previous app image to roll back; manifest: ${MANIFEST_PATH})"
    fi
    ops_die "deploy failed after health check (app rollback attempted; DB schema may differ; manifest: ${MANIFEST_PATH})"
  fi

  DEPLOY_STATUS="success"
  persist_state_manifest

  ops_info ""
  ops_info "=== Production deploy complete ==="
  ops_info "  commit: $(git rev-parse --short HEAD)"
  ops_info "  deploy mode: ${DEPLOY_MODE}"
  ops_info "  deploy kind: $([[ "$IS_INITIAL_DEPLOY" -eq 1 ]] && echo initial || echo redeploy)"
  ops_info "  clean bootstrap: $([[ "$IS_CLEAN_INITIAL_BOOTSTRAP" -eq 1 ]] && echo yes || echo no)"
  if [[ -n "$BACKUP_PATH" ]]; then
    ops_info "  backup: ${BACKUP_PATH}"
  else
    ops_info "  backup: (not applicable — no production database at start)"
  fi
  ops_info "  backup status: ${BACKUP_STATUS}"
  ops_info "  postgres start: ${POSTGRES_START_STATUS}"
  ops_info "  app image: ${NEW_APP_IMAGE_ID}"
  ops_info "  migration: ${MIGRATION_STATUS}"
  ops_info "  docker health: ${DOCKER_HEALTH_STATUS}"
  ops_info "  http health: ${HTTP_HEALTH_STATUS}"
  ops_info "  full busy writes: $(ops_print_full_busy_writes_runtime_label "$PRODUCTION_ENV_FILE")"
  ops_info "  manifest: ${MANIFEST_PATH}"
}

main "$@"
