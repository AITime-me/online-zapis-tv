-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "manage_token" TEXT;
ALTER TABLE "appointments" ADD COLUMN "cancelled_by" TEXT;
ALTER TABLE "appointments" ADD COLUMN "cancel_reason" TEXT;
ALTER TABLE "appointments" ADD COLUMN "reschedule_request_text" TEXT;
ALTER TABLE "appointments" ADD COLUMN "reschedule_requested_at" TIMESTAMPTZ;

-- CreateIndex
CREATE UNIQUE INDEX "appointments_manage_token_key" ON "appointments"("manage_token");
