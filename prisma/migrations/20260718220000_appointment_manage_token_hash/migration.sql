-- Phase A / EXPAND: manage-link token hash column + backfill.
-- Does NOT drop legacy plaintext `manage_token`.
--
-- Correct production order (production-deploy.sh):
--   backup → build images → prisma migrate deploy (this file) → restart app container
-- Therefore this expand migration runs BEFORE the Phase A app starts.
--
-- Compatibility matrix after THIS migration alone (before/with Phase A app):
--   - Pre-hash app image: continues to read/write only manage_token (ignores new column).
--   - Phase A app: dual-read (hash then plaintext) + dual-write (both columns).
--   - Rollback after Phase A created a booking: old image still finds row via manage_token
--     because Phase A dual-writes plaintext.
--
-- Phase B / CONTRACT (separate future release — NOT this migration):
--   1. Deploy hash-capable Phase A as the rollback baseline.
--   2. Switch writers to hash-only.
--   3. After verification, stop plaintext dual-read; then DROP manage_token.
--
-- pgcrypto:
--   CREATE EXTENSION IF NOT EXISTS pgcrypto requires permission to create extensions
--   (typically superuser / rds_superuser / azure_pg_admin, or extension already installed).
--   Production already applied legal migration that uses pgcrypto; if digest() is available
--   this statement is a no-op. If CREATE EXTENSION fails, install pgcrypto with a privileged
--   role before migrate deploy — do not skip the backfill.
--
-- Backfill never SELECTs or logs raw manage_token values to the client.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "appointments"
ADD COLUMN IF NOT EXISTS "manage_token_hash" TEXT;

-- Backfill hash from legacy plaintext (UTF-8 bytes via pgcrypto digest).
UPDATE "appointments"
SET "manage_token_hash" = encode(digest("manage_token", 'sha256'), 'hex')
WHERE "manage_token" IS NOT NULL
  AND "manage_token" <> ''
  AND ("manage_token_hash" IS NULL OR "manage_token_hash" = '');

-- Unique index (multiple NULLs allowed). Matches Prisma @unique naming.
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_manage_token_hash_key"
ON "appointments"("manage_token_hash");
