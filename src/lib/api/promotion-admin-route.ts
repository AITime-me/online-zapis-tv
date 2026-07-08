import { NextResponse } from "next/server";
import {
  PromotionNotFoundError,
  PromotionValidationError,
} from "@/services/PromotionCrudService";
import type { PromotionWriteInput } from "@/types/promotion-admin";
import { toApiErrorBody } from "@/lib/errors/format-service-error";

export async function readPromotionWriteBody(
  request: Request,
): Promise<PromotionWriteInput | NextResponse> {
  try {
    return (await request.json()) as PromotionWriteInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Пустое или некорректное тело запроса" },
      { status: 400 },
    );
  }
}

export function promotionAdminErrorResponse(error: unknown): NextResponse {
  if (error instanceof PromotionValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  if (error instanceof PromotionNotFoundError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
  }

  return NextResponse.json(toApiErrorBody(error), { status: 500 });
}
