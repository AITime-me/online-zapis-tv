-- EXPAND: configurable GameGift activation conditions (single service vs course).
--
-- Prisma Migrate for PostgreSQL does NOT wrap migrations in a transaction by
-- default. This file uses an explicit BEGIN/COMMIT so DDL + backfill + fail-fast
-- apply atomically.
-- On RAISE / any error before COMMIT, PostgreSQL rolls back the whole file.
--
-- Rollback-safe (manual ops after failed deploy image rollback):
--   DROP INDEX IF EXISTS game_gifts_activation_mode_idx;
--   ALTER TABLE game_gifts DROP COLUMN IF EXISTS activation_condition_text;
--   ALTER TABLE game_gifts DROP COLUMN IF EXISTS min_course_sessions;
--   ALTER TABLE game_gifts DROP COLUMN IF EXISTS activation_mode;
--   DROP TYPE IF EXISTS "GameGiftActivationMode";
-- Older app images ignore the new columns until the new app restarts.
--
-- REQUIRED before migrate deploy:
--   Run scripts/ops/staging-preflight-game-gift-activation.sh
--   (or production-*) — read-only; counters should be 0 after this migration's
--   backfill rules would apply (preflight documents expected dirty cases).
--
-- Never auto-close, delete, or merge booking / game_play rows.
-- Existing giftSnapshot JSON on GamePlay is left unchanged (immutable).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'GameGiftActivationMode'
  ) THEN
    CREATE TYPE "GameGiftActivationMode" AS ENUM (
      'SINGLE_PAID_SERVICE',
      'COURSE_MIN_SESSIONS'
    );
  END IF;
END $$;

ALTER TABLE "game_gifts"
ADD COLUMN IF NOT EXISTS "activation_mode" "GameGiftActivationMode"
  NOT NULL DEFAULT 'SINGLE_PAID_SERVICE';

ALTER TABLE "game_gifts"
ADD COLUMN IF NOT EXISTS "min_course_sessions" INTEGER;

ALTER TABLE "game_gifts"
ADD COLUMN IF NOT EXISTS "activation_condition_text" TEXT
  NOT NULL DEFAULT '';

-- Canonical four gifts (IDs match prisma/seed + game-promotions-canonical).
UPDATE "game_gifts"
SET
  "activation_mode" = 'SINGLE_PAID_SERVICE',
  "min_course_sessions" = NULL,
  "activation_condition_text" =
    'Подарок предоставляется при записи на одну оплачиваемую процедуру по выпавшему направлению'
WHERE "id" = '11111111-1111-4111-8111-111111111111';

UPDATE "game_gifts"
SET
  "activation_mode" = 'COURSE_MIN_SESSIONS',
  "min_course_sessions" = 5,
  "activation_condition_text" =
    'Подарок предоставляется при покупке курса минимум из 5 процедур по выпавшему направлению. Один подарок действует на один оплаченный курс'
WHERE "id" IN (
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
);

-- Any other gifts: ensure non-empty client-facing condition (safe default).
UPDATE "game_gifts"
SET
  "activation_mode" = COALESCE("activation_mode", 'SINGLE_PAID_SERVICE'),
  "activation_condition_text" =
    CASE
      WHEN trim(coalesce("activation_condition_text", '')) <> '' THEN "activation_condition_text"
      WHEN "activation_mode" = 'COURSE_MIN_SESSIONS' THEN
        'Подарок предоставляется при покупке курса минимум из '
        || coalesce("min_course_sessions", 5)::text
        || ' процедур по выпавшему направлению. Один подарок действует на один оплаченный курс'
      ELSE
        'Подарок предоставляется при записи на одну оплачиваемую процедуру по выпавшему направлению'
    END
WHERE trim(coalesce("activation_condition_text", '')) = '';

-- COURSE rows without a positive min must get a safe default before fail-fast.
UPDATE "game_gifts"
SET "min_course_sessions" = 5
WHERE "activation_mode" = 'COURSE_MIN_SESSIONS'
  AND ("min_course_sessions" IS NULL OR "min_course_sessions" < 1);

-- SINGLE rows must not keep a course count.
UPDATE "game_gifts"
SET "min_course_sessions" = NULL
WHERE "activation_mode" = 'SINGLE_PAID_SERVICE'
  AND "min_course_sessions" IS NOT NULL;

-- Fail-fast: never leave gifts without a readable condition.
DO $$
DECLARE
  empty_condition_count int;
  course_missing_min_count int;
BEGIN
  SELECT COUNT(*)::int
  INTO empty_condition_count
  FROM "game_gifts"
  WHERE trim(coalesce("activation_condition_text", '')) = '';

  SELECT COUNT(*)::int
  INTO course_missing_min_count
  FROM "game_gifts"
  WHERE "activation_mode" = 'COURSE_MIN_SESSIONS'
    AND ("min_course_sessions" IS NULL OR "min_course_sessions" < 1 OR "min_course_sessions" > 100);

  IF empty_condition_count <> 0 OR course_missing_min_count <> 0 THEN
    RAISE EXCEPTION
      'game-gift-activation migration blocked: empty_condition_count=%, course_missing_min_count=%. Fix gift rows manually, then re-run migrate. No booking/game_play rows were modified.',
      empty_condition_count,
      course_missing_min_count;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "game_gifts_activation_mode_idx"
ON "game_gifts"("activation_mode");

COMMIT;
