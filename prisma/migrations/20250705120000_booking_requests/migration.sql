-- CreateEnum
CREATE TYPE "BookingRequestStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BookingRequestType" AS ENUM ('MANAGER_REQUEST', 'CONSULTATION_REQUEST');

-- CreateEnum
CREATE TYPE "BookingRequestSource" AS ENUM ('ONLINE');

-- CreateTable
CREATE TABLE "booking_requests" (
    "id" UUID NOT NULL,
    "client_name" TEXT NOT NULL,
    "client_phone" TEXT NOT NULL,
    "comment" TEXT,
    "master_id" UUID,
    "status" "BookingRequestStatus" NOT NULL DEFAULT 'NEW',
    "source" "BookingRequestSource" NOT NULL DEFAULT 'ONLINE',
    "type" "BookingRequestType" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "booking_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_requests_status_created_at_idx" ON "booking_requests"("status", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Disable direct online booking for Elena Pravich
UPDATE "masters"
SET "is_online_booking_enabled" = false
WHERE "public_name" ILIKE '%Правич%'
   OR "internal_name" ILIKE '%Правич%';
