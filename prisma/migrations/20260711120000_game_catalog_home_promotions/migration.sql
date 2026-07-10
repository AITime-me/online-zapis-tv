-- CreateEnum
CREATE TYPE "GameCatalogType" AS ENUM ('CATCH_TIME', 'WHEEL_OF_FORTUNE');

-- CreateEnum
CREATE TYPE "GameCatalogStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "promotions" ADD COLUMN "show_on_homepage" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "promotions_show_on_homepage_status_is_active_idx" ON "promotions"("show_on_homepage", "status", "is_active");

-- CreateTable
CREATE TABLE "game_catalog" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "GameCatalogType" NOT NULL,
    "status" "GameCatalogStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "settings" JSONB,
    "external_url" TEXT,
    "legacy_config_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "game_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_catalog_slug_key" ON "game_catalog"("slug");

-- CreateIndex
CREATE INDEX "game_catalog_status_idx" ON "game_catalog"("status");

-- CreateIndex
CREATE INDEX "game_catalog_type_idx" ON "game_catalog"("type");

-- Seed existing catch-time game from legacy GameConfig (idempotent)
INSERT INTO "game_catalog" (
    "id",
    "slug",
    "title",
    "type",
    "status",
    "description",
    "legacy_config_id",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    'procedure-gift',
    COALESCE(gc."title", 'Поймай своё время'),
    'CATCH_TIME'::"GameCatalogType",
    CASE
        WHEN gc."is_active" THEN 'ACTIVE'::"GameCatalogStatus"
        ELSE 'DISABLED'::"GameCatalogStatus"
    END,
    NULLIF(gc."description", ''),
    'default',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "game_config" gc
WHERE gc."id" = 'default'
  AND NOT EXISTS (
    SELECT 1 FROM "game_catalog" existing WHERE existing."legacy_config_id" = 'default'
  );
