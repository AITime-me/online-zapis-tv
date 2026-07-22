-- Phase 1: Appointment timing semantics marker (compatibility).
-- Does NOT rewrite ends_at (no Phase 2 backfill).
-- Version-only bumps are limited to deterministic exact already-full rows.

ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "timing_semantics_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "timing_canonical_stored_at" TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'appointments_timing_semantics_version_check'
  ) THEN
    ALTER TABLE "appointments"
      ADD CONSTRAINT "appointments_timing_semantics_version_check"
      CHECK ("timing_semantics_version" IN (1, 2));
  END IF;
END $$;

-- Exact already-full (minute-aligned, exact seconds) → version 2, ends_at unchanged
UPDATE "appointments"
SET "timing_semantics_version" = 2
WHERE "timing_semantics_version" = 1
  AND "is_manual_time_override" = false
  AND "standard_duration_minutes" IS NOT NULL
  AND "standard_duration_minutes" >= 0
  AND "ends_at" > "starts_at"
  AND COALESCE("break_after_minutes", "standard_break_after_minutes", 0) >= 0
  AND EXTRACT(SECOND FROM ("starts_at" AT TIME ZONE 'Asia/Yekaterinburg')) = 0
  AND EXTRACT(SECOND FROM ("ends_at" AT TIME ZONE 'Asia/Yekaterinburg')) = 0
  AND EXTRACT(EPOCH FROM ("ends_at" - "starts_at"))
      = (
          "standard_duration_minutes"
          + COALESCE("break_after_minutes", "standard_break_after_minutes", 0)
        ) * 60;
