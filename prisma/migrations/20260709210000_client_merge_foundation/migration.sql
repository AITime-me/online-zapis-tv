-- AlterTable
ALTER TABLE "clients" ADD COLUMN "merged_into_client_id" UUID,
ADD COLUMN "merged_at" TIMESTAMPTZ,
ADD COLUMN "merged_by_user_id" UUID,
ADD COLUMN "merge_note" TEXT;

-- CreateIndex
CREATE INDEX "clients_merged_into_client_id_idx" ON "clients"("merged_into_client_id");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_merged_into_client_id_fkey" FOREIGN KEY ("merged_into_client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_merged_by_user_id_fkey" FOREIGN KEY ("merged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "client_merge_logs" (
    "id" TEXT NOT NULL,
    "target_client_id" UUID NOT NULL,
    "source_client_ids" JSONB NOT NULL,
    "merged_by_user_id" UUID,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_merge_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_merge_logs_target_client_id_created_at_idx" ON "client_merge_logs"("target_client_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "client_merge_logs" ADD CONSTRAINT "client_merge_logs_target_client_id_fkey" FOREIGN KEY ("target_client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_merge_logs" ADD CONSTRAINT "client_merge_logs_merged_by_user_id_fkey" FOREIGN KEY ("merged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
