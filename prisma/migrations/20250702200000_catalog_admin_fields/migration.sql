-- Masters: rename display_name -> internal_name/public_name
ALTER TABLE "masters" ADD COLUMN "internal_name" TEXT;
ALTER TABLE "masters" ADD COLUMN "public_name" TEXT;
ALTER TABLE "masters" ADD COLUMN "client_description" TEXT;
ALTER TABLE "masters" ADD COLUMN "photo_url" TEXT;
ALTER TABLE "masters" ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "masters" ADD COLUMN "is_online_booking_enabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "masters" SET "internal_name" = "display_name", "public_name" = "display_name" WHERE "internal_name" IS NULL;

ALTER TABLE "masters" ALTER COLUMN "internal_name" SET NOT NULL;
ALTER TABLE "masters" ALTER COLUMN "public_name" SET NOT NULL;
ALTER TABLE "masters" DROP COLUMN "display_name";

-- Service categories
ALTER TABLE "service_categories" ADD COLUMN "description" TEXT;
ALTER TABLE "service_categories" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "service_categories" ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT true;

-- Services: rename name -> internal_name/public_name
ALTER TABLE "services" ADD COLUMN "internal_name" TEXT;
ALTER TABLE "services" ADD COLUMN "public_name" TEXT;
ALTER TABLE "services" ADD COLUMN "client_description" TEXT;
ALTER TABLE "services" ADD COLUMN "price_from" DECIMAL(10,2);
ALTER TABLE "services" ADD COLUMN "price_to" DECIMAL(10,2);
ALTER TABLE "services" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "services" ADD COLUMN "is_online_booking_enabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "services" SET "internal_name" = "name", "public_name" = "name" WHERE "internal_name" IS NULL;

ALTER TABLE "services" ALTER COLUMN "internal_name" SET NOT NULL;
ALTER TABLE "services" ALTER COLUMN "public_name" SET NOT NULL;
ALTER TABLE "services" DROP COLUMN "name";

-- Service synonyms
ALTER TABLE "service_synonyms" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "service_synonyms" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "service_synonyms" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Master services: expand link table
ALTER TABLE "master_services" ADD COLUMN "is_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "master_services" ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "master_services" ADD COLUMN "is_online_booking_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "master_services" ADD COLUMN "duration_minutes_override" INTEGER;
ALTER TABLE "master_services" ADD COLUMN "break_after_minutes_override" INTEGER;
ALTER TABLE "master_services" ADD COLUMN "price_override" DECIMAL(10,2);
ALTER TABLE "master_services" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "master_services" ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "master_services" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Audit logs: explicit before/after values for catalog changes
ALTER TABLE "audit_logs" ADD COLUMN "previous_values" JSONB;
ALTER TABLE "audit_logs" ADD COLUMN "new_values" JSONB;

-- Prevent accidental physical deletes when entities are referenced
ALTER TABLE "service_synonyms" DROP CONSTRAINT IF EXISTS "service_synonyms_service_id_fkey";
ALTER TABLE "service_synonyms" ADD CONSTRAINT "service_synonyms_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "master_services" DROP CONSTRAINT IF EXISTS "master_services_master_id_fkey";
ALTER TABLE "master_services" ADD CONSTRAINT "master_services_master_id_fkey"
  FOREIGN KEY ("master_id") REFERENCES "masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "master_services" DROP CONSTRAINT IF EXISTS "master_services_service_id_fkey";
ALTER TABLE "master_services" ADD CONSTRAINT "master_services_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
