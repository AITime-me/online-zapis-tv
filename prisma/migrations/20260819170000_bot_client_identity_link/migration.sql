-- CURSOR-24: Add BotClientIdentityLink for stable bot-TV identity.
-- Additive only: no backfill / no destructive migration.

CREATE TABLE "bot_client_identity_links" (
  "client_ref" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "bot_client_identity_links_pkey" PRIMARY KEY ("client_ref"),
  CONSTRAINT "bot_client_identity_links_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE CASCADE
);

CREATE INDEX "bot_client_identity_links_client_id_idx"
  ON "bot_client_identity_links" ("client_id");

