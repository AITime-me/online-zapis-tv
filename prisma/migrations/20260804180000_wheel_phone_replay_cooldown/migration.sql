-- EXPAND: Replace lifetime phone+campaign unique index with 14-day replay cooldown lookup.
--
-- Drops only game_sessions_catalog_campaign_phone_hash_uidx.
-- Does NOT modify token_hash unique, Catch-Time NULL rows, or existing session data.
--
-- Prisma Migrate for PostgreSQL does NOT wrap migrations in a transaction by
-- default. This file uses an explicit BEGIN/COMMIT so DDL applies atomically.
--
-- Rollback-safe (manual ops after failed deploy image rollback):
--   DROP INDEX IF EXISTS "game_sessions_catalog_campaign_phone_started_idx";
--   CREATE UNIQUE INDEX IF NOT EXISTS "game_sessions_catalog_campaign_phone_hash_uidx"
--   ON "game_sessions" (
--     "game_catalog_id",
--     "campaign_key_snapshot",
--     "participant_phone_hash"
--   )
--   WHERE "participant_phone_hash" IS NOT NULL
--     AND "campaign_key_snapshot" IS NOT NULL;

BEGIN;

DROP INDEX IF EXISTS "game_sessions_catalog_campaign_phone_hash_uidx";

CREATE INDEX IF NOT EXISTS "game_sessions_catalog_campaign_phone_started_idx"
ON "game_sessions" (
  "game_catalog_id",
  "campaign_key_snapshot",
  "participant_phone_hash",
  "started_at" DESC
)
WHERE "participant_phone_hash" IS NOT NULL
  AND "campaign_key_snapshot" IS NOT NULL;

COMMIT;
