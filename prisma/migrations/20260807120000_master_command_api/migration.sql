-- CURSOR-26: Master Command API — schedule resource provenance (ownership).
-- Additive only; existing rows default to ADMIN_UI (not master-deletable via bot).

CREATE TYPE "ScheduleResourceOrigin" AS ENUM ('ADMIN_UI', 'BOT_MASTER_COMMAND');

ALTER TABLE "schedule_blocks"
  ADD COLUMN "origin" "ScheduleResourceOrigin" NOT NULL DEFAULT 'ADMIN_UI';

ALTER TABLE "extra_work_windows"
  ADD COLUMN "origin" "ScheduleResourceOrigin" NOT NULL DEFAULT 'ADMIN_UI';

CREATE INDEX "schedule_blocks_master_origin_idx"
  ON "schedule_blocks" ("master_id", "origin");

CREATE INDEX "extra_work_windows_master_origin_idx"
  ON "extra_work_windows" ("master_id", "origin");
