import { withBotInternalApi } from "@/lib/auth/bot-internal-api";
import {
  BOT_INTERNAL_MAX_JSON_BODY_BYTES,
  readBoundedJsonBody,
} from "@/lib/bot-api/bounded-json-body";
import {
  fixedBotBookingRequestErrorMessage,
  isExactApplicationJsonContentType,
  parseBotBookingRequestBookBody,
  type BotBookingRequestErrorBody,
  type BotBookingRequestErrorCode,
} from "@/lib/bot-api/booking-request-types";
import { safeLogError } from "@/lib/logging/redact";
import { bookBotBookingRequest } from "@/services/BotBookingRequestService";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

function errorResponse(
  code: BotBookingRequestErrorCode,
  status: number,
): NextResponse {
  const body: BotBookingRequestErrorBody = {
    ok: false,
    code,
    error: fixedBotBookingRequestErrorMessage(code),
  };
  return NextResponse.json(body, { status, headers: JSON_HEADERS });
}

export const POST = withBotInternalApi(
  async (request: Request) => {
    if (
      !isExactApplicationJsonContentType(request.headers.get("content-type"))
    ) {
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

    const parsed = parseBotBookingRequestBookBody(bodyResult.value);
    if (!parsed.ok) {
      return errorResponse("VALIDATION_ERROR", 400);
    }

    try {
      const result = await bookBotBookingRequest(parsed.value);
      if (!result.ok) {
        return errorResponse(result.code, result.httpStatus);
      }
      return NextResponse.json(result.body, {
        status: 200,
        headers: { ...JSON_HEADERS, "Cache-Control": "no-store" },
      });
    } catch (error) {
      safeLogError("bot-internal-booking-requests-book", error);
      return errorResponse("INTERNAL_ERROR", 500);
    }
  },
  { rateLimitPolicy: "botInternalBookingCreate" },
);
