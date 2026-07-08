-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('GIFT', 'SEASONAL', 'GAME', 'BUNDLE', 'CONSULTATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PromotionSource" AS ENUM ('MANUAL', 'GAME', 'VK', 'BOT', 'SEASONAL');

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "short_description" TEXT,
    "description" TEXT,
    "type" "PromotionType" NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "gift_title" TEXT,
    "gift_description" TEXT,
    "conditions" TEXT,
    "cta_text" TEXT,
    "cta_link" TEXT,
    "image_url" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "source" "PromotionSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_services" (
    "promotion_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,

    CONSTRAINT "promotion_services_pkey" PRIMARY KEY ("promotion_id","service_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promotions_slug_key" ON "promotions"("slug");

-- CreateIndex
CREATE INDEX "promotions_status_is_active_idx" ON "promotions"("status", "is_active");

-- CreateIndex
CREATE INDEX "promotions_priority_idx" ON "promotions"("priority");

-- CreateIndex
CREATE INDEX "promotions_starts_at_idx" ON "promotions"("starts_at");

-- CreateIndex
CREATE INDEX "promotions_ends_at_idx" ON "promotions"("ends_at");

-- AddForeignKey
ALTER TABLE "promotion_services" ADD CONSTRAINT "promotion_services_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_services" ADD CONSTRAINT "promotion_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
