import { ManagerNoteType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getStudioDayRangeFromDateKey } from "@/lib/datetime/studio";
import type { ScheduleDayManagerNote } from "@/types/schedule";

export class ManagerNoteValidationError extends Error {}

export class ManagerNoteNotFoundError extends Error {}

export type ManagerNoteWriteInput = {
  dateKey: string;
  content: string;
  noteType?: ManagerNoteType;
};

function mapNote(note: {
  id: string;
  content: string;
  createdAt: Date;
}): ScheduleDayManagerNote {
  return {
    id: note.id,
    content: note.content,
    createdAt: note.createdAt.toISOString(),
  };
}

function validateContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new ManagerNoteValidationError("Текст заметки не может быть пустым");
  }
  return trimmed;
}

function resolveNoteType(noteType?: ManagerNoteType): ManagerNoteType {
  return noteType ?? ManagerNoteType.MANAGER;
}

export async function getManagerNotesForDate(
  dateKey: string,
  noteType: ManagerNoteType = ManagerNoteType.MANAGER,
): Promise<ScheduleDayManagerNote[]> {
  const { noteDate } = getStudioDayRangeFromDateKey(dateKey);
  const notes = await prisma.managerNote.findMany({
    where: { noteDate, noteType },
    orderBy: { createdAt: "asc" },
  });

  return notes.map(mapNote);
}

export async function createManagerNote(
  input: ManagerNoteWriteInput,
  createdByUserId: string,
): Promise<ScheduleDayManagerNote> {
  const content = validateContent(input.content);
  const noteType = resolveNoteType(input.noteType);
  const { noteDate } = getStudioDayRangeFromDateKey(input.dateKey);

  const note = await prisma.managerNote.create({
    data: {
      noteDate,
      noteType,
      content,
      createdByUserId,
    },
  });

  return mapNote(note);
}

export async function updateManagerNote(
  id: string,
  content: string,
): Promise<ScheduleDayManagerNote> {
  const trimmed = validateContent(content);

  const existing = await prisma.managerNote.findUnique({ where: { id } });
  if (!existing) {
    throw new ManagerNoteNotFoundError("Заметка не найдена");
  }

  const note = await prisma.managerNote.update({
    where: { id },
    data: { content: trimmed },
  });

  return mapNote(note);
}

export async function deleteManagerNote(id: string): Promise<void> {
  const existing = await prisma.managerNote.findUnique({ where: { id } });
  if (!existing) {
    throw new ManagerNoteNotFoundError("Заметка не найдена");
  }

  await prisma.managerNote.delete({ where: { id } });
}
