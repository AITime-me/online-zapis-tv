-- Managed Teя knowledge base publications (BOT-CONTROL-PLANE-03B).
-- Expand-only: no seed entries, no auto-publish, existing business data untouched.

CREATE TYPE "BotKnowledgeCategory" AS ENUM (
  'PROCEDURE_EXPLANATION',
  'FAQ',
  'PREPARATION',
  'AFTERCARE',
  'OBJECTION_HANDLING',
  'SAFETY_INFORMATION',
  'POLICY_EXPLANATION',
  'ESCALATION_GUIDANCE'
);

CREATE TYPE "BotKnowledgePublicationStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

CREATE TABLE "bot_knowledge_workspace" (
    "id" TEXT NOT NULL,
    "active_publication_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_knowledge_workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bot_knowledge_entries" (
    "id" UUID NOT NULL,
    "stable_key" VARCHAR(120) NOT NULL,
    "category" "BotKnowledgeCategory" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "service_id" UUID,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_knowledge_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bot_knowledge_publications" (
    "id" UUID NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "BotKnowledgePublicationStatus" NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "payload_checksum" VARCHAR(64) NOT NULL,
    "published_at" TIMESTAMPTZ NOT NULL,
    "published_by_user_id" UUID,
    "superseded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_knowledge_publications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_knowledge_entries_stable_key_key"
  ON "bot_knowledge_entries"("stable_key");

CREATE INDEX "bot_knowledge_entries_category_is_enabled_idx"
  ON "bot_knowledge_entries"("category", "is_enabled");

CREATE INDEX "bot_knowledge_entries_service_id_idx"
  ON "bot_knowledge_entries"("service_id");

CREATE UNIQUE INDEX "bot_knowledge_publications_workspace_id_version_number_key"
  ON "bot_knowledge_publications"("workspace_id", "version_number");

CREATE INDEX "bot_knowledge_publications_workspace_id_status_idx"
  ON "bot_knowledge_publications"("workspace_id", "status");

CREATE UNIQUE INDEX "bot_knowledge_publications_one_active_per_workspace"
  ON "bot_knowledge_publications"("workspace_id")
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "bot_knowledge_workspace_active_publication_id_key"
  ON "bot_knowledge_workspace"("active_publication_id");

ALTER TABLE "bot_knowledge_entries"
  ADD CONSTRAINT "bot_knowledge_entries_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bot_knowledge_entries"
  ADD CONSTRAINT "bot_knowledge_entries_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bot_knowledge_entries"
  ADD CONSTRAINT "bot_knowledge_entries_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bot_knowledge_publications"
  ADD CONSTRAINT "bot_knowledge_publications_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "bot_knowledge_workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bot_knowledge_publications"
  ADD CONSTRAINT "bot_knowledge_publications_published_by_user_id_fkey"
  FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bot_knowledge_workspace"
  ADD CONSTRAINT "bot_knowledge_workspace_active_publication_id_fkey"
  FOREIGN KEY ("active_publication_id") REFERENCES "bot_knowledge_publications"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
