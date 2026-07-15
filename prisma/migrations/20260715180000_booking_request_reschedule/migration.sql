-- AlterEnum
ALTER TYPE "BookingRequestType" ADD VALUE 'RESCHEDULE_REQUEST';

-- AlterTable
ALTER TABLE "booking_requests" ADD COLUMN "appointment_id" UUID;

-- CreateIndex
CREATE INDEX "booking_requests_appointment_id_idx" ON "booking_requests"("appointment_id");

-- AddForeignKey
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
