-- Add homepage visibility flag for GameCatalog carousel cards.
ALTER TABLE "game_catalog"
ADD COLUMN "show_on_homepage" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "game_catalog_show_on_homepage_status_idx"
ON "game_catalog"("show_on_homepage", "status");

-- Active non-legacy games are backfilled so staging wheels appear without manual toggle.
UPDATE "game_catalog"
SET "show_on_homepage" = true
WHERE "status" = 'ACTIVE'
  AND "legacy_config_id" IS NULL
  AND "show_on_homepage" = false;
