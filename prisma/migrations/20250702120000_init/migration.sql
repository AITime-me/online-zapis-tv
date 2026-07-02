-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MANAGER', 'MASTER');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('INTERNAL', 'ONLINE', 'BOT', 'PHONE', 'OTHER');

-- CreateEnum
CREATE TYPE "ScheduleBlockType" AS ENUM ('DAY_OFF', 'VACATION', 'TRAINING', 'DO_NOT_BOOK', 'BREAK', 'PERSONAL', 'TECHNICAL');

-- CreateEnum
CREATE TYPE "EmergencyExportType" AS ENUM ('TODAY', 'TOMORROW', 'SEVEN_DAYS', 'THIRTY_DAYS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EmergencyExportStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "ExportStorage" AS ENUM ('LOCAL', 'S3');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "masters" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "display_name" TEXT NOT NULL,
    "slot_minutes" INTEGER NOT NULL DEFAULT 30,
    "work_start" TEXT NOT NULL,
    "work_end" TEXT NOT NULL,
    "break_after_minutes" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "break_after_minutes" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(10,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_synonyms" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "synonym" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_services" (
    "master_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,

    CONSTRAINT "master_services_pkey" PRIMARY KEY ("master_id","service_id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "master_id" UUID NOT NULL,
    "service_id" UUID,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "client_name" TEXT NOT NULL,
    "client_phone" TEXT NOT NULL,
    "comment" TEXT,
    "important_note" TEXT,
    "is_bold" BOOLEAN NOT NULL DEFAULT false,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "source" "AppointmentSource" NOT NULL DEFAULT 'INTERNAL',
    "promo_code" TEXT,
    "bot_session_id" TEXT,
    "created_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_blocks" (
    "id" UUID NOT NULL,
    "master_id" UUID,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "block_type" "ScheduleBlockType" NOT NULL,
    "internal_reason" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "schedule_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_notes" (
    "id" UUID NOT NULL,
    "note_date" DATE NOT NULL,
    "content" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "manager_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_links" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "service_id" UUID,
    "master_id" UUID,
    "source" TEXT,
    "promo_code" TEXT,
    "bot_session_id" TEXT,
    "expires_at" TIMESTAMPTZ,
    "is_used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_exports" (
    "id" UUID NOT NULL,
    "export_type" "EmergencyExportType" NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "file_path" TEXT,
    "storage" "ExportStorage" NOT NULL DEFAULT 'LOCAL',
    "status" "EmergencyExportStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "requested_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "emergency_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "payload_anonymized" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "masters_user_id_key" ON "masters"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_synonyms_service_id_synonym_key" ON "service_synonyms"("service_id", "synonym");

-- CreateIndex
CREATE INDEX "appointments_master_id_starts_at_ends_at_idx" ON "appointments"("master_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "appointments_starts_at_idx" ON "appointments"("starts_at");

-- CreateIndex
CREATE INDEX "schedule_blocks_master_id_starts_at_ends_at_idx" ON "schedule_blocks"("master_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "schedule_blocks_starts_at_idx" ON "schedule_blocks"("starts_at");

-- CreateIndex
CREATE INDEX "manager_notes_note_date_idx" ON "manager_notes"("note_date");

-- CreateIndex
CREATE UNIQUE INDEX "booking_links_token_key" ON "booking_links"("token");

-- CreateIndex
CREATE INDEX "emergency_exports_created_at_idx" ON "emergency_exports"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "change_events_created_at_idx" ON "change_events"("created_at");

-- AddForeignKey
ALTER TABLE "masters" ADD CONSTRAINT "masters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_synonyms" ADD CONSTRAINT "service_synonyms_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_services" ADD CONSTRAINT "master_services_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_services" ADD CONSTRAINT "master_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_notes" ADD CONSTRAINT "manager_notes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_links" ADD CONSTRAINT "booking_links_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_links" ADD CONSTRAINT "booking_links_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_exports" ADD CONSTRAINT "emergency_exports_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

