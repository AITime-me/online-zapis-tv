-- AlterTable
ALTER TABLE "studio_settings" ADD COLUMN "cookie_banner_text" TEXT NOT NULL DEFAULT 'Мы используем cookie, чтобы сайт работал корректно и становился удобнее. Продолжая пользоваться сайтом, вы соглашаетесь с использованием cookie.';
ALTER TABLE "studio_settings" ADD COLUMN "cookie_details_url" TEXT NOT NULL DEFAULT '/cookies';

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_slug_key" ON "legal_documents"("slug");
