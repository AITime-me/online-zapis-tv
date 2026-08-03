import { NextResponse } from "next/server";
import { withBotInternalApi } from "@/lib/auth/bot-internal-api";
import {
  evaluateBotEligibility,
  parseBotEligibilityBody,
} from "@/lib/bot-api/evaluate-eligibility";
import {
  BOT_INTERNAL_MAX_JSON_BODY_BYTES,
  readBoundedJsonBody,
} from "@/lib/bot-api/bounded-json-body";
import { safeLogError } from "@/lib/logging/redact";
import {
  listMastersForService,
  resolveServiceBookingModes,
  type BookingPolicyRuntime,
} from "@/services/BookingService";
import { prisma } from "@/lib/db";
import { resolveServiceTimingForMaster } from "@/services/ServiceTimingService";
import { getPublicStudioSettings } from "@/services/StudioSettingsService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_RUNTIME: BookingPolicyRuntime = {
  db: prisma,
  resolveTiming: resolveServiceTimingForMaster,
  isStudioOnlineBookingEnabled: async () => {
    const settings = await getPublicStudioSettings();
    return settings.isOnlineBookingEnabled === true;
  },
};

function validationErrorResponse(error: string, status = 400) {
  return NextResponse.json(
    {
      ok: false as const,
      code: status === 413 ? ("PAYLOAD_TOO_LARGE" as const) : ("VALIDATION_ERROR" as const),
      error,
    },
    {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
}

export const POST = withBotInternalApi(async (request: Request) => {
  const bodyResult = await readBoundedJsonBody(
    request,
    BOT_INTERNAL_MAX_JSON_BODY_BYTES,
  );
  if (!bodyResult.ok) {
    if (bodyResult.code === "PAYLOAD_TOO_LARGE") {
      return validationErrorResponse(bodyResult.error, 413);
    }
    return validationErrorResponse(bodyResult.error);
  }

  const parsed = parseBotEligibilityBody(bodyResult.value);
  if (!parsed.ok) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const result = await evaluateBotEligibility(parsed.value, {
      ...DEFAULT_RUNTIME,
      listOnlineMastersForService: listMastersForService,
      resolveBookingModes: resolveServiceBookingModes,
    });

    return NextResponse.json(
      {
        ok: true as const,
        ...result,
      },
      {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  } catch (error) {
    // Event name only — safeLogError redacts secrets/PII; never log Authorization/body.
    safeLogError("bot-internal-eligibility", error);
    return NextResponse.json(
      {
        ok: false as const,
        code: "INTERNAL_ERROR" as const,
        error: "Internal error",
      },
      {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }
});
