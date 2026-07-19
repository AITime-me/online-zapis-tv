#!/usr/bin/env bash
# READ-ONLY preflight: open game booking phone+catalog uniqueness (staging).
# Does not print env values, phones, or other PII.
# Exit 1 if any of the four counters is non-zero.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/staging-ops-common.sh
source "${SCRIPT_DIR}/lib/staging-ops-common.sh"

SQL_FILE="${SCRIPT_DIR}/lib/open-game-phone-catalog-preflight.sql"
PREFLIGHT_HELP=0

usage() {
  cat <<'EOF'
Usage: scripts/ops/staging-preflight-open-game-phone-catalog.sh [--dry-run] [--help]

Read-only PostgreSQL preflight on the CURRENT (pre-migration) staging schema.
Computes future normalized phone + game catalog via the same expressions as
prisma/migrations/20260719120000_booking_request_open_game_phone_catalog.

Prints only:
  conflict_group_count
  conflict_row_count
  open_game_rows_missing_catalog_count
  open_game_rows_invalid_phone_count

Exits non-zero if any counter != 0. Does not modify data.

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

  # Expect one row: four tab-separated integers.
  local g r m p
  IFS=$'\t' read -r g r m p <<<"$(echo "$output" | tail -n 1)"

  if [[ -z "${g:-}" || -z "${r:-}" || -z "${m:-}" || -z "${p:-}" ]]; then
    ops_die "preflight returned unexpected output shape"
  fi

  ops_info "conflict_group_count=$g"
  ops_info "conflict_row_count=$r"
  ops_info "open_game_rows_missing_catalog_count=$m"
  ops_info "open_game_rows_invalid_phone_count=$p"

  if [[ "$g" != "0" || "$r" != "0" || "$m" != "0" || "$p" != "0" ]]; then
    ops_die "preflight failed: resolve open-game conflicts/legacy rows manually before migrate deploy"
  fi

  ops_info "preflight OK: all counters are 0"
}

parse_args "$@"
run_preflight
