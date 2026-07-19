#!/usr/bin/env bash
# Optional regression: run game-gift-activation-preflight.sql against ephemeral Postgres.
#
# Exit codes:
#   0  — all PostgreSQL scenarios ran and passed
#   77 — SKIP (docker binary or daemon unavailable); NOT a PASS
#   other non-zero — FAIL
#
# Does not touch staging/production. Cleans only its own temporary container.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="${SCRIPT_DIR}/game-gift-activation-preflight.sql"
IMAGE="${GAME_GIFT_PREFLIGHT_PG_IMAGE:-postgres:16-alpine}"
CONTAINER="game-gift-activation-preflight-pg-$$"
SKIP_EXIT=77

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}

if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP: Docker daemon unavailable"
  exit "$SKIP_EXIT"
fi

if ! docker info >/dev/null 2>&1; then
  echo "SKIP: Docker daemon unavailable"
  exit "$SKIP_EXIT"
fi

trap cleanup EXIT

[[ -f "$SQL_FILE" ]] || {
  echo "FAIL missing SQL: $SQL_FILE" >&2
  exit 1
}

docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=preflight \
  "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d preflight >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres -d preflight >/dev/null

run_sql() {
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d preflight -At -F $'\t'
}

# --- Old schema: no activation columns ---
run_sql <<'SQL'
CREATE TABLE game_gifts (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
INSERT INTO game_gifts (id, name) VALUES
  ('11111111-1111-4111-8111-111111111111', 'hands'),
  ('22222222-2222-4222-8222-222222222222', 'c1'),
  ('33333333-3333-4333-8333-333333333333', 'c2'),
  ('44444444-4444-4444-8444-444444444444', 'c3');
SQL

old_ok="$(run_sql <"$SQL_FILE")"
[[ "$old_ok" == $'4\t0\t0\t0\t0\t0\t0\t0' ]] || {
  echo "FAIL old schema + 4 canonical: expected 4\\t0\\t0\\t0\\t0\\t0\\t0\\t0 got: $old_ok" >&2
  exit 1
}
echo "ok: old schema + 4 canonical UUID → clean counters"

run_sql <<'SQL'
DELETE FROM game_gifts WHERE id = '11111111-1111-4111-8111-111111111111';
SQL
old_missing="$(run_sql <"$SQL_FILE")"
[[ "$old_missing" == $'3\t1\t0\t0\t0\t0\t0\t0' ]] || {
  echo "FAIL old schema + missing hands: expected 3\\t1\\t0\\t0\\t0\\t0\\t0\\t0 got: $old_missing" >&2
  exit 1
}
echo "ok: old schema + missing gift → dirty missing counter"

# --- Partial schema: returns row with partial_schema_count=1 ---
run_sql <<'SQL'
DROP TABLE game_gifts;
CREATE TABLE game_gifts (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  activation_mode text
);
INSERT INTO game_gifts (id, name, activation_mode) VALUES
  ('11111111-1111-4111-8111-111111111111', 'hands', 'SINGLE_PAID_SERVICE'),
  ('22222222-2222-4222-8222-222222222222', 'c1', 'COURSE_MIN_SESSIONS'),
  ('33333333-3333-4333-8333-333333333333', 'c2', 'COURSE_MIN_SESSIONS'),
  ('44444444-4444-4444-8444-444444444444', 'c3', 'COURSE_MIN_SESSIONS');
SQL

partial_row="$(run_sql <"$SQL_FILE")"
[[ "$partial_row" == $'4\t0\t0\t1\t0\t0\t0\t0' ]] || {
  echo "FAIL partial schema: expected 4\\t0\\t0\\t1\\t0\\t0\\t0\\t0 got: $partial_row" >&2
  exit 1
}
echo "ok: partial schema → partial_schema_count=1 (SQL succeeds)"

# --- New schema: correct values ---
run_sql <<'SQL'
DROP TABLE game_gifts;
CREATE TABLE game_gifts (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  activation_mode text NOT NULL,
  min_course_sessions int,
  activation_condition_text text NOT NULL
);
INSERT INTO game_gifts (id, name, activation_mode, min_course_sessions, activation_condition_text) VALUES
  ('11111111-1111-4111-8111-111111111111', 'hands', 'SINGLE_PAID_SERVICE', NULL, 'ok hands'),
  ('22222222-2222-4222-8222-222222222222', 'c1', 'COURSE_MIN_SESSIONS', 5, 'ok c1'),
  ('33333333-3333-4333-8333-333333333333', 'c2', 'COURSE_MIN_SESSIONS', 5, 'ok c2'),
  ('44444444-4444-4444-8444-444444444444', 'c3', 'COURSE_MIN_SESSIONS', 5, 'ok c3');
SQL

new_ok="$(run_sql <"$SQL_FILE")"
[[ "$new_ok" == $'4\t0\t0\t0\t0\t0\t0\t0' ]] || {
  echo "FAIL new schema correct: expected 4\\t0\\t0\\t0\\t0\\t0\\t0\\t0 got: $new_ok" >&2
  exit 1
}
echo "ok: new schema + correct values → clean counters"

run_sql <<'SQL'
UPDATE game_gifts
SET activation_mode = 'COURSE_MIN_SESSIONS', min_course_sessions = 5
WHERE id = '11111111-1111-4111-8111-111111111111';
SQL
new_mismatch="$(run_sql <"$SQL_FILE")"
[[ "$new_mismatch" == $'4\t0\t0\t0\t0\t0\t1\t0' ]] || {
  echo "FAIL new schema mismatch: expected 4\\t0\\t0\\t0\\t0\\t0\\t1\\t0 got: $new_mismatch" >&2
  exit 1
}
echo "ok: new schema + mismatch → dirty hands_gift_mismatch_count"

echo "game-gift-activation-preflight-pg-regression: PASS"
