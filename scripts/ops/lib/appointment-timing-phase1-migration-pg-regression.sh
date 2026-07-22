#!/usr/bin/env bash
# Optional regression: execute Phase 1 timing migration SQL against ephemeral Postgres.
#
# Exit codes:
#   0  — all PostgreSQL scenarios ran and passed
#   77 — SKIP (docker binary or daemon unavailable); NOT a PASS
#   other non-zero — FAIL
#
# Does not touch staging/production. Cleans only its own temporary container.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
MIGRATION_SQL="${REPO_ROOT}/prisma/migrations/20260722190000_appointment_timing_semantics_phase1/migration.sql"
IMAGE="${APPOINTMENT_TIMING_PHASE1_PG_IMAGE:-postgres:16-alpine}"
CONTAINER="appointment-timing-phase1-pg-$$"
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

[[ -f "$MIGRATION_SQL" ]] || {
  echo "FAIL missing migration SQL: $MIGRATION_SQL" >&2
  exit 1
}

docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=phase1 \
  "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d phase1 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres -d phase1 >/dev/null

run_sql() {
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d phase1 -At -F $'\t'
}

run_sql <<'SQL'
CREATE TABLE "appointments" (
  "id" text PRIMARY KEY,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "is_manual_time_override" boolean NOT NULL DEFAULT false,
  "standard_duration_minutes" integer,
  "break_after_minutes" integer,
  "standard_break_after_minutes" integer
);

INSERT INTO "appointments" (
  "id",
  "starts_at",
  "ends_at",
  "is_manual_time_override",
  "standard_duration_minutes",
  "break_after_minutes",
  "standard_break_after_minutes"
) VALUES
  (
    'negative_duration',
    TIMESTAMPTZ '2026-07-20 10:00:00+05',
    TIMESTAMPTZ '2026-07-20 10:20:00+05',
    false,
    -10,
    30,
    30
  ),
  (
    'shortened_manual',
    TIMESTAMPTZ '2026-07-20 10:00:00+05',
    TIMESTAMPTZ '2026-07-20 11:10:00+05',
    true,
    120,
    30,
    30
  ),
  (
    'exact_already_full',
    TIMESTAMPTZ '2026-07-20 10:00:00+05',
    TIMESTAMPTZ '2026-07-20 11:20:00+05',
    false,
    60,
    20,
    20
  ),
  (
    'exact_procedure_only',
    TIMESTAMPTZ '2026-07-20 10:00:00+05',
    TIMESTAMPTZ '2026-07-20 11:00:00+05',
    false,
    60,
    20,
    20
  ),
  (
    'non_minute_aligned',
    TIMESTAMPTZ '2026-07-20 10:00:00+05',
    TIMESTAMPTZ '2026-07-20 11:20:01+05',
    false,
    60,
    20,
    20
  );
SQL

docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d phase1 <"$MIGRATION_SQL" >/dev/null

result="$(run_sql <<'SQL'
SELECT "id", "timing_semantics_version",
  CASE WHEN "timing_canonical_stored_at" IS NULL THEN 'NULL' ELSE 'SET' END,
  to_char(("ends_at" AT TIME ZONE 'Asia/Yekaterinburg'), 'HH24:MI:SS')
FROM "appointments"
ORDER BY "id";
SQL
)"

expected=$'exact_already_full\t2\tNULL\t11:20:00
exact_procedure_only\t1\tNULL\t11:00:00
negative_duration\t1\tNULL\t10:20:00
non_minute_aligned\t1\tNULL\t11:20:01
shortened_manual\t1\tNULL\t11:10:00'

[[ "$result" == "$expected" ]] || {
  echo "FAIL unexpected migration result:" >&2
  echo "$result" >&2
  echo "expected:" >&2
  echo "$expected" >&2
  exit 1
}

echo "ok: negative_duration remains v1"
echo "ok: shortened_manual remains v1"
echo "ok: exact_already_full becomes v2"
echo "ok: exact_procedure_only remains v1"
echo "ok: non_minute_aligned remains v1"
echo "appointment-timing-phase1-migration-pg-regression: PASS"
