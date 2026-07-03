-- CreateEnum
CREATE TYPE "ManagerNoteType" AS ENUM ('MANAGER', 'OWNER');

-- AlterTable
ALTER TABLE "manager_notes" ADD COLUMN "note_type" "ManagerNoteType" NOT NULL DEFAULT 'MANAGER';

-- CreateIndex
CREATE INDEX "manager_notes_note_date_note_type_idx" ON "manager_notes"("note_date", "note_type");
