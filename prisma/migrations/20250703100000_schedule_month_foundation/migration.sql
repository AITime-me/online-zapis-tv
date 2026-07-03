-- AlterTable: appointment timing fields
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "service_duration_minutes" INTEGER,
ADD COLUMN IF NOT EXISTS "break_after_minutes" INTEGER,
ADD COLUMN IF NOT EXISTS "standard_duration_minutes" INTEGER,
ADD COLUMN IF NOT EXISTS "standard_break_after_minutes" INTEGER,
ADD COLUMN IF NOT EXISTS "is_manual_time_override" BOOLEAN NOT NULL DEFAULT false;

-- Backfill appointment timing from linked services
UPDATE "appointments" AS a
SET
  "standard_duration_minutes" = s."duration_minutes",
  "standard_break_after_minutes" = s."break_after_minutes",
  "service_duration_minutes" = s."duration_minutes",
  "break_after_minutes" = s."break_after_minutes"
FROM "services" AS s
WHERE a."service_id" = s."id";

UPDATE "appointments" AS a
SET
  "service_duration_minutes" = COALESCE(ms."duration_minutes_override", a."service_duration_minutes"),
  "break_after_minutes" = COALESCE(ms."break_after_minutes_override", a."break_after_minutes")
FROM "master_services" AS ms
WHERE a."master_id" = ms."master_id"
  AND a."service_id" = ms."service_id";

-- CreateTable: extra_work_windows
CREATE TABLE IF NOT EXISTS "extra_work_windows" (
    "id" UUID NOT NULL,
    "master_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "is_online_booking_enabled" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extra_work_windows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "extra_work_windows_master_id_work_date_idx" ON "extra_work_windows"("master_id", "work_date");
CREATE INDEX IF NOT EXISTS "extra_work_windows_starts_at_idx" ON "extra_work_windows"("starts_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'extra_work_windows_master_id_fkey'
  ) THEN
    ALTER TABLE "extra_work_windows" ADD CONSTRAINT "extra_work_windows_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'extra_work_windows_created_by_user_id_fkey'
  ) THEN
    ALTER TABLE "extra_work_windows" ADD CONSTRAINT "extra_work_windows_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
