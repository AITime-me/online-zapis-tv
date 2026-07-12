-- Security Game Platform: additive schema for sessions, idempotency, catalog scope.
-- Partial unique index game_catalog_one_primary_public_idx is intentionally migration-only
-- (Prisma schema cannot express PostgreSQL partial unique indexes).

-- CreateEnum
CREATE TYPE "GameSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CONSUMED', 'EXPIRED');

-- AlterTable
ALTER TABLE "booking_requests" ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "idempotency_payload_hash" VARCHAR(64);

-- AlterTable
ALTER TABLE "game_catalog" ADD COLUMN     "active_from" TIMESTAMPTZ,
ADD COLUMN     "active_to" TIMESTAMPTZ,
ADD COLUMN     "campaign_key" TEXT,
ADD COLUMN     "is_primary_public" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "public_priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rules_version" TEXT NOT NULL DEFAULT '1';

-- AlterTable
ALTER TABLE "game_gifts" ADD COLUMN     "game_catalog_id" UUID;

-- AlterTable
ALTER TABLE "game_plays" ADD COLUMN     "campaign_key" TEXT,
ADD COLUMN     "client_metrics" JSONB,
ADD COLUMN     "completed_at" TIMESTAMPTZ,
ADD COLUMN     "consumed_at" TIMESTAMPTZ,
ADD COLUMN     "game_catalog_id" UUID,
ADD COLUMN     "game_session_id" UUID,
ADD COLUMN     "gift_snapshot" JSONB,
ADD COLUMN     "rules_snapshot" JSONB,
ADD COLUMN     "rules_version" TEXT,
ADD COLUMN     "server_result_tier" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" UUID NOT NULL,
    "game_catalog_id" UUID NOT NULL,
    "token_hash" VARCHAR(64),
    "browser_visitor_hash" VARCHAR(64),
    "status" "GameSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "play_expires_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "claim_expires_at" TIMESTAMPTZ,
    "consumed_at" TIMESTAMPTZ,
    "server_assignment" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_sessions_token_hash_key" ON "game_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "game_sessions_game_catalog_id_status_idx" ON "game_sessions"("game_catalog_id", "status");

-- CreateIndex
CREATE INDEX "game_sessions_status_play_expires_at_idx" ON "game_sessions"("status", "play_expires_at");

-- CreateIndex
CREATE INDEX "game_sessions_status_claim_expires_at_idx" ON "game_sessions"("status", "claim_expires_at");

-- CreateIndex
CREATE INDEX "game_sessions_browser_visitor_hash_game_catalog_id_started__idx" ON "game_sessions"("browser_visitor_hash", "game_catalog_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_requests_idempotency_key_key" ON "booking_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "game_catalog_status_is_primary_public_public_priority_idx" ON "game_catalog"("status", "is_primary_public", "public_priority");

-- CreateIndex
CREATE INDEX "game_gifts_game_catalog_id_idx" ON "game_gifts"("game_catalog_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_plays_game_session_id_key" ON "game_plays"("game_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_plays_lead_id_key" ON "game_plays"("lead_id");

-- CreateIndex
CREATE INDEX "game_plays_game_catalog_id_idx" ON "game_plays"("game_catalog_id");

-- CreateIndex
CREATE INDEX "game_plays_consumed_at_idx" ON "game_plays"("consumed_at");

-- AddForeignKey
ALTER TABLE "game_gifts" ADD CONSTRAINT "game_gifts_game_catalog_id_fkey" FOREIGN KEY ("game_catalog_id") REFERENCES "game_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_plays" ADD CONSTRAINT "game_plays_game_catalog_id_fkey" FOREIGN KEY ("game_catalog_id") REFERENCES "game_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_plays" ADD CONSTRAINT "game_plays_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_plays" ADD CONSTRAINT "game_plays_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "booking_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_game_catalog_id_fkey" FOREIGN KEY ("game_catalog_id") REFERENCES "game_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: primary public catalog for active procedure-gift (idempotent).
UPDATE "game_catalog"
SET "is_primary_public" = true
WHERE "slug" = 'procedure-gift'
  AND "status" = 'ACTIVE'
  AND "is_primary_public" = false;

-- Partial unique: at most one primary public game catalog row.
CREATE UNIQUE INDEX "game_catalog_one_primary_public_idx"
ON "game_catalog" ("is_primary_public")
WHERE "is_primary_public" = true;

-- Backfill: legacy GamePlay catalog scope (idempotent).
UPDATE "game_plays" AS gp
SET "game_catalog_id" = gc."id"
FROM "game_catalog" AS gc
WHERE gc."slug" = 'procedure-gift'
  AND gp."game_catalog_id" IS NULL;

-- Backfill: legacy completed timestamp (idempotent).
UPDATE "game_plays"
SET "completed_at" = "created_at"
WHERE "completed_at" IS NULL;

-- Backfill: legacy consumed timestamp from linked booking (idempotent).
UPDATE "game_plays" AS gp
SET "consumed_at" = br."created_at"
FROM "booking_requests" AS br
WHERE gp."lead_id" IS NOT NULL
  AND gp."lead_id" = br."id"
  AND gp."consumed_at" IS NULL;

-- Backfill: legacy gifts scoped to procedure-gift catalog (idempotent).
UPDATE "game_gifts" AS gg
SET "game_catalog_id" = gc."id"
FROM "game_catalog" AS gc
WHERE gc."slug" = 'procedure-gift'
  AND gg."game_catalog_id" IS NULL;
