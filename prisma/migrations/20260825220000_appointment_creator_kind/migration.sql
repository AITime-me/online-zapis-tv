-- Additive creator provenance for appointments (TEYA analytics A1).
-- NULL means legacy / unproven — no destructive backfill.

CREATE TYPE "AppointmentCreatorKind" AS ENUM (
  'SELF_SERVICE',
  'TEYA',
  'MANAGER',
  'MASTER',
  'OTHER'
);

ALTER TABLE "appointments"
ADD COLUMN "creator_kind" "AppointmentCreatorKind";
