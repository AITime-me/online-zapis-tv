import { withBotInternalApi } from "@/lib/auth/bot-internal-api";
import {
  BOT_INTERNAL_MAX_JSON_BODY_BYTES,
  readBoundedJsonBody,
} from "@/lib/bot-api/bounded-json-body";
import {
  fixedBotAcquisitionSourceErrorMessage,
  isExactApplicationJsonContentType,
  parseBotAcquisitionSourceContextBody,
  type BotAcquisitionSourceErrorBody,
  type BotAcquisitionSourceErrorCode,
} from "@/lib/bot-api/acquisition-source-types";
import { safeLogError } from "@/lib/logging/redact";
import { getBotAcquisitionSourceContext } from "@/services/BotAcquisitionSourceService";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

function errorResponse(
  code: BotAcquisitionSourceErrorCode,
  status: number,
): NextResponse {
  const body: BotAcquisitionSourceErrorBody = {
    ok: false,
    code,
    error: fixedBotAcquisitionSourceErrorMessage(code),
  };
  return NextResponse.json(body, { status, headers: JSON_HEADERS });
}

/**
 * A2.3b2 trusted acquisition context: evidence-bound sourceKey + phone E.164.
 * No UTM / referrer / source_marker. Does not call bot-TV.
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

  const parsed = parseBotAcquisitionSourceContextBody(bodyResult.value);
  if (!parsed.ok) {
    return errorResponse("VALIDATION_ERROR", 400);
  }

  try {
    const result = await getBotAcquisitionSourceContext(parsed.value);
    if (!result.ok) {
      return errorResponse(result.code, result.httpStatus);
    }
    return NextResponse.json(result.body, {
      status: 200,
      headers: { ...JSON_HEADERS, "Cache-Control": "no-store" },
    });
  } catch (error) {
    safeLogError("bot-internal-acquisition-source-context", error);
    return errorResponse("INTERNAL_ERROR", 500);
  }
});
