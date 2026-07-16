-- CreateEnum
CREATE TYPE "CommSendMode" AS ENUM ('UNSPECIFIED', 'NOW', 'SCHEDULED');

-- AlterTable
ALTER TABLE "communication_settings"
ADD COLUMN "worker_ready" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "test_contact_id" UUID;

-- CreateTable
CREATE TABLE "communication_media_assets" (
    "id" UUID NOT NULL,
    "mime_type" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "checksum_sha256" VARCHAR(64) NOT NULL,
    "data" BYTEA NOT NULL,
    "original_file_name" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "communication_media_assets_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "communication_campaigns"
ADD COLUMN "media_asset_id" UUID,
ADD COLUMN "send_mode" "CommSendMode" NOT NULL DEFAULT 'UNSPECIFIED',
ADD COLUMN "schedule_timezone" TEXT NOT NULL DEFAULT 'Asia/Yekaterinburg',
ADD COLUMN "recipient_snapshot_at" TIMESTAMPTZ,
ADD COLUMN "content_locked_at" TIMESTAMPTZ,
ALTER COLUMN "attribution_window_hours" SET DEFAULT 168;

-- CreateTable
CREATE TABLE "communication_delivery_attempts" (
    "id" UUID NOT NULL,
    "campaign_id" UUID,
    "contact_id" UUID,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "error_code" TEXT,
    "external_message_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "communication_media_assets_created_at_idx" ON "communication_media_assets"("created_at");

-- CreateIndex
CREATE INDEX "communication_campaigns_media_asset_id_idx" ON "communication_campaigns"("media_asset_id");

-- CreateIndex
CREATE INDEX "communication_delivery_attempts_campaign_id_is_test_created_at_idx" ON "communication_delivery_attempts"("campaign_id", "is_test", "created_at" DESC);

-- CreateIndex
CREATE INDEX "communication_delivery_attempts_is_test_created_at_idx" ON "communication_delivery_attempts"("is_test", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "communication_settings" ADD CONSTRAINT "communication_settings_test_contact_id_fkey" FOREIGN KEY ("test_contact_id") REFERENCES "communication_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "communication_media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_delivery_attempts" ADD CONSTRAINT "communication_delivery_attempts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "communication_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_delivery_attempts" ADD CONSTRAINT "communication_delivery_attempts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "communication_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
