import "server-only";

import { prisma } from "@/lib/db";
import { getStudioNow } from "@/lib/datetime/date-layer";
import { SEED_TEST_SERVICE_IDS } from "@/lib/services/seed-test-service-ids";
import {
  buildBotLiveFactsPayloadV1,
  type BotLiveFactsPayloadV1,
} from "@/lib/bot-api/live-facts-contract";
import {
  resolveServiceBookingModes,
  type BookingPolicyRuntime,
} from "@/services/BookingService";
import { resolveServiceTimingForMaster } from "@/services/ServiceTimingService";
import { getPublicStudioSettings } from "@/services/StudioSettingsService";

const SEED_TEST_SERVICE_ID_SET = new Set<string>(SEED_TEST_SERVICE_IDS);

/**
 * LIVE business facts for bot-TV runtime.
 *
 * Reads current authoritative catalog / studio / MasterService SoT only.
 * Does NOT read BotKnowledgeEntry, KB publications, or BotSettings drafts.
 * Does NOT call BotKnowledgeFoundationService (admin summary ≠ runtime contract).
 * Does NOT include availability/slots or promotions/gifts (v1 gaps / other ports).
 */
export type BotLiveFactsLoadRuntime = {
  db: BookingPolicyRuntime["db"];
  resolveTiming: BookingPolicyRuntime["resolveTiming"];
  isStudioOnlineBookingEnabled: () => Promise<boolean>;
  getStudioPublicSettings: typeof getPublicStudioSettings;
  resolveBookingModes: typeof resolveServiceBookingModes;
  now: () => Date;
};

const DEFAULT_RUNTIME: BotLiveFactsLoadRuntime = {
  db: prisma,
  resolveTiming: resolveServiceTimingForMaster,
  isStudioOnlineBookingEnabled: async () => {
    const settings = await getPublicStudioSettings();
    return settings.isOnlineBookingEnabled === true;
  },
  getStudioPublicSettings: getPublicStudioSettings,
  resolveBookingModes: resolveServiceBookingModes,
  now: () => getStudioNow(),
};

export async function buildBotLiveFactsPayload(
  runtime: BotLiveFactsLoadRuntime = DEFAULT_RUNTIME,
): Promise<BotLiveFactsPayloadV1> {
  const [studioSettings, services, masters] = await Promise.all([
    runtime.getStudioPublicSettings(),
    runtime.db.service.findMany({
      where: {
        isPublic: true,
        id: { notIn: [...SEED_TEST_SERVICE_IDS] },
      },
      orderBy: [{ sortOrder: "asc" }, { publicName: "asc" }, { id: "asc" }],
      select: {
        id: true,
        publicName: true,
        durationMinutes: true,
        priceFrom: true,
        priceTo: true,
        isActive: true,
        isOnlineBookingEnabled: true,
        sortOrder: true,
        category: {
          select: {
            name: true,
          },
        },
      },
    }),
    runtime.db.master.findMany({
      where: { isPublic: true },
      orderBy: [{ sortOrder: "asc" }, { publicName: "asc" }, { id: "asc" }],
      select: {
        id: true,
        publicName: true,
        isActive: true,
        isOnlineBookingEnabled: true,
        sortOrder: true,
        masterServices: {
          where: { isEnabled: true },
          select: { serviceId: true },
          orderBy: { serviceId: "asc" },
        },
      },
    }),
  ]);

  const studioOnline = studioSettings.isOnlineBookingEnabled === true;
  const serviceIds = services.map((service) => service.id);
  const bookingModes = await runtime.resolveBookingModes(
    serviceIds,
    {
      db: runtime.db,
      resolveTiming: runtime.resolveTiming,
      isStudioOnlineBookingEnabled: runtime.isStudioOnlineBookingEnabled,
    },
    { selfBookingEnabled: studioOnline },
  );

  return buildBotLiveFactsPayloadV1({
    generatedAt: runtime.now(),
    studio: {
      name: studioSettings.studioName,
      phone: studioSettings.phone,
      email: studioSettings.email,
      address: studioSettings.address,
      workingHoursText: studioSettings.workingHoursText,
      isOnlineBookingEnabled: studioOnline,
    },
    services: services.map((service) => {
      const mode = bookingModes.get(service.id);
      // Inactive / unresolved → no ONLINE path; do not invent ONLINE.
      const bookingMode =
        service.isActive === true && mode?.bookingMode === "ONLINE"
          ? ("ONLINE" as const)
          : ("MANAGER_ONLY" as const);

      return {
        id: service.id,
        name: service.publicName,
        category: service.category?.name ?? null,
        priceFrom: service.priceFrom,
        priceTo: service.priceTo,
        durationMinutes: service.durationMinutes,
        bookingMode,
        isActive: service.isActive === true,
        isOnlineBookingEnabled: service.isOnlineBookingEnabled === true,
        sortOrder: service.sortOrder,
      };
    }),
    masters: masters.map((master) => ({
      id: master.id,
      name: master.publicName,
      isActive: master.isActive === true,
      isOnlineBookingEnabled: master.isOnlineBookingEnabled === true,
      sortOrder: master.sortOrder,
      // Authoritative MasterService.isEnabled links only — never invent from names.
      // Exclude seed/test service IDs (same catalog boundary as services[]).
      serviceIds: master.masterServices
        .map((link) => link.serviceId)
        .filter((serviceId) => !SEED_TEST_SERVICE_ID_SET.has(serviceId)),
    })),
  });
}
