import { withBotInternalApi } from "@/lib/auth/bot-internal-api";
import {
  botAvailabilityInternalErrorResponse,
  botAvailabilityValidationResponse,
  evaluateBotAvailableSlots,
  mapBotAvailabilityDomainResult,
  parseBotSlotsBody,
} from "@/lib/bot-api/availability";
import {
  BOT_INTERNAL_MAX_JSON_BODY_BYTES,
  readBoundedJsonBody,
} from "@/lib/bot-api/bounded-json-body";
import {
  formatStudioDateKey,
  getStudioNow,
} from "@/lib/datetime/date-layer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const POST = withBotInternalApi(async (request: Request) => {
  const bodyResult = await readBoundedJsonBody(
    request,
    BOT_INTERNAL_MAX_JSON_BODY_BYTES,
  );
  if (!bodyResult.ok) {
    if (bodyResult.code === "PAYLOAD_TOO_LARGE") {
      return botAvailabilityValidationResponse(bodyResult.error, 413);
    }
    return botAvailabilityValidationResponse(bodyResult.error);
  }

  const parsed = parseBotSlotsBody(bodyResult.value);
  if (!parsed.ok) {
    return botAvailabilityValidationResponse(parsed.error);
  }

  try {
    const now = getStudioNow();
    const studioToday = formatStudioDateKey(now);
    const result = await evaluateBotAvailableSlots(
      parsed.value,
      studioToday,
      now,
    );
    return mapBotAvailabilityDomainResult("bot-internal-slots", result);
  } catch (error) {
    return botAvailabilityInternalErrorResponse("bot-internal-slots", error);
  }
});
