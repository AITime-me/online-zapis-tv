-- Legal document versioning + append-only acceptance journal.
-- Existing LegalDocument rows are backfilled as immutable v1 (preserving publish status).
-- Legacy columns legal_documents.content / is_published are kept temporarily (unused by readers).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "LegalDocumentVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "LegalAcceptanceType" AS ENUM ('PERSONAL_DATA_CONSENT', 'OFFER_ACKNOWLEDGEMENT', 'MARKETING_CONSENT');
CREATE TYPE "LegalAcceptanceSource" AS ENUM ('ONLINE_BOOKING', 'MANAGER_REQUEST', 'CONSULTATION_REQUEST', 'GAME_CLAIM');

ALTER TABLE "legal_documents"
  ADD COLUMN IF NOT EXISTS "public_path" TEXT,
  ADD COLUMN IF NOT EXISTS "current_published_version_id" TEXT;

-- Ensure legacy content is non-null for new rows (existing rows already have content).
ALTER TABLE "legal_documents"
  ALTER COLUMN "content" SET DEFAULT '';

ALTER TABLE "legal_documents"
  ALTER COLUMN "is_published" SET DEFAULT false;

CREATE TABLE "legal_document_versions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "status" "LegalDocumentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,
    "created_by_user_id" UUID,

    CONSTRAINT "legal_document_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legal_document_versions_document_id_version_number_key"
  ON "legal_document_versions"("document_id", "version_number");

CREATE INDEX "legal_document_versions_document_id_status_idx"
  ON "legal_document_versions"("document_id", "status");

CREATE UNIQUE INDEX "legal_documents_current_published_version_id_key"
  ON "legal_documents"("current_published_version_id");

ALTER TABLE "legal_document_versions"
  ADD CONSTRAINT "legal_document_versions_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "legal_documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "legal_document_versions"
  ADD CONSTRAINT "legal_document_versions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill v1 from existing documents (preserve factual publish state).
INSERT INTO "legal_document_versions" (
  "id",
  "document_id",
  "version_number",
  "title",
  "content",
  "content_hash",
  "status",
  "created_at",
  "published_at"
)
SELECT
  md5('legal-v1:' || d."id") || substr(md5(d."id"), 1, 8),
  d."id",
  1,
  d."title",
  d."content",
  encode(digest(d."content", 'sha256'), 'hex'),
  CASE WHEN d."is_published" THEN 'PUBLISHED'::"LegalDocumentVersionStatus"
       ELSE 'DRAFT'::"LegalDocumentVersionStatus" END,
  d."created_at",
  CASE WHEN d."is_published" THEN d."updated_at" ELSE NULL END
FROM "legal_documents" d
WHERE NOT EXISTS (
  SELECT 1 FROM "legal_document_versions" v WHERE v."document_id" = d."id"
);

-- Point current published version for previously published docs.
UPDATE "legal_documents" d
SET "current_published_version_id" = v."id"
FROM "legal_document_versions" v
WHERE v."document_id" = d."id"
  AND v."status" = 'PUBLISHED'
  AND d."current_published_version_id" IS NULL;

ALTER TABLE "legal_documents"
  ADD CONSTRAINT "legal_documents_current_published_version_id_fkey"
  FOREIGN KEY ("current_published_version_id") REFERENCES "legal_document_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- System metadata for new documents (empty draft only; no invented legal text).
INSERT INTO "legal_documents" ("id", "slug", "title", "content", "is_published", "public_path", "created_at", "updated_at")
SELECT
  'legal_doc_promotions_game_rules',
  'promotions-game-rules',
  'Правила акций, игры и подарков',
  '',
  false,
  '/rules/promotions-game',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "legal_documents" WHERE "slug" = 'promotions-game-rules'
);

INSERT INTO "legal_documents" ("id", "slug", "title", "content", "is_published", "public_path", "created_at", "updated_at")
SELECT
  'legal_doc_marketing_consent',
  'marketing-consent',
  'Согласие на рекламные и информационные сообщения',
  '',
  false,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "legal_documents" WHERE "slug" = 'marketing-consent'
);

INSERT INTO "legal_document_versions" (
  "id", "document_id", "version_number", "title", "content", "content_hash", "status", "created_at"
)
SELECT
  'legal_ver_promotions_game_rules_v1',
  d."id",
  1,
  d."title",
  '',
  encode(digest('', 'sha256'), 'hex'),
  'DRAFT'::"LegalDocumentVersionStatus",
  CURRENT_TIMESTAMP
FROM "legal_documents" d
WHERE d."slug" = 'promotions-game-rules'
  AND NOT EXISTS (
    SELECT 1 FROM "legal_document_versions" v WHERE v."document_id" = d."id"
  );

INSERT INTO "legal_document_versions" (
  "id", "document_id", "version_number", "title", "content", "content_hash", "status", "created_at"
)
SELECT
  'legal_ver_marketing_consent_v1',
  d."id",
  1,
  d."title",
  '',
  encode(digest('', 'sha256'), 'hex'),
  'DRAFT'::"LegalDocumentVersionStatus",
  CURRENT_TIMESTAMP
FROM "legal_documents" d
WHERE d."slug" = 'marketing-consent'
  AND NOT EXISTS (
    SELECT 1 FROM "legal_document_versions" v WHERE v."document_id" = d."id"
  );

-- Set public_path for known root slugs when missing.
UPDATE "legal_documents" SET "public_path" = '/privacy' WHERE "slug" = 'privacy' AND "public_path" IS NULL;
UPDATE "legal_documents" SET "public_path" = '/consent' WHERE "slug" = 'consent' AND "public_path" IS NULL;
UPDATE "legal_documents" SET "public_path" = '/terms' WHERE "slug" = 'terms' AND "public_path" IS NULL;
UPDATE "legal_documents" SET "public_path" = '/offer' WHERE "slug" = 'offer' AND "public_path" IS NULL;
UPDATE "legal_documents" SET "public_path" = '/cookies' WHERE "slug" = 'cookies' AND "public_path" IS NULL;

CREATE TABLE "legal_acceptance_records" (
    "id" TEXT NOT NULL,
    "acceptance_type" "LegalAcceptanceType" NOT NULL,
    "document_version_id" TEXT NOT NULL,
    "document_slug" TEXT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "accepted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "LegalAcceptanceSource" NOT NULL,
    "appointment_id" UUID,
    "booking_request_id" UUID,
    "client_id" UUID,
    "game_play_id" UUID,
    "request_reference" TEXT,

    CONSTRAINT "legal_acceptance_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "legal_acceptance_records_document_version_id_idx"
  ON "legal_acceptance_records"("document_version_id");
CREATE INDEX "legal_acceptance_records_booking_request_id_idx"
  ON "legal_acceptance_records"("booking_request_id");
CREATE INDEX "legal_acceptance_records_appointment_id_idx"
  ON "legal_acceptance_records"("appointment_id");
CREATE INDEX "legal_acceptance_records_game_play_id_idx"
  ON "legal_acceptance_records"("game_play_id");
CREATE INDEX "legal_acceptance_records_accepted_at_idx"
  ON "legal_acceptance_records"("accepted_at");
CREATE INDEX "legal_acceptance_records_acceptance_type_source_idx"
  ON "legal_acceptance_records"("acceptance_type", "source");

ALTER TABLE "legal_acceptance_records"
  ADD CONSTRAINT "legal_acceptance_records_document_version_id_fkey"
  FOREIGN KEY ("document_version_id") REFERENCES "legal_document_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "legal_acceptance_records"
  ADD CONSTRAINT "legal_acceptance_records_appointment_id_fkey"
  FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legal_acceptance_records"
  ADD CONSTRAINT "legal_acceptance_records_booking_request_id_fkey"
  FOREIGN KEY ("booking_request_id") REFERENCES "booking_requests"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legal_acceptance_records"
  ADD CONSTRAINT "legal_acceptance_records_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legal_acceptance_records"
  ADD CONSTRAINT "legal_acceptance_records_game_play_id_fkey"
  FOREIGN KEY ("game_play_id") REFERENCES "game_plays"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
