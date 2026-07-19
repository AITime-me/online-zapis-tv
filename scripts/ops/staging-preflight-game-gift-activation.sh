#!/usr/bin/env bash
# READ-ONLY preflight: GameGift activation conditions (staging).
# Does not print env values, gift names, or IDs.
# Exit 1 if any missing/mismatch/invalid activation counter != 0.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/staging-ops-common.sh
source "${SCRIPT_DIR}/lib/staging-ops-common.sh"

SQL_FILE="${SCRIPT_DIR}/lib/game-gift-activation-preflight.sql"
PREFLIGHT_HELP=0

usage() {
  cat <<'EOF'
Usage: scripts/ops/staging-preflight-game-gift-activation.sh [--dry-run] [--help]

Read-only PostgreSQL preflight for GameGift activation columns.
Safe before or after prisma/migrations/20260720120000_game_gift_activation_conditions.

Prints only:
  gift_total
  hands_gift_missing_count
  course_gifts_missing_count
  empty_condition_count
  course_missing_min_count
  hands_gift_mismatch_count
  course_gifts_mismatch_count

Exits non-zero if any missing/mismatch/invalid counter != 0.
Does not modify data.

Requires: docker; run as deploy user from repository root with .env.staging present.
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
        PREFLIGHT_HELP=1
        ;;
      *)
        ops_die "unknown argument: $1"
        ;;
    esac
    shift
  done

  if [[ "$PREFLIGHT_HELP" -eq 1 ]]; then
    usage
    exit 0
  fi
}

run_preflight() {
  ops_require_commands docker
  ops_check_docker_daemon
  ops_check_docker_compose
  ops_cd_repo_root
  ops_compose_preflight

  [[ -f "$SQL_FILE" ]] || ops_die "missing SQL file: $SQL_FILE"

  local pg_user pg_db
  pg_user="$(ops_read_env_value POSTGRES_USER "$STAGING_ENV_FILE")"
  pg_db="$(ops_read_env_value POSTGRES_DB "$STAGING_ENV_FILE")"
  [[ -n "$pg_user" ]] || ops_die "POSTGRES_USER missing in env file"
  [[ -n "$pg_db" ]] || ops_die "POSTGRES_DB missing in env file"

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_info "dry-run: would exec read-only preflight SQL against staging postgres"
    ops_info "dry-run: SQL file=$SQL_FILE"
    ops_info "dry-run: database name present (value not printed)"
    exit 0
  fi

  local output
  if ! output="$(
    ops_compose exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U "$pg_user" -d "$pg_db" -At -F $'\t' \
      -f - <"$SQL_FILE"
  )"; then
    ops_die "preflight SQL failed"
  fi

  local gift_total hands_missing course_missing empty_condition course_missing_min \
    hands_mismatch course_mismatch
  IFS=$'\t' read -r gift_total hands_missing course_missing empty_condition \
    course_missing_min hands_mismatch course_mismatch \
    <<<"$(echo "$output" | tail -n 1)"

  if [[ -z "${gift_total:-}" || -z "${hands_missing:-}" || -z "${course_missing:-}" \
        || -z "${empty_condition:-}" || -z "${course_missing_min:-}" \
        || -z "${hands_mismatch:-}" || -z "${course_mismatch:-}" ]]; then
    ops_die "preflight returned unexpected output shape"
  fi

  ops_info "gift_total=$gift_total"
  ops_info "hands_gift_missing_count=$hands_missing"
  ops_info "course_gifts_missing_count=$course_missing"
  ops_info "empty_condition_count=$empty_condition"
  ops_info "course_missing_min_count=$course_missing_min"
  ops_info "hands_gift_mismatch_count=$hands_mismatch"
  ops_info "course_gifts_mismatch_count=$course_mismatch"

  if [[ "$hands_missing" != "0" || "$course_missing" != "0" \
        || "$empty_condition" != "0" || "$course_missing_min" != "0" \
        || "$hands_mismatch" != "0" || "$course_mismatch" != "0" ]]; then
    ops_die "preflight failed: fix GameGift activation rows before migrate deploy / go-live"
  fi

  ops_info "preflight OK: activation condition counters are 0"
}

parse_args "$@"
run_preflight
