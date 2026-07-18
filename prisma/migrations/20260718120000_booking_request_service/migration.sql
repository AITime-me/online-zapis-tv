-- AlterTable
ALTER TABLE "booking_requests" ADD COLUMN "service_id" UUID;
ALTER TABLE "booking_requests" ADD COLUMN "service_name_snapshot" TEXT;

-- AddForeignKey
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "booking_requests_service_id_idx" ON "booking_requests"("service_id");
