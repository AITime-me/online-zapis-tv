-- Add enum values for schedule block types
ALTER TYPE "ScheduleBlockType" ADD VALUE IF NOT EXISTS 'SICK_LEAVE';
ALTER TYPE "ScheduleBlockType" ADD VALUE IF NOT EXISTS 'LUNCH';

-- Add full-day support columns
ALTER TABLE "schedule_blocks"
  ADD COLUMN IF NOT EXISTS "block_date" DATE,
  ADD COLUMN IF NOT EXISTS "is_full_day" BOOLEAN NOT NULL DEFAULT false;

-- Backfill block_date from starts_at for existing rows
UPDATE "schedule_blocks"
SET "block_date" = ("starts_at" AT TIME ZONE 'Asia/Yekaterinburg')::date
WHERE "block_date" IS NULL AND "starts_at" IS NOT NULL;

-- Make starts_at / ends_at nullable for full-day blocks
ALTER TABLE "schedule_blocks"
  ALTER COLUMN "starts_at" DROP NOT NULL,
  ALTER COLUMN "ends_at" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "schedule_blocks_master_id_block_date_idx"
  ON "schedule_blocks"("master_id", "block_date");
