-- AlterTable
ALTER TABLE "clients" ADD COLUMN "normalized_phone" TEXT;

-- CreateIndex
CREATE INDEX "clients_normalized_phone_idx" ON "clients"("normalized_phone");
