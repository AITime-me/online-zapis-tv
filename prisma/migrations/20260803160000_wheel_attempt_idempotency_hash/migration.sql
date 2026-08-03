-- EXPAND: Wheel of Fortune attemptIdHash for idempotent spin retries.
--
-- Additive only. Catch-Time sessions keep NULL attempt_id_hash.
-- Does not modify game_sessions_catalog_campaign_phone_hash_uidx
-- or booking_requests_open_game_phone_catalog_uidx.
--
-- Prisma Migrate for PostgreSQL does NOT wrap migrations in a transaction by
-- default. This file uses an explicit BEGIN/COMMIT so DDL applies atomically.
-- On RAISE / any error before COMMIT, PostgreSQL rolls back the whole file.
--
-- Rollback-safe (manual ops after failed deploy image rollback):
--   DROP INDEX IF EXISTS "game_sessions_attempt_id_hash_idx";
--   ALTER TABLE "game_sessions" DROP COLUMN IF EXISTS "attempt_id_hash";
-- Older app images ignore the new column until the new app restarts.
--
-- Never store plaintext attemptId or session bearer token.
-- Never auto-close, delete, or merge booking / game_play / catch-time rows.

BEGIN;

ALTER TABLE "game_sessions"
ADD COLUMN IF NOT EXISTS "attempt_id_hash" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "game_sessions_attempt_id_hash_idx"
ON "game_sessions"("attempt_id_hash");

COMMIT;
