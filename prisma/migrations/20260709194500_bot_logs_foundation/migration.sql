-- AlterTable
ALTER TABLE "bot_settings" ADD COLUMN "log_retention_days" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "bot_settings" ADD COLUMN "error_log_retention_days" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "bot_settings" ADD COLUMN "max_stored_bot_events" INTEGER NOT NULL DEFAULT 5000;

-- CreateTable
CREATE TABLE "bot_event_logs" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "client_id" UUID,
    "booking_request_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_event_logs_created_at_idx" ON "bot_event_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "bot_event_logs_level_idx" ON "bot_event_logs"("level");

-- CreateIndex
CREATE INDEX "bot_event_logs_type_idx" ON "bot_event_logs"("type");

-- CreateIndex
CREATE INDEX "bot_event_logs_channel_idx" ON "bot_event_logs"("channel");

-- CreateIndex
CREATE INDEX "bot_event_logs_client_id_idx" ON "bot_event_logs"("client_id");

-- CreateIndex
CREATE INDEX "bot_event_logs_booking_request_id_idx" ON "bot_event_logs"("booking_request_id");

-- AddForeignKey
ALTER TABLE "bot_event_logs" ADD CONSTRAINT "bot_event_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_event_logs" ADD CONSTRAINT "bot_event_logs_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "booking_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
