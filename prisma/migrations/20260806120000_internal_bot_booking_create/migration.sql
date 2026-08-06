-- CURSOR-24: bot confirmed booking idempotency + LegalAcceptanceSource.BOT
-- Compatible with existing rows (additive only).

ALTER TYPE "LegalAcceptanceSource" ADD VALUE 'BOT';

CREATE TYPE "InternalBotBookingOperationState" AS ENUM (
  'IN_PROGRESS',
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'FAILED_FINAL'
);

CREATE TABLE "internal_bot_booking_operations" (
  "id" UUID NOT NULL,
  "operation_kind" VARCHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(36) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "state" "InternalBotBookingOperationState" NOT NULL,
  "lease_owner" VARCHAR(64),
  "lease_expires_at" TIMESTAMPTZ,
  "attempt_count" INTEGER NOT NULL DEFAULT 1,
  "result_snapshot" JSONB,
  "failure_code" VARCHAR(64),
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "internal_bot_booking_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "internal_bot_booking_ops_kind_key_uidx"
  ON "internal_bot_booking_operations" ("operation_kind", "idempotency_key");

CREATE INDEX "internal_bot_booking_ops_expires_at_idx"
  ON "internal_bot_booking_operations" ("expires_at");

CREATE INDEX "internal_bot_booking_ops_state_lease_idx"
  ON "internal_bot_booking_operations" ("state", "lease_expires_at");
