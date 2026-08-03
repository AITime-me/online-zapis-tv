import { NextResponse } from "next/server";
import { enforceBotInternalAuth } from "@/lib/auth/bot-internal-auth";
import {
  evaluateBotEligibility,
  parseBotEligibilityBody,
} from "@/lib/bot-api/evaluate-eligibility";
import { safeLogError } from "@/lib/logging/redact";
import { enforceEndpointRateLimit } from "@/lib/security/rate-limit/enforce-policy";
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

function validationErrorResponse(error: string) {
  return NextResponse.json(
    {
      ok: false as const,
      code: "VALIDATION_ERROR" as const,
      error,
    },
    {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
}

export async function POST(request: Request) {
  const authResponse = enforceBotInternalAuth(request);
  if (authResponse) {
    return authResponse;
  }

  const rateLimitResponse = enforceEndpointRateLimit(request, "botInternal");
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return validationErrorResponse("Invalid JSON body");
  }

  const parsed = parseBotEligibilityBody(rawBody);
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
}
