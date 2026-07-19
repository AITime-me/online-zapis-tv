-- READ-ONLY preflight for GameGift activation columns / backfill contract.
-- Safe to run BEFORE or AFTER migrate deploy.
-- When activation columns are absent, activation-field mismatch counters are 0;
-- missing-count counters still check canonical UUID presence by id only.
-- Outputs ONLY integer counters (no gift names/IDs).
-- Does not UPDATE/DELETE/INSERT.

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
gift_stats AS (
  SELECT
    (SELECT COUNT(*)::int FROM "game_gifts") AS gift_total,
    -- Missing: expect exactly 1 hands UUID and exactly 3 course UUIDs.
    -- Wrong UUID / absence / unexpected duplicate row count → non-zero.
    CASE
      WHEN (SELECT hands_present FROM canonical) = 1 THEN 0
      ELSE GREATEST(1, ABS(1 - (SELECT hands_present FROM canonical)))
    END AS hands_gift_missing_count,
    CASE
      WHEN (SELECT course_present FROM canonical) = 3 THEN 0
      ELSE GREATEST(1, ABS(3 - (SELECT course_present FROM canonical)))
    END AS course_gifts_missing_count,
    CASE
      WHEN (SELECT has_condition_text FROM cols)
      THEN (
        SELECT COUNT(*)::int FROM "game_gifts"
        WHERE trim(coalesce("activation_condition_text", '')) = ''
      )
      ELSE 0
    END AS empty_condition_count,
    CASE
      WHEN (SELECT has_activation_mode FROM cols)
        AND (SELECT has_min_sessions FROM cols)
      THEN (
        SELECT COUNT(*)::int FROM "game_gifts"
        WHERE "activation_mode"::text = 'COURSE_MIN_SESSIONS'
          AND ("min_course_sessions" IS NULL OR "min_course_sessions" < 1 OR "min_course_sessions" > 100)
      )
      ELSE 0
    END AS course_missing_min_count,
    CASE
      WHEN (SELECT has_activation_mode FROM cols)
        AND (SELECT has_condition_text FROM cols)
      THEN (
        SELECT COUNT(*)::int FROM "game_gifts"
        WHERE "id" = '11111111-1111-4111-8111-111111111111'
          AND (
            "activation_mode"::text IS DISTINCT FROM 'SINGLE_PAID_SERVICE'
            OR trim(coalesce("activation_condition_text", '')) = ''
          )
      )
      ELSE 0
    END AS hands_gift_mismatch_count,
    CASE
      WHEN (SELECT has_activation_mode FROM cols)
        AND (SELECT has_min_sessions FROM cols)
      THEN (
        SELECT COUNT(*)::int FROM "game_gifts"
        WHERE "id" IN (
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333',
          '44444444-4444-4444-8444-444444444444'
        )
          AND (
            "activation_mode"::text IS DISTINCT FROM 'COURSE_MIN_SESSIONS'
            OR coalesce("min_course_sessions", 0) <> 5
          )
      )
      ELSE 0
    END AS course_gifts_mismatch_count
)
SELECT
  gift_total,
  hands_gift_missing_count,
  course_gifts_missing_count,
  empty_condition_count,
  course_missing_min_count,
  hands_gift_mismatch_count,
  course_gifts_mismatch_count
FROM gift_stats;
