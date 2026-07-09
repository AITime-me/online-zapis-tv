import { NextResponse } from "next/server";
import { CLIENTS_ADMIN_ROLES, requireApiRoles } from "@/lib/auth/api-access";
import {
  ClientDuplicateValidationError,
  updateClientDuplicateReview,
} from "@/services/ClientDuplicateService";
import type { ClientDuplicateReviewStatus } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function duplicateErrorResponse(error: unknown): NextResponse {
  if (error instanceof ClientDuplicateValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    { ok: false, error: "Не удалось сохранить статус разбора" },
    { status: 500 },
  );
}

type ReviewBody = {
  fingerprint?: string;
  status?: ClientDuplicateReviewStatus;
  note?: string | null;
};

function parseReviewStatus(
  value: string | undefined,
): ClientDuplicateReviewStatus | null {
  if (
    value === "REVIEW" ||
    value === "NOT_DUPLICATE" ||
    value === "POSTPONED"
  ) {
    return value;
  }
  return null;
}

export async function PATCH(request: Request) {
  const authResult = await requireApiRoles(CLIENTS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  let body: ReviewBody;
  try {
    body = (await request.json()) as ReviewBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Пустое или некорректное тело запроса" },
      { status: 400 },
    );
  }

  const fingerprint =
    typeof body.fingerprint === "string" ? body.fingerprint.trim() : "";
  const status = parseReviewStatus(body.status);

  if (!fingerprint) {
    return NextResponse.json(
      { ok: false, error: "Не указан fingerprint группы" },
      { status: 400 },
    );
  }

  if (!status) {
    return NextResponse.json(
      { ok: false, error: "Недопустимый статус разбора" },
      { status: 400 },
    );
  }

  try {
    await updateClientDuplicateReview({
      fingerprint,
      status,
      note: body.note,
      reviewedByUserId: authResult.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return duplicateErrorResponse(error);
  }
}
