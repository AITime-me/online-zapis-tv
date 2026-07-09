-- CreateEnum
CREATE TYPE "ClientDuplicateReviewStatus" AS ENUM ('REVIEW', 'NOT_DUPLICATE', 'POSTPONED');

-- CreateTable
CREATE TABLE "client_duplicate_reviews" (
    "id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "ClientDuplicateReviewStatus" NOT NULL DEFAULT 'REVIEW',
    "note" TEXT,
    "reviewed_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "client_duplicate_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_duplicate_reviews_fingerprint_key" ON "client_duplicate_reviews"("fingerprint");

-- CreateIndex
CREATE INDEX "client_duplicate_reviews_status_idx" ON "client_duplicate_reviews"("status");

-- AddForeignKey
ALTER TABLE "client_duplicate_reviews" ADD CONSTRAINT "client_duplicate_reviews_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
