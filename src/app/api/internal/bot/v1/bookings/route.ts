import { withBotInternalApi } from "@/lib/auth/bot-internal-api";
import {
  BOT_INTERNAL_MAX_JSON_BODY_BYTES,
  readBoundedJsonBody,
} from "@/lib/bot-api/bounded-json-body";
import type {
  BotBookingCreateErrorBody,
  BotBookingCreateErrorCode,
} from "@/lib/bot-api/booking-create-types";
import {
  isExactApplicationJsonContentType,
  parseBotBookingCreateBody,
} from "@/lib/bot-api/booking-create-types";
import { safeLogError } from "@/lib/logging/redact";
import { createBotConfirmedBooking } from "@/services/BotBookingCreateService";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

function errorResponse(
  code: BotBookingCreateErrorCode,
  error: string,
  status: number,
): NextResponse {
  const body: BotBookingCreateErrorBody = {
    ok: false,
    code,
    error,
  };
  return NextResponse.json(body, { status, headers: JSON_HEADERS });
}

export const POST = withBotInternalApi(
  async (request: Request) => {
    if (!isExactApplicationJsonContentType(request.headers.get("content-type"))) {
      return errorResponse("VALIDATION_ERROR", "Invalid Content-Type", 400);
    }

    const bodyResult = await readBoundedJsonBody(
      request,
      BOT_INTERNAL_MAX_JSON_BODY_BYTES,
    );
    if (!bodyResult.ok) {
      if (bodyResult.code === "PAYLOAD_TOO_LARGE") {
        return errorResponse("PAYLOAD_TOO_LARGE", bodyResult.error, 413);
      }
      return errorResponse("VALIDATION_ERROR", bodyResult.error, 400);
    }

    const parsed = parseBotBookingCreateBody(bodyResult.value);
    if (!parsed.ok) {
      return errorResponse("VALIDATION_ERROR", parsed.error, 400);
    }

    try {
      const result = await createBotConfirmedBooking(parsed.value);
      if (!result.ok) {
        return errorResponse(result.code, result.error, result.httpStatus);
      }

      return NextResponse.json(result.body, {
        status: 200,
        headers: {
          ...JSON_HEADERS,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      safeLogError("bot-internal-bookings", error);
      return errorResponse("INTERNAL_ERROR", "Internal error", 500);
    }
  },
  { rateLimitPolicy: "botInternalBookingCreate" },
);
