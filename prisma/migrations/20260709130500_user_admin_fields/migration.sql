-- AlterTable
ALTER TABLE "users" ADD COLUMN "phone" TEXT;
ALTER TABLE "users" ADD COLUMN "position_title" TEXT;
ALTER TABLE "users" ADD COLUMN "notes" TEXT;
ALTER TABLE "users" ADD COLUMN "last_login_at" TIMESTAMPTZ;
