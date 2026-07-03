import { ManagerNoteType } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  requireApiRoles,
  requireInternalApiAuth,
  WRITE_SCHEDULE_ROLES,
} from "@/lib/auth/api-access";
import { isValidDateKey } from "@/lib/datetime/date-key";
import {
  createManagerNote,
  getManagerNotesForDate,
  ManagerNoteValidationError,
  type ManagerNoteWriteInput,
} from "@/services/ManagerNoteService";

function parseNoteType(value: string | null): ManagerNoteType | null {
  if (value === "MANAGER" || value === "OWNER") {
    return value;
  }
  return null;
}

export async function GET(request: Request) {
  const authResult = await requireInternalApiAuth();
  if ("response" in authResult) {
    return authResult.response;
  }

  const { searchParams } = new URL(request.url);
  const dateKey = searchParams.get("date");
  const typeParam = searchParams.get("type");
  const noteType = parseNoteType(typeParam) ?? ManagerNoteType.MANAGER;

  if (!dateKey || !isValidDateKey(dateKey)) {
    return NextResponse.json(
      { ok: false, error: "date (YYYY-MM-DD) is required" },
      { status: 400 },
    );
  }

  if (typeParam && !parseNoteType(typeParam)) {
    return NextResponse.json(
      { ok: false, error: "type must be MANAGER or OWNER" },
      { status: 400 },
    );
  }

  const notes = await getManagerNotesForDate(dateKey, noteType);
  return NextResponse.json({ ok: true, dateKey, noteType, notes });
}

export async function POST(request: Request) {
  const authResult = await requireApiRoles(WRITE_SCHEDULE_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as ManagerNoteWriteInput;
    const note = await createManagerNote(body, authResult.user.id);
    return NextResponse.json({ ok: true, note });
  } catch (error) {
    if (error instanceof ManagerNoteValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}
