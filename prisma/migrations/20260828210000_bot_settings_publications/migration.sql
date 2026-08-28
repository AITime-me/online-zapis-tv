-- Bot settings immutable publication snapshots (BOT-CONTROL-PLANE-02).
-- Expand-only: existing bot_settings rows are preserved; no automatic backfill publish.

CREATE TYPE "BotSettingsPublicationStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

ALTER TABLE "bot_settings"
  ADD COLUMN IF NOT EXISTS "active_publication_id" UUID;

CREATE TABLE "bot_settings_publications" (
    "id" UUID NOT NULL,
    "bot_settings_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "BotSettingsPublicationStatus" NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "payload_checksum" VARCHAR(64) NOT NULL,
    "source_updated_at" TIMESTAMPTZ NOT NULL,
    "published_at" TIMESTAMPTZ NOT NULL,
    "published_by_user_id" UUID,
    "superseded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_settings_publications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_settings_publications_bot_settings_id_version_number_key"
  ON "bot_settings_publications"("bot_settings_id", "version_number");

CREATE INDEX "bot_settings_publications_bot_settings_id_status_idx"
  ON "bot_settings_publications"("bot_settings_id", "status");

CREATE UNIQUE INDEX "bot_settings_publications_one_active_per_settings"
  ON "bot_settings_publications"("bot_settings_id")
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "bot_settings_active_publication_id_key"
  ON "bot_settings"("active_publication_id");

ALTER TABLE "bot_settings_publications"
  ADD CONSTRAINT "bot_settings_publications_bot_settings_id_fkey"
  FOREIGN KEY ("bot_settings_id") REFERENCES "bot_settings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bot_settings_publications"
  ADD CONSTRAINT "bot_settings_publications_published_by_user_id_fkey"
  FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bot_settings"
  ADD CONSTRAINT "bot_settings_active_publication_id_fkey"
  FOREIGN KEY ("active_publication_id") REFERENCES "bot_settings_publications"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
