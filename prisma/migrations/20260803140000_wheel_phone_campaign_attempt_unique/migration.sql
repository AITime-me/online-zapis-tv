-- EXPAND: Wheel of Fortune phone+campaign attempt uniqueness on GameSession.
--
-- Additive only. Catch-Time sessions keep NULL participant_phone_hash /
-- campaign_key_snapshot and are excluded from the partial unique index.
-- Existing booking_requests_open_game_phone_catalog_uidx is NOT modified.
--
-- Prisma Migrate for PostgreSQL does NOT wrap migrations in a transaction by
-- default. This file uses an explicit BEGIN/COMMIT so DDL applies atomically.
-- On RAISE / any error before COMMIT, PostgreSQL rolls back the whole file.
--
-- Rollback-safe (manual ops after failed deploy image rollback):
--   DROP INDEX IF EXISTS "game_sessions_catalog_campaign_phone_hash_uidx";
--   DROP INDEX IF EXISTS "game_sessions_participant_phone_hash_idx";
--   ALTER TABLE "game_sessions" DROP COLUMN IF EXISTS "campaign_key_snapshot";
--   ALTER TABLE "game_sessions" DROP COLUMN IF EXISTS "participant_phone_hash";
-- Older app images ignore the new columns until the new app restarts.
--
-- Never store plaintext phone on game_sessions.
-- Never auto-close, delete, or merge booking / game_play / catch-time rows.

BEGIN;

ALTER TABLE "game_sessions"
ADD COLUMN IF NOT EXISTS "participant_phone_hash" VARCHAR(64);

ALTER TABLE "game_sessions"
ADD COLUMN IF NOT EXISTS "campaign_key_snapshot" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "game_sessions_participant_phone_hash_idx"
ON "game_sessions"("participant_phone_hash");

-- One attempt per (catalog, campaign snapshot, phone hash).
-- Partial: only rows that registered a phone-bound wheel attempt.
CREATE UNIQUE INDEX IF NOT EXISTS "game_sessions_catalog_campaign_phone_hash_uidx"
ON "game_sessions" (
  "game_catalog_id",
  "campaign_key_snapshot",
  "participant_phone_hash"
)
WHERE "participant_phone_hash" IS NOT NULL
  AND "campaign_key_snapshot" IS NOT NULL;

COMMIT;
