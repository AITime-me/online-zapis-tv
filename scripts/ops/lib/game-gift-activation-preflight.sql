-- READ-ONLY preflight for GameGift activation columns / backfill contract.
-- Safe to run BEFORE or AFTER migrate deploy.
--
-- Schema branching (IMPORTANT):
-- New activation values are read ONLY via to_jsonb(row) ->> 'key'.
-- Do NOT reference activation_* / min_course_sessions as SQL column identifiers:
-- PostgreSQL parses those identifiers even inside CASE/IF branches, so a
-- "schema-aware" CASE still fails on pre-migration databases.
--
-- Schema forms:
--   0 of 3 new columns → pre-migration: missing-id counters + gift_total;
--                        partial_schema_count = 0; activation counters = 0.
--   3 of 3 new columns → post-migration: activation counters enforced;
--                        partial_schema_count = 0.
--   1 or 2 of 3        → partial_schema_count = 1; query still returns a row;
--                        shells treat any counter 2–8 != 0 as fail.
--
-- Eight pipe/tab-delimited integer counters (no gift names/IDs):
--   gift_total
--   hands_gift_missing_count
--   course_gifts_missing_count
--   partial_schema_count
--   empty_condition_count
--   course_missing_min_count
--   hands_gift_mismatch_count
--   course_gifts_mismatch_count
--
-- Does not UPDATE/DELETE/INSERT/CREATE/ALTER.
-- No intentional planner traps (invalid constant casts, 1/0, etc.).

WITH cols AS (
  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'game_gifts'
        AND column_name = 'activation_mode'
    ) AS has_activation_mode,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'game_gifts'
        AND column_name = 'activation_condition_text'
    ) AS has_condition_text,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'game_gifts'
        AND column_name = 'min_course_sessions'
    ) AS has_min_sessions
),
schema_form AS (
  SELECT
    (
      (SELECT has_activation_mode FROM cols)::int
      + (SELECT has_condition_text FROM cols)::int
      + (SELECT has_min_sessions FROM cols)::int
    ) AS activation_col_count
),
canonical AS (
  SELECT
    (
      SELECT COUNT(*)::int FROM "game_gifts"
      WHERE "id" = '11111111-1111-4111-8111-111111111111'
    ) AS hands_present,
    (
      SELECT COUNT(*)::int FROM "game_gifts"
      WHERE "id" IN (
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444'
      )
    ) AS course_present
),
-- Row payload as jsonb so activation fields are JSON keys, not column ids.
gift_json AS (
  SELECT
    g."id" AS id,
    to_jsonb(g) AS j
  FROM "game_gifts" g
),
gift_stats AS (
  SELECT
    (SELECT COUNT(*)::int FROM "game_gifts") AS gift_total,
    -- Missing: expect exactly 1 hands UUID and exactly 3 course UUIDs.
    CASE
      WHEN (SELECT hands_present FROM canonical) = 1 THEN 0
      ELSE GREATEST(1, ABS(1 - (SELECT hands_present FROM canonical)))
    END AS hands_gift_missing_count,
    CASE
      WHEN (SELECT course_present FROM canonical) = 3 THEN 0
      ELSE GREATEST(1, ABS(3 - (SELECT course_present FROM canonical)))
    END AS course_gifts_missing_count,
    CASE
      WHEN (SELECT activation_col_count FROM schema_form) IN (0, 3) THEN 0
      ELSE 1
    END AS partial_schema_count,
    CASE
      WHEN (SELECT activation_col_count FROM schema_form) = 3
      THEN (
        SELECT COUNT(*)::int FROM gift_json
        WHERE trim(coalesce(j->>'activation_condition_text', '')) = ''
      )
      ELSE 0
    END AS empty_condition_count,
    CASE
      WHEN (SELECT activation_col_count FROM schema_form) = 3
      THEN (
        SELECT COUNT(*)::int FROM gift_json
        WHERE j->>'activation_mode' = 'COURSE_MIN_SESSIONS'
          AND (
            (j->>'min_course_sessions') IS NULL
            OR (j->>'min_course_sessions')::int < 1
            OR (j->>'min_course_sessions')::int > 100
          )
      )
      ELSE 0
    END AS course_missing_min_count,
    CASE
      WHEN (SELECT activation_col_count FROM schema_form) = 3
      THEN (
        SELECT COUNT(*)::int FROM gift_json
        WHERE id = '11111111-1111-4111-8111-111111111111'
          AND (
            (j->>'activation_mode') IS DISTINCT FROM 'SINGLE_PAID_SERVICE'
            OR trim(coalesce(j->>'activation_condition_text', '')) = ''
          )
      )
      ELSE 0
    END AS hands_gift_mismatch_count,
    CASE
      WHEN (SELECT activation_col_count FROM schema_form) = 3
      THEN (
        SELECT COUNT(*)::int FROM gift_json
        WHERE id IN (
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333',
          '44444444-4444-4444-8444-444444444444'
        )
          AND (
            (j->>'activation_mode') IS DISTINCT FROM 'COURSE_MIN_SESSIONS'
            OR coalesce((j->>'min_course_sessions')::int, 0) <> 5
          )
      )
      ELSE 0
    END AS course_gifts_mismatch_count
)
SELECT
  gift_total,
  hands_gift_missing_count,
  course_gifts_missing_count,
  partial_schema_count,
  empty_condition_count,
  course_missing_min_count,
  hands_gift_mismatch_count,
  course_gifts_mismatch_count
FROM gift_stats;
