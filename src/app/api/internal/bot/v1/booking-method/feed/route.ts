import { withBotInternalApi } from "@/lib/auth/bot-internal-api";
import {
  BOT_INTERNAL_MAX_JSON_BODY_BYTES,
  readBoundedJsonBody,
} from "@/lib/bot-api/bounded-json-body";
import {
  fixedBotBookingMethodErrorMessage,
  isExactApplicationJsonContentType,
  parseBotBookingMethodFeedBody,
  type BotBookingMethodErrorBody,
  type BotBookingMethodErrorCode,
} from "@/lib/bot-api/booking-method-types";
import { safeLogError } from "@/lib/logging/redact";
import { feedBotBookingMethodAppointments } from "@/services/BotBookingMethodService";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

function errorResponse(
  code: BotBookingMethodErrorCode,
  status: number,
): NextResponse {
  const body: BotBookingMethodErrorBody = {
    ok: false,
    code,
    error: fixedBotBookingMethodErrorMessage(code),
  };
  return NextResponse.json(body, { status, headers: JSON_HEADERS });
}

/**
 * A2.2 keyset feed: SELF_SERVICE | MANAGER | MASTER appointments only.
 * TEYA stays on A1; NULL is never emitted. Does not call bot-TV.
 */
export const POST = withBotInternalApi(async (request: Request) => {
  if (!isExactApplicationJsonContentType(request.headers.get("content-type"))) {
    return errorResponse("VALIDATION_ERROR", 400);
  }

  const bodyResult = await readBoundedJsonBody(
    request,
    BOT_INTERNAL_MAX_JSON_BODY_BYTES,
  );
  if (!bodyResult.ok) {
    if (bodyResult.code === "PAYLOAD_TOO_LARGE") {
      return errorResponse("PAYLOAD_TOO_LARGE", 413);
    }
    return errorResponse("VALIDATION_ERROR", 400);
  }

  const parsed = parseBotBookingMethodFeedBody(bodyResult.value);
  if (!parsed.ok) {
    return errorResponse("VALIDATION_ERROR", 400);
  }

  try {
    const result = await feedBotBookingMethodAppointments(parsed.value);
    if (!result.ok) {
      return errorResponse(result.code, result.httpStatus);
    }
    return NextResponse.json(result.body, {
      status: 200,
      headers: { ...JSON_HEADERS, "Cache-Control": "no-store" },
    });
  } catch (error) {
    safeLogError("bot-internal-booking-method-feed", error);
    return errorResponse("INTERNAL_ERROR", 500);
  }
});
