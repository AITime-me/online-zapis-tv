-- AlterTable
ALTER TABLE "extra_work_windows" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "master_services" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_synonyms" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "game_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL DEFAULT 'Поймай своё время',
    "description" TEXT NOT NULL DEFAULT '',
    "image" TEXT,
    "result_header_text" TEXT NOT NULL DEFAULT 'Ваш результат готов ✨',
    "direction_label_text" TEXT NOT NULL DEFAULT 'Ваше направление ухода:',
    "gift_label_text" TEXT NOT NULL DEFAULT 'Ваш подарок:',
    "cta_button_text" TEXT NOT NULL DEFAULT 'Получить подарок и записаться',
    "manager_message_header" TEXT NOT NULL DEFAULT 'Здравствуйте!

Я прошла игру «Поймай своё время».',
    "manager_message_footer" TEXT NOT NULL DEFAULT 'Хочу узнать условия получения подарка и записаться.',
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "game_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_gifts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "short_description" TEXT NOT NULL,
    "image" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "priority" TEXT NOT NULL DEFAULT 'standard',
    "card_style" TEXT NOT NULL DEFAULT 'default',
    "allowed_game_directions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_result_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required_premium_level" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "game_gifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_plays" (
    "id" UUID NOT NULL,
    "game_direction" TEXT NOT NULL,
    "skin_need" TEXT NOT NULL,
    "result_type" TEXT NOT NULL,
    "premium_level" INTEGER NOT NULL DEFAULT 0,
    "selected_gift_id" UUID,
    "lead_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_plays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_gifts_is_active_idx" ON "game_gifts"("is_active");

-- CreateIndex
CREATE INDEX "game_gifts_probability_idx" ON "game_gifts"("probability");

-- CreateIndex
CREATE INDEX "game_plays_created_at_idx" ON "game_plays"("created_at");

-- CreateIndex
CREATE INDEX "game_plays_game_direction_idx" ON "game_plays"("game_direction");

-- CreateIndex
CREATE INDEX "game_plays_result_type_idx" ON "game_plays"("result_type");

-- CreateIndex
CREATE INDEX "game_plays_selected_gift_id_idx" ON "game_plays"("selected_gift_id");

-- AddForeignKey
ALTER TABLE "game_plays" ADD CONSTRAINT "game_plays_selected_gift_id_fkey" FOREIGN KEY ("selected_gift_id") REFERENCES "game_gifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
