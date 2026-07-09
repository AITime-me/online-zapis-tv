-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('NEW', 'ACTIVE', 'INACTIVE', 'BLOCKED');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "client_id" UUID;
ALTER TABLE "booking_requests" ADD COLUMN "client_id" UUID;

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "birth_date" DATE,
    "gender" TEXT,
    "source" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "loyalty_level" TEXT,
    "bonus_balance" INTEGER NOT NULL DEFAULT 0,
    "total_spent" INTEGER NOT NULL DEFAULT 0,
    "last_visit_at" TIMESTAMPTZ,
    "last_contact_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_client_id_idx" ON "appointments"("client_id");
CREATE INDEX "booking_requests_client_id_idx" ON "booking_requests"("client_id");
CREATE INDEX "clients_status_is_archived_idx" ON "clients"("status", "is_archived");
CREATE INDEX "clients_phone_idx" ON "clients"("phone");
CREATE INDEX "clients_email_idx" ON "clients"("email");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
