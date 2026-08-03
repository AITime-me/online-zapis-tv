-- EXPAND: Wheel of Fortune prize metadata on GameGift (additive).
--
-- Prisma Migrate for PostgreSQL does NOT wrap migrations in a transaction by
-- default. This file uses an explicit BEGIN/COMMIT so DDL applies atomically.
-- On RAISE / any error before COMMIT, PostgreSQL rolls back the whole file.
--
-- Rollback-safe (manual ops after failed deploy image rollback):
--   DROP INDEX IF EXISTS "game_gifts_game_catalog_id_system_key_key";
--   DROP INDEX IF EXISTS "game_gifts_prize_type_idx";
--   DROP INDEX IF EXISTS "game_gifts_system_key_idx";
--   ALTER TABLE "game_gifts" DROP COLUMN IF EXISTS "sort_order";
--   ALTER TABLE "game_gifts" DROP COLUMN IF EXISTS "prize_rules";
--   ALTER TABLE "game_gifts" DROP COLUMN IF EXISTS "prize_type";
--   ALTER TABLE "game_gifts" DROP COLUMN IF EXISTS "system_key";
--   DROP TYPE IF EXISTS "GamePrizeType";
-- Older app images ignore the new columns until the new app restarts.
--
-- Never auto-close, delete, or merge booking / game_play / catch-time gift rows.
-- Existing giftSnapshot JSON on GamePlay is left unchanged (immutable).
-- Catch-Time gifts keep NULL systemKey / prizeType / prizeRules.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'GamePrizeType'
  ) THEN
    CREATE TYPE "GamePrizeType" AS ENUM (
      'PERCENT_DISCOUNT',
      'GIFT_SERVICE',
      'SERVICE_UPGRADE'
    );
  END IF;
END $$;

ALTER TABLE "game_gifts"
ADD COLUMN IF NOT EXISTS "system_key" TEXT;

ALTER TABLE "game_gifts"
ADD COLUMN IF NOT EXISTS "prize_type" "GamePrizeType";

ALTER TABLE "game_gifts"
ADD COLUMN IF NOT EXISTS "prize_rules" JSONB;

ALTER TABLE "game_gifts"
ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "game_gifts_system_key_idx"
ON "game_gifts"("system_key");

CREATE INDEX IF NOT EXISTS "game_gifts_prize_type_idx"
ON "game_gifts"("prize_type");

-- Unique per catalog + system key. Multiple NULL system_key rows remain allowed
-- (PostgreSQL UNIQUE treats NULL as distinct) — Catch-Time gifts stay compatible.
CREATE UNIQUE INDEX IF NOT EXISTS "game_gifts_game_catalog_id_system_key_key"
ON "game_gifts"("game_catalog_id", "system_key");

COMMIT;
