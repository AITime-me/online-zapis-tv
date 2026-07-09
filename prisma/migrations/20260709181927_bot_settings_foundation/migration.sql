-- CreateTable
CREATE TABLE "bot_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'OFF',
    "provider" TEXT NOT NULL DEFAULT 'YANDEX',
    "response_mode" TEXT NOT NULL DEFAULT 'HINTS_ONLY',
    "channels" JSONB NOT NULL DEFAULT '{"siteWidget":false,"vk":false,"max":false,"telegram":false}',
    "main_instruction" TEXT,
    "knowledge_base_note" TEXT,
    "handoff_rules" TEXT,
    "tagging_rules" TEXT,
    "safety_rules" TEXT,
    "max_messages_per_client" INTEGER NOT NULL DEFAULT 20,
    "max_daily_messages" INTEGER NOT NULL DEFAULT 200,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bot_settings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "bot_settings" ADD CONSTRAINT "bot_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
