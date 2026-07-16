-- CreateEnum
CREATE TYPE "CommChannel" AS ENUM ('VK');

-- CreateEnum
CREATE TYPE "CommContactSource" AS ENUM ('SALEBOT_IMPORT', 'VK_WEBHOOK', 'MANUAL');

-- CreateEnum
CREATE TYPE "CommDeliveryStatus" AS ENUM ('UNKNOWN', 'ALLOWED', 'DENIED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CommConsentStatus" AS ENUM ('UNKNOWN', 'CONFIRMED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CommCampaignStatus" AS ENUM ('DRAFT', 'READY', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommButtonType" AS ENUM ('REPLY_TEXT', 'CALLBACK', 'OPEN_LINK', 'UNSUBSCRIBE');

-- CreateEnum
CREATE TYPE "CommButtonStyle" AS ENUM ('PRIMARY', 'POSITIVE', 'NEGATIVE', 'SECONDARY');

-- CreateEnum
CREATE TYPE "CommEventType" AS ENUM ('IMPORTED', 'EXCLUDED', 'QUEUED', 'ACCEPTED_BY_CHANNEL', 'SEND_ERROR', 'READ_CONFIRMED', 'BUTTON_CLICKED', 'LINK_OPENED', 'REPLY_RECEIVED', 'UNSUBSCRIBED', 'LEAD_CREATED', 'APPOINTMENT_CREATED');

-- CreateEnum
CREATE TYPE "CommImportJobStatus" AS ENUM ('PREVIEWED', 'APPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "communication_settings" (
    "id" TEXT NOT NULL,
    "vk_connector_ready" BOOLEAN NOT NULL DEFAULT false,
    "default_community_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "communication_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_contacts" (
    "id" UUID NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "community_id" TEXT NOT NULL,
    "channel_user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "client_id" UUID,
    "source" "CommContactSource" NOT NULL,
    "first_interaction_at" TIMESTAMPTZ,
    "last_interaction_at" TIMESTAMPTZ,
    "last_inbound_at" TIMESTAMPTZ,
    "delivery_status" "CommDeliveryStatus" NOT NULL DEFAULT 'UNKNOWN',
    "consent_status" "CommConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "consent_source" TEXT,
    "consent_version" TEXT,
    "consent_action_at" TIMESTAMPTZ,
    "consent_action" TEXT,
    "is_unsubscribed" BOOLEAN NOT NULL DEFAULT false,
    "exclusion_reason" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "communication_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_suppressions" (
    "id" UUID NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "community_id" TEXT NOT NULL,
    "channel_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_segments" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "communication_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_campaigns" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "CommCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "segment_id" UUID,
    "message_text" TEXT NOT NULL DEFAULT '',
    "image_url" TEXT,
    "scheduled_at" TIMESTAMPTZ,
    "attribution_window_hours" INTEGER NOT NULL DEFAULT 72,
    "utm_source" TEXT NOT NULL DEFAULT 'vk',
    "utm_medium" TEXT NOT NULL DEFAULT 'messenger',
    "utm_campaign" TEXT,
    "stats" JSONB,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "communication_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_campaign_buttons" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "type" "CommButtonType" NOT NULL,
    "button_key" TEXT NOT NULL,
    "action" TEXT,
    "url" TEXT,
    "promotion_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "style" "CommButtonStyle" NOT NULL DEFAULT 'SECONDARY',

    CONSTRAINT "communication_campaign_buttons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_campaign_recipients" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "queued_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "communication_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_import_jobs" (
    "id" UUID NOT NULL,
    "status" "CommImportJobStatus" NOT NULL DEFAULT 'PREVIEWED',
    "original_file_name" TEXT,
    "file_kind" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "error_message" TEXT,
    "created_by_user_id" UUID,
    "applied_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_events" (
    "id" UUID NOT NULL,
    "type" "CommEventType" NOT NULL,
    "contact_id" UUID,
    "campaign_id" UUID,
    "recipient_id" UUID,
    "button_key" TEXT,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "communication_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_redirect_tokens" (
    "id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID,
    "button_key" TEXT NOT NULL,
    "target_path" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "first_clicked_at" TIMESTAMPTZ,
    "last_clicked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_redirect_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "communication_contacts_channel_community_id_channel_user_id_key" ON "communication_contacts"("channel", "community_id", "channel_user_id");

-- CreateIndex
CREATE INDEX "communication_contacts_source_idx" ON "communication_contacts"("source");

-- CreateIndex
CREATE INDEX "communication_contacts_delivery_status_idx" ON "communication_contacts"("delivery_status");

-- CreateIndex
CREATE INDEX "communication_contacts_consent_status_idx" ON "communication_contacts"("consent_status");

-- CreateIndex
CREATE INDEX "communication_contacts_is_unsubscribed_idx" ON "communication_contacts"("is_unsubscribed");

-- CreateIndex
CREATE INDEX "communication_contacts_client_id_idx" ON "communication_contacts"("client_id");

-- CreateIndex
CREATE INDEX "communication_contacts_last_interaction_at_idx" ON "communication_contacts"("last_interaction_at");

-- CreateIndex
CREATE UNIQUE INDEX "communication_suppressions_channel_community_id_channel_user_id_key" ON "communication_suppressions"("channel", "community_id", "channel_user_id");

-- CreateIndex
CREATE INDEX "communication_suppressions_created_at_idx" ON "communication_suppressions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "communication_segments_key_key" ON "communication_segments"("key");

-- CreateIndex
CREATE UNIQUE INDEX "communication_campaigns_slug_key" ON "communication_campaigns"("slug");

-- CreateIndex
CREATE INDEX "communication_campaigns_status_idx" ON "communication_campaigns"("status");

-- CreateIndex
CREATE INDEX "communication_campaigns_segment_id_idx" ON "communication_campaigns"("segment_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_campaign_buttons_campaign_id_button_key_key" ON "communication_campaign_buttons"("campaign_id", "button_key");

-- CreateIndex
CREATE INDEX "communication_campaign_buttons_campaign_id_sort_order_idx" ON "communication_campaign_buttons"("campaign_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "communication_campaign_recipients_campaign_id_contact_id_key" ON "communication_campaign_recipients"("campaign_id", "contact_id");

-- CreateIndex
CREATE INDEX "communication_campaign_recipients_campaign_id_status_idx" ON "communication_campaign_recipients"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "communication_import_jobs_created_at_idx" ON "communication_import_jobs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "communication_import_jobs_status_idx" ON "communication_import_jobs"("status");

-- CreateIndex
CREATE INDEX "communication_events_type_occurred_at_idx" ON "communication_events"("type", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "communication_events_campaign_id_type_idx" ON "communication_events"("campaign_id", "type");

-- CreateIndex
CREATE INDEX "communication_events_contact_id_type_idx" ON "communication_events"("contact_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "communication_redirect_tokens_token_hash_key" ON "communication_redirect_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "communication_redirect_tokens_campaign_id_button_key_idx" ON "communication_redirect_tokens"("campaign_id", "button_key");

-- CreateIndex
CREATE INDEX "communication_redirect_tokens_expires_at_idx" ON "communication_redirect_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "communication_contacts" ADD CONSTRAINT "communication_contacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "communication_segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_campaign_buttons" ADD CONSTRAINT "communication_campaign_buttons_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "communication_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_campaign_recipients" ADD CONSTRAINT "communication_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "communication_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_campaign_recipients" ADD CONSTRAINT "communication_campaign_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "communication_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_import_jobs" ADD CONSTRAINT "communication_import_jobs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_events" ADD CONSTRAINT "communication_events_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "communication_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_events" ADD CONSTRAINT "communication_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "communication_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_events" ADD CONSTRAINT "communication_events_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "communication_campaign_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_redirect_tokens" ADD CONSTRAINT "communication_redirect_tokens_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "communication_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_redirect_tokens" ADD CONSTRAINT "communication_redirect_tokens_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "communication_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
