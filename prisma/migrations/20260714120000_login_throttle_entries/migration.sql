-- CreateEnum
CREATE TYPE "LoginThrottleScope" AS ENUM ('ACCOUNT', 'IP');

-- CreateTable
CREATE TABLE "login_throttle_entries" (
    "id" UUID NOT NULL,
    "scope" "LoginThrottleScope" NOT NULL,
    "key_hash" VARCHAR(64) NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ NOT NULL,
    "blocked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "login_throttle_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "login_throttle_entries_scope_key_hash_key" ON "login_throttle_entries"("scope", "key_hash");

-- CreateIndex
CREATE INDEX "login_throttle_entries_blocked_until_idx" ON "login_throttle_entries"("blocked_until");

-- CreateIndex
CREATE INDEX "login_throttle_entries_window_started_at_idx" ON "login_throttle_entries"("window_started_at");
