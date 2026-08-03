import { isCanonicalUuid } from "@/lib/booking-requests/idempotency-contract";
import {
  isOnlinePublicBookable,
  isOnlinePublicLinkEligible,
  isOnlinePublicMasterEligible,
  isOnlinePublicServiceEligible,
} from "@/lib/booking/online-public-master-service";
import type {
  BotEligibilityAlternativeMaster,
  BotEligibilityReasonCode,
  BotEligibilityRequest,
  BotEligibilityResult,
} from "@/lib/bot-api/eligibility-types";
import {
  listMastersForService,
  resolveServiceBookingModes,
  type BookingPolicyRuntime,
} from "@/services/BookingService";
import { getPublicStudioSettings } from "@/services/StudioSettingsService";

export type BotEligibilityRuntime = BookingPolicyRuntime & {
  isStudioOnlineBookingEnabled?: () => Promise<boolean>;
  listOnlineMastersForService?: typeof listMastersForService;
  resolveBookingModes?: typeof resolveServiceBookingModes;
};

const ALLOWED_BODY_KEYS = new Set([
  "serviceId",
  "masterId",
  "includeAlternatives",
]);

export type ParseBotEligibilityBodyResult =
  | { ok: true; value: BotEligibilityRequest }
  | { ok: false; code: "VALIDATION_ERROR"; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBotEligibilityBody(
  body: unknown,
): ParseBotEligibilityBodyResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request body",
    };
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(key)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        error: "Unknown field",
      };
    }
  }

  const serviceIdRaw = body.serviceId;
  if (typeof serviceIdRaw !== "string" || !isCanonicalUuid(serviceIdRaw.trim())) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid serviceId",
    };
  }

  let masterId: string | undefined;
  if (body.masterId !== undefined && body.masterId !== null) {
    if (typeof body.masterId !== "string" || !isCanonicalUuid(body.masterId.trim())) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        error: "Invalid masterId",
      };
    }
    masterId = body.masterId.trim().toLowerCase();
  }

  let includeAlternatives = false;
  if (body.includeAlternatives !== undefined) {
    if (typeof body.includeAlternatives !== "boolean") {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        error: "Invalid includeAlternatives",
      };
    }
    includeAlternatives = body.includeAlternatives;
  }

  return {
    ok: true,
    value: {
      serviceId: serviceIdRaw.trim().toLowerCase(),
      ...(masterId ? { masterId } : {}),
      includeAlternatives,
    },
  };
}

async function defaultIsStudioOnlineBookingEnabled(): Promise<boolean> {
  const settings = await getPublicStudioSettings();
  return settings.isOnlineBookingEnabled === true;
}

function resolvePairReasonCode(input: {
  service: {
    id: string;
    isActive: boolean;
    isPublic: boolean;
    isOnlineBookingEnabled: boolean;
    category: { isActive: boolean; isPublic: boolean } | null;
  } | null;
  master: {
    isActive: boolean;
    isPublic: boolean;
    isOnlineBookingEnabled: boolean;
  } | null;
  masterService: {
    isEnabled: boolean;
    isPublic: boolean;
    isOnlineBookingEnabled: boolean;
  } | null;
  timingOk: boolean;
}): BotEligibilityReasonCode {
  const { service, master, masterService, timingOk } = input;

  if (!service) {
    return "SERVICE_NOT_FOUND";
  }

  if (!isOnlinePublicServiceEligible(service)) {
    return "SERVICE_INACTIVE";
  }

  if (!master) {
    return "MASTER_INACTIVE";
  }

  if (!master.isActive || !master.isPublic) {
    return "MASTER_INACTIVE";
  }

  if (!master.isOnlineBookingEnabled) {
    return "ONLINE_DISABLED";
  }

  if (!isOnlinePublicMasterEligible(master)) {
    return "MASTER_INACTIVE";
  }

  if (!masterService || !isOnlinePublicLinkEligible(masterService) || !timingOk) {
    return "MASTER_SERVICE_UNAVAILABLE";
  }

  return "MASTER_SERVICE_UNAVAILABLE";
}

function buildResult(input: {
  outcome: BotEligibilityResult["outcome"];
  reasonCode: BotEligibilityReasonCode | null;
  selectedPairAllowed: boolean;
  serviceOnlineInGeneral: boolean;
  otherOnlineMasters: BotEligibilityAlternativeMaster[];
  includeAlternatives: boolean;
}): BotEligibilityResult {
  const {
    outcome,
    reasonCode,
    selectedPairAllowed,
    serviceOnlineInGeneral,
    otherOnlineMasters,
    includeAlternatives,
  } = input;

  return {
    outcome,
    reasonCode,
    selectedPairAllowed,
    serviceOnlineInGeneral,
    otherOnlineMasterCount: otherOnlineMasters.length,
    ...(includeAlternatives
      ? { otherOnlineMasters }
      : {}),
  };
}

/**
 * Pair-specific eligibility for bot self-booking.
 * Does not auto-replace a closed master; alternatives are metadata only.
 */
export async function evaluateBotEligibility(
  request: BotEligibilityRequest,
  runtime: BotEligibilityRuntime,
): Promise<BotEligibilityResult> {
  const isStudioOnline =
    (await (runtime.isStudioOnlineBookingEnabled ??
      defaultIsStudioOnlineBookingEnabled)()) === true;

  const resolveModes =
    runtime.resolveBookingModes ?? resolveServiceBookingModes;
  const listMasters =
    runtime.listOnlineMastersForService ?? listMastersForService;

  const modes = await resolveModes([request.serviceId], runtime);
  const mode = modes.get(request.serviceId);
  const entityOnlineInGeneral = mode?.bookingMode === "ONLINE";
  const serviceOnlineInGeneral = isStudioOnline && entityOnlineInGeneral;

  const includeAlternatives = request.includeAlternatives === true;

  if (!isStudioOnline) {
    return buildResult({
      outcome: "MANAGER_HANDOFF",
      reasonCode: "STUDIO_ONLINE_DISABLED",
      selectedPairAllowed: false,
      serviceOnlineInGeneral: false,
      otherOnlineMasters: [],
      includeAlternatives,
    });
  }

  const onlineMasters = await listMasters(request.serviceId, runtime);
  const otherOnlineMasters = onlineMasters
    .filter((master) => master.id !== request.masterId)
    .map((master) => ({
      id: master.id,
      publicName: master.publicName,
    }));

  if (!request.masterId) {
    if (serviceOnlineInGeneral) {
      return buildResult({
        outcome: "SELF_BOOKING_ALLOWED",
        reasonCode: null,
        selectedPairAllowed: false,
        serviceOnlineInGeneral: true,
        otherOnlineMasters: onlineMasters.map((master) => ({
          id: master.id,
          publicName: master.publicName,
        })),
        includeAlternatives,
      });
    }

    return buildResult({
      outcome: "MANAGER_HANDOFF",
      reasonCode: "MANAGER_ONLY",
      selectedPairAllowed: false,
      serviceOnlineInGeneral: false,
      otherOnlineMasters: [],
      includeAlternatives,
    });
  }

  const [service, master, masterService, timing] = await Promise.all([
    runtime.db.service.findUnique({
      where: { id: request.serviceId },
      select: {
        id: true,
        isActive: true,
        isOnlineBookingEnabled: true,
        isPublic: true,
        category: { select: { isActive: true, isPublic: true } },
      },
    }),
    runtime.db.master.findUnique({
      where: { id: request.masterId },
      select: {
        id: true,
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
      },
    }),
    runtime.db.masterService.findUnique({
      where: {
        masterId_serviceId: {
          masterId: request.masterId,
          serviceId: request.serviceId,
        },
      },
      select: {
        isEnabled: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
      },
    }),
    runtime.resolveTiming(request.masterId, request.serviceId),
  ]);

  const pairBookable =
    isOnlinePublicBookable({
      service,
      master,
      masterService,
    }) && timing != null;

  if (pairBookable) {
    return buildResult({
      outcome: "SELF_BOOKING_ALLOWED",
      reasonCode: null,
      selectedPairAllowed: true,
      serviceOnlineInGeneral,
      otherOnlineMasters,
      includeAlternatives,
    });
  }

  const reasonCode = resolvePairReasonCode({
    service,
    master,
    masterService,
    timingOk: timing != null,
  });

  // Selected master closed while other ONLINE masters exist — still handoff;
  // bot shows alternatives only after explicit client consent (metadata only here).
  if (!entityOnlineInGeneral && reasonCode !== "SERVICE_NOT_FOUND") {
    return buildResult({
      outcome: "MANAGER_HANDOFF",
      reasonCode:
        reasonCode === "SERVICE_INACTIVE" ? reasonCode : "MANAGER_ONLY",
      selectedPairAllowed: false,
      serviceOnlineInGeneral: false,
      otherOnlineMasters: [],
      includeAlternatives,
    });
  }

  return buildResult({
    outcome: "MANAGER_HANDOFF",
    reasonCode,
    selectedPairAllowed: false,
    serviceOnlineInGeneral,
    otherOnlineMasters,
    includeAlternatives,
  });
}
