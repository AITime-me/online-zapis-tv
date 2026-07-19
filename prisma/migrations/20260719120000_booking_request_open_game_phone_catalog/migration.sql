-- EXPAND: one open game booking request per normalized phone + game catalog.

--

-- Prisma Migrate for PostgreSQL does NOT wrap migrations in a transaction by

-- default. This file uses an explicit BEGIN/COMMIT so DDL + backfill + fail-fast

-- + indexes apply atomically. All statements here are transaction-safe

-- (no CREATE INDEX CONCURRENTLY).

-- On RAISE / any error before COMMIT, PostgreSQL rolls back the whole file:

-- columns / indexes from this migration are not left half-applied.

--

-- Rollback-safe (manual ops after failed deploy image rollback):

--   DROP INDEX IF EXISTS booking_requests_open_game_phone_catalog_uidx;

--   DROP INDEX IF EXISTS booking_requests_game_catalog_id_idx;

--   DROP INDEX IF EXISTS booking_requests_client_phone_normalized_idx;

--   ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_game_catalog_id_fkey;

--   ALTER TABLE booking_requests DROP COLUMN IF EXISTS game_catalog_id;

--   ALTER TABLE booking_requests DROP COLUMN IF EXISTS client_phone_normalized;

-- Older app images ignore the new columns until the new app restarts.

--

-- REQUIRED before migrate deploy:

--   Run scripts/ops/staging-preflight-open-game-phone-catalog.sh

--   (or production-*) and ensure all four counters are 0.

-- Fail-fast checks below also abort deploy if dirty data remains.

-- Never auto-close, delete, or merge booking rows.

--

-- CONTRACT (not this migration): columns stay; partial unique is migration-only.



BEGIN;



ALTER TABLE "booking_requests"

ADD COLUMN IF NOT EXISTS "client_phone_normalized" TEXT;



ALTER TABLE "booking_requests"

ADD COLUMN IF NOT EXISTS "game_catalog_id" UUID;



-- Backfill normalized phones (same expression as ops preflight / TS normalizePhone).

UPDATE "booking_requests"

SET "client_phone_normalized" = CASE

  WHEN length(regexp_replace(coalesce("client_phone", ''), '\D', '', 'g')) = 11

    AND left(regexp_replace(coalesce("client_phone", ''), '\D', '', 'g'), 1) IN ('7', '8')

    THEN '7' || substr(regexp_replace(coalesce("client_phone", ''), '\D', '', 'g'), 2)

  WHEN length(regexp_replace(coalesce("client_phone", ''), '\D', '', 'g')) >= 10

    THEN regexp_replace(coalesce("client_phone", ''), '\D', '', 'g')

  ELSE NULL

END

WHERE "client_phone_normalized" IS NULL

  AND "client_phone" IS NOT NULL

  AND "client_phone" <> '';



-- Backfill catalog from linked game play (1:1 via lead_id).

UPDATE "booking_requests" br

SET "game_catalog_id" = gp."game_catalog_id"

FROM "game_plays" gp

WHERE gp."lead_id" = br."id"

  AND gp."game_catalog_id" IS NOT NULL

  AND (br."game_catalog_id" IS NULL OR br."game_catalog_id" IS DISTINCT FROM gp."game_catalog_id");



-- Fail-fast BEFORE unique index: never auto-close/delete/merge.

DO $$

DECLARE

  conflict_group_count int;

  conflict_row_count int;

  open_game_rows_missing_catalog_count int;

  open_game_rows_invalid_phone_count int;

BEGIN

  SELECT COUNT(*)::int, COALESCE(SUM(cnt), 0)::int

  INTO conflict_group_count, conflict_row_count

  FROM (

    SELECT COUNT(*) AS cnt

    FROM "booking_requests"

    WHERE "status" IN ('NEW', 'CONTACTED')

      AND "game_catalog_id" IS NOT NULL

      AND "client_phone_normalized" IS NOT NULL

    GROUP BY "client_phone_normalized", "game_catalog_id"

    HAVING COUNT(*) > 1

  ) conflicts;



  SELECT COUNT(*)::int

  INTO open_game_rows_missing_catalog_count

  FROM "booking_requests" br

  WHERE br."status" IN ('NEW', 'CONTACTED')

    AND EXISTS (

      SELECT 1 FROM "game_plays" gp WHERE gp."lead_id" = br."id"

    )

    AND br."game_catalog_id" IS NULL;



  SELECT COUNT(*)::int

  INTO open_game_rows_invalid_phone_count

  FROM "booking_requests" br

  WHERE br."status" IN ('NEW', 'CONTACTED')

    AND EXISTS (

      SELECT 1 FROM "game_plays" gp WHERE gp."lead_id" = br."id"

    )

    AND br."client_phone_normalized" IS NULL;



  IF conflict_group_count <> 0

     OR conflict_row_count <> 0

     OR open_game_rows_missing_catalog_count <> 0

     OR open_game_rows_invalid_phone_count <> 0 THEN

    RAISE EXCEPTION

      'open-game-phone-catalog migration blocked: conflict_group_count=%, conflict_row_count=%, open_game_rows_missing_catalog_count=%, open_game_rows_invalid_phone_count=%. Resolve duplicates/legacy rows manually, then re-run migrate. No rows were closed or deleted.',

      conflict_group_count,

      conflict_row_count,

      open_game_rows_missing_catalog_count,

      open_game_rows_invalid_phone_count;

  END IF;

END $$;



DO $$

BEGIN

  IF NOT EXISTS (

    SELECT 1

    FROM pg_constraint

    WHERE conname = 'booking_requests_game_catalog_id_fkey'

  ) THEN

    ALTER TABLE "booking_requests"

    ADD CONSTRAINT "booking_requests_game_catalog_id_fkey"

    FOREIGN KEY ("game_catalog_id") REFERENCES "game_catalog"("id")

    ON DELETE SET NULL

    ON UPDATE CASCADE;

  END IF;

END $$;



CREATE INDEX IF NOT EXISTS "booking_requests_client_phone_normalized_idx"

ON "booking_requests"("client_phone_normalized");



CREATE INDEX IF NOT EXISTS "booking_requests_game_catalog_id_idx"

ON "booking_requests"("game_catalog_id");



-- Enforce: at most one OPEN game lead per phone+catalog.

CREATE UNIQUE INDEX IF NOT EXISTS "booking_requests_open_game_phone_catalog_uidx"

ON "booking_requests" ("client_phone_normalized", "game_catalog_id")

WHERE "status" IN ('NEW', 'CONTACTED')

  AND "game_catalog_id" IS NOT NULL

  AND "client_phone_normalized" IS NOT NULL;



COMMIT;
