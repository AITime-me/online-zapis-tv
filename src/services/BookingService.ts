import "server-only";

import { Prisma, type AppointmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { safeLogError } from "@/lib/logging/redact";
import {
  ONLINE_SERVICE_UNAVAILABLE_MESSAGE,
  SERVICE_UNAVAILABLE_CODE,
} from "@/lib/booking/public-booking-errors";
import type { SiteAttribution } from "@/lib/attribution/site-attribution";
import type {
  BookingCatalogCategory,
  BookingCatalogMaster,
  BookingCatalogService,
  BookingServiceMode,
} from "@/lib/booking/catalog-types";
import {
  isClientConsentGiven,
  validateClientContactFields,
} from "@/lib/booking/client-validation";
import {
  filterSlotsByReachableChains,
  isOnlineBookingSlotChainsEnabled,
  parseTimeToMinutes,
  resolveOnlineFillTimingsForRequest,
  type SlotChainBlockingInterval,
  type SlotChainTiming,
  type SlotChainWorkWindow,
} from "@/lib/booking/online-slot-chains";
import {
  isOnlinePublicBookable,
  onlinePublicMastersForServiceWhere,
  onlinePublicMasterServiceWhere,
} from "@/lib/booking/online-public-master-service";
import {
  assertPublicMorningSlotAllowed,
  isPublicMorningSlotBlocked,
} from "@/lib/booking/public-morning-slot-cutoff";
import {
  addMinutesSafe,
  formatStudioDateKey,
  formatStudioTimeInput,
  getEpochDate,
  getStudioNow,
  parseStudioDateTime,
} from "@/lib/datetime/date-layer";
import { getStudioDayRangeFromDateKey, getStudioMonthRangeFromMonthKey } from "@/lib/datetime/studio";
import {
  formatPriceDisplay,
  fromPriceBounds,
  getBasePrice,
} from "@/lib/pricing/price-layer";
import { evaluateStoredAppliedPromotions } from "@/lib/promo/applied-promotions";
import {
  APPOINTMENT_BUSY_TIMING_SELECT,
  getAppointmentBusyInterval,
  type AppointmentBusyTimingSnapshot,
} from "@/lib/schedule/appointment-busy";
import { resolvePublicOnlineBookingHours } from "@/lib/schedule/master-work-hours";
import { isBlockingAppointmentStatus } from "@/lib/schedule/non-blocking-appointment-statuses";
import { SEED_TEST_SERVICE_IDS } from "@/lib/services/seed-test-service-ids";
import {
  AppointmentConflictError,
  AppointmentValidationError,
  createOnlineAppointment,
} from "@/services/AppointmentService";
import { resolveClientContextByPhone } from "@/services/ClientContextService";
import { resolveClientForLead } from "@/services/ClientLinkService";
import {
  assertRequiredLegalDocumentsPublished,
} from "@/services/LegalDocumentService";
import { checkMasterIntervalAvailability } from "@/services/MasterAvailabilityService";
import { blocksForDayWhere } from "@/services/ScheduleBlockService";
import {
  resolveServiceTimingForMaster,
  resolveTimingFromLoadedParts,
} from "@/services/ServiceTimingService";
import { getPublicStudioSettings } from "@/services/StudioSettingsService";

export type {
  BookingCatalogCategory,
  BookingCatalogMaster,
  BookingCatalogService,
  BookingServiceMode,
} from "@/lib/booking/catalog-types";

export type BookingPolicyDb = Pick<
  Prisma.TransactionClient,
  "service" | "master" | "masterService"
>;

export type BookingPolicyRuntime = {
  db: BookingPolicyDb;
  resolveTiming: typeof resolveServiceTimingForMaster;
  /** Studio kill-switch; defaults to StudioSettings.isOnlineBookingEnabled. */
  isStudioOnlineBookingEnabled?: () => Promise<boolean>;
};

async function defaultIsStudioOnlineBookingEnabled(): Promise<boolean> {
  const settings = await getPublicStudioSettings();
  return settings.isOnlineBookingEnabled === true;
}

const DEFAULT_BOOKING_POLICY_RUNTIME: BookingPolicyRuntime = {
  db: prisma,
  resolveTiming: resolveServiceTimingForMaster,
  isStudioOnlineBookingEnabled: defaultIsStudioOnlineBookingEnabled,
};

export type OnlineBookingInput = {
  serviceId: string;
  masterId: string;
  date: string;
  startTime: string;
  name: string;
  phone: string;
  comment?: string;
  personalDataConsent: boolean;
  offerAcknowledgement: boolean;
  attribution?: SiteAttribution;
};

/**
 * Внутренние опции расчёта слотов (5-й аргумент getAvailableTimeSlots).
 * Публичный HTTP API не меняется; используется для preload в month и DI в тестах.
 */
export type PublicSlotCalculationOptions = {
  /** Уже загруженные timings; undefined = загрузить при включённом флаге. */
  preloadedOnlineTimings?: SlotChainTiming[] | null;
  /** Подмена loader только для тестов / harness. */
  loadOnlineFillTimings?: (
    masterId: string,
  ) => Promise<SlotChainTiming[] | null>;
  /**
   * Optional booking policy runtime (studio kill-switch memoization for month loops).
   * Defaults to DEFAULT_BOOKING_POLICY_RUNTIME.
   */
  bookingPolicyRuntime?: BookingPolicyRuntime;
  /**
   * Единый момент запроса для past-filter и public morning cutoff.
   * Routes / createOnlineBooking передают один now на весь flow.
   */
  now?: Date;
};

export type CreateOnlineBookingOptions = {
  /** Единый момент серверного flow (тесты / DI). */
  now?: Date;
};

export class OnlineServiceUnavailableError extends AppointmentValidationError {
  constructor(message = ONLINE_SERVICE_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = SERVICE_UNAVAILABLE_CODE;
  }
}

/**
 * Enforces StudioSettings.isOnlineBookingEnabled for self-booking paths.
 * Manager-request intake is intentionally out of scope (stays available).
 */
export async function assertStudioOnlineBookingEnabled(
  isEnabled: () => Promise<boolean> = defaultIsStudioOnlineBookingEnabled,
): Promise<void> {
  if ((await isEnabled()) !== true) {
    throw new OnlineServiceUnavailableError();
  }
}

function decimalToNumber(value: Prisma.Decimal | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  return Number(value);
}

function resolveServicePrice(
  priceFrom: Prisma.Decimal | null,
  priceTo: Prisma.Decimal | null,
): { priceLabel: string | null; basePrice: number | null } {
  const parsed = fromPriceBounds(
    decimalToNumber(priceFrom),
    decimalToNumber(priceTo),
  );

  if (!parsed) {
    return { priceLabel: null, basePrice: null };
  }

  return {
    priceLabel: formatPriceDisplay(parsed.min, parsed.max),
    basePrice: getBasePrice(parsed),
  };
}

function addMinutesToTime(dateKey: string, time: string, minutes: number): string {
  const base = parseStudioDateTime(dateKey, time);
  const result = addMinutesSafe(base, minutes);
  return formatStudioTimeInput(result ?? base);
}

function compareTimeStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function resolveSlotIterationBounds(
  workStart: string,
  workEnd: string,
  extraWorkWindows: Array<{ startsAt: Date; endsAt: Date }>,
): { rangeStart: string; rangeEnd: string } {
  let rangeStart = workStart;
  let rangeEnd = workEnd;

  for (const window of extraWorkWindows) {
    const windowStart = formatStudioTimeInput(window.startsAt);
    const windowEnd = formatStudioTimeInput(window.endsAt);
    if (compareTimeStrings(windowStart, rangeStart) < 0) {
      rangeStart = windowStart;
    }
    if (compareTimeStrings(windowEnd, rangeEnd) > 0) {
      rangeEnd = windowEnd;
    }
  }

  return { rangeStart, rangeEnd };
}

function dateToStudioMinutes(value: Date): number {
  return parseTimeToMinutes(formatStudioTimeInput(value));
}

/**
 * Пакетная загрузка timing-вариантов публичных онлайн-услуг мастера.
 * Один masterService.findMany; без повторного master.findUnique
 * (мастер уже проверен assertOnlineBookable / slot context).
 * null — техническая ошибка → fallback; [] — пустой каталог → fallback без spam-лога.
 */
async function loadOnlineFillTimingsForMaster(
  masterId: string,
): Promise<SlotChainTiming[] | null> {
  try {
    const masterServices = await prisma.masterService.findMany({
      where: onlinePublicMasterServiceWhere(masterId),
      select: {
        isEnabled: true,
        durationMinutesOverride: true,
        breakAfterMinutesOverride: true,
        service: {
          select: {
            durationMinutes: true,
            breakAfterMinutes: true,
            isActive: true,
          },
        },
      },
    });

    const seen = new Set<string>();
    const timings: SlotChainTiming[] = [];

    for (const entry of masterServices) {
      const resolved = resolveTimingFromLoadedParts(entry.service, entry);
      if (!resolved) {
        continue;
      }
      const key = `${resolved.durationMinutes}:${resolved.breakAfterMinutes}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      timings.push({
        durationMinutes: resolved.durationMinutes,
        breakAfterMinutes: resolved.breakAfterMinutes,
      });
    }

    return timings;
  } catch (error) {
    safeLogError(
      "[booking/loadOnlineFillTimingsForMaster] online filler timings failed; fallback to rawSlots",
      error,
    );
    return null;
  }
}

function buildSlotChainWorkWindows(
  workStart: string,
  workEnd: string,
  constrainAppointmentEnd: boolean,
  extraWorkWindows: Array<{ startsAt: Date; endsAt: Date }>,
): SlotChainWorkWindow[] {
  const windows: SlotChainWorkWindow[] = [
    {
      startMinutes: parseTimeToMinutes(workStart),
      lastStartMinutes: parseTimeToMinutes(workEnd),
      hardEndMinutes: constrainAppointmentEnd
        ? parseTimeToMinutes(workEnd)
        : null,
      constrainProcedureEnd: constrainAppointmentEnd,
    },
  ];

  for (const extra of extraWorkWindows) {
    const startMinutes = dateToStudioMinutes(extra.startsAt);
    const endMinutes = dateToStudioMinutes(extra.endsAt);
    if (endMinutes <= startMinutes) {
      continue;
    }
    windows.push({
      startMinutes,
      // Для extra окно жёсткое: последний старт — любая минута до конца,
      // но процедура должна закончиться ≤ endsAt (как в availability).
      lastStartMinutes: Math.max(startMinutes, endMinutes - 1),
      hardEndMinutes: endMinutes,
      constrainProcedureEnd: true,
    });
  }

  return windows;
}

function buildSlotChainBlockingIntervals(
  appointments: Array<AppointmentBusyTimingSnapshot & { status: AppointmentStatus }>,
  scheduleBlocks: Array<{
    startsAt: Date | null;
    endsAt: Date | null;
    isFullDay: boolean;
  }>,
): SlotChainBlockingInterval[] {
  const intervals: SlotChainBlockingInterval[] = [];

  for (const appointment of appointments) {
    if (!isBlockingAppointmentStatus(appointment.status)) {
      continue;
    }
    const busy = getAppointmentBusyInterval(appointment);
    intervals.push({
      startMinutes: dateToStudioMinutes(busy.startsAt),
      endMinutes: dateToStudioMinutes(busy.endsAt),
    });
  }

  for (const block of scheduleBlocks) {
    if (block.isFullDay || block.startsAt == null || block.endsAt == null) {
      continue;
    }
    intervals.push({
      startMinutes: dateToStudioMinutes(block.startsAt),
      endMinutes: dateToStudioMinutes(block.endsAt),
    });
  }

  return intervals;
}

async function loadServicePromoContext(serviceId: string) {
  return prisma.service.findUnique({
    where: { id: serviceId },
    select: {
      categoryId: true,
      publicName: true,
      price: true,
      priceFrom: true,
      priceTo: true,
      category: { select: { name: true } },
    },
  });
}

export async function assertOnlineBookable(
  masterId: string,
  serviceId: string,
  runtime: BookingPolicyRuntime = DEFAULT_BOOKING_POLICY_RUNTIME,
): Promise<{ durationMinutes: number; breakAfterMinutes: number }> {
  await assertStudioOnlineBookingEnabled(
    runtime.isStudioOnlineBookingEnabled ?? defaultIsStudioOnlineBookingEnabled,
  );

  const [service, master, masterService, timing] = await Promise.all([
    runtime.db.service.findUnique({
      where: { id: serviceId },
      select: {
        id: true,
        isActive: true,
        isOnlineBookingEnabled: true,
        isPublic: true,
        category: { select: { isActive: true, isPublic: true } },
      },
    }),
    runtime.db.master.findUnique({
      where: { id: masterId },
      select: {
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
      },
    }),
    runtime.db.masterService.findUnique({
      where: { masterId_serviceId: { masterId, serviceId } },
      select: {
        isEnabled: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
      },
    }),
    runtime.resolveTiming(masterId, serviceId),
  ]);

  if (!service) {
    throw new OnlineServiceUnavailableError();
  }

  if (
    !isOnlinePublicBookable({
      service,
      master,
      masterService,
    })
  ) {
    if (
      !service.isActive ||
      !service.isOnlineBookingEnabled ||
      !service.isPublic ||
      !service.category?.isActive ||
      !service.category?.isPublic
    ) {
      throw new OnlineServiceUnavailableError();
    }

    throw new AppointmentValidationError(
      "Услуга или мастер недоступны для онлайн-записи",
    );
  }

  if (timing == null) {
    throw new AppointmentValidationError(
      "Услуга или мастер недоступны для онлайн-записи",
    );
  }

  return timing;
}

async function loadSlotContext(masterId: string, dateKey: string) {
  const master = await prisma.master.findUnique({
    where: { id: masterId },
    select: {
      id: true,
      slotMinutes: true,
      workStart: true,
      workEnd: true,
      usesDefaultWorkHours: true,
    },
  });

  if (!master) {
    return null;
  }

  const { dayStart, dayEnd, noteDate } = getStudioDayRangeFromDateKey(dateKey);

  const [appointments, scheduleBlocks, extraWorkWindows] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        masterId,
        startsAt: { gte: dayStart, lte: dayEnd },
      },
      select: {
        ...APPOINTMENT_BUSY_TIMING_SELECT,
        status: true,
      },
    }),
    prisma.scheduleBlock.findMany({
      where: blocksForDayWhere(masterId, dateKey),
      select: {
        startsAt: true,
        endsAt: true,
        isFullDay: true,
      },
    }),
    prisma.extraWorkWindow.findMany({
      where: {
        masterId,
        workDate: noteDate,
        isOnlineBookingEnabled: true,
      },
      select: {
        startsAt: true,
        endsAt: true,
      },
    }),
  ]);

  return {
    master,
    appointments,
    scheduleBlocks,
    extraWorkWindows,
    workHours: resolvePublicOnlineBookingHours(master, dateKey),
  };
}

function isSlotAvailable(
  dateKey: string,
  startTime: string,
  durationMinutes: number,
  breakAfterMinutes: number,
  context: NonNullable<Awaited<ReturnType<typeof loadSlotContext>>>,
): boolean {
  const startsAt = parseStudioDateTime(dateKey, startTime);
  // Free-at candidate: procedure + break already in endsAt; breakAfterMinutes: 0
  // so toBusyInterval does not double-apply break. Work-hours fit in the slot
  // loop already uses duration+break the same way.
  const endsAt =
    addMinutesSafe(startsAt, durationMinutes + breakAfterMinutes) ?? startsAt;
  const epoch = getEpochDate();

  const availability = checkMasterIntervalAvailability({
    masterId: context.master.id,
    dateKey,
    standardWorkStart: context.workHours.workStart,
    standardWorkEnd: context.workHours.workEnd,
    constrainAppointmentEnd: context.workHours.constrainAppointmentEnd,
    extraWorkWindows: context.extraWorkWindows,
    appointments: context.appointments,
    scheduleBlocks: context.scheduleBlocks.map((block) => ({
      startsAt: block.startsAt ?? epoch,
      endsAt: block.endsAt ?? epoch,
      isFullDay: block.isFullDay,
    })),
    candidateInterval: {
      startsAt,
      endsAt,
      breakAfterMinutes: 0,
    },
  });

  return availability.isAvailable;
}

type ServiceBookingModeResult = {
  bookingMode: BookingServiceMode;
  managerMasterId: string | null;
  managerMasterName: string | null;
};

export type ResolveServiceBookingModesOptions = {
  /**
   * When false, services with an ONLINE path are projected as MANAGER_ONLY
   * (public catalog studio kill-switch). Defaults to true.
   */
  selfBookingEnabled?: boolean;
};

export async function canBookServiceOnline(
  serviceId: string,
  service: {
    id: string;
    isActive: boolean;
    isPublic: boolean;
    isOnlineBookingEnabled: boolean;
    category: { isActive: boolean; isPublic: boolean } | null;
  },
  link: {
    isEnabled: boolean;
    isPublic: boolean;
    isOnlineBookingEnabled: boolean;
    masterId: string;
    master: {
      isActive: boolean;
      isPublic: boolean;
      isOnlineBookingEnabled: boolean;
    };
  },
  resolveTiming: typeof resolveServiceTimingForMaster =
    resolveServiceTimingForMaster,
): Promise<boolean> {
  if (
    !isOnlinePublicBookable({
      service,
      master: link.master,
      masterService: link,
    })
  ) {
    return false;
  }

  const timing = await resolveTiming(link.masterId, serviceId);
  return timing != null;
}

export async function resolveServiceBookingModes(
  serviceIds: string[],
  runtime: BookingPolicyRuntime = DEFAULT_BOOKING_POLICY_RUNTIME,
  options: ResolveServiceBookingModesOptions = {},
): Promise<Map<string, ServiceBookingModeResult>> {
  const result = new Map<string, ServiceBookingModeResult>();
  const selfBookingEnabled = options.selfBookingEnabled ?? true;

  if (serviceIds.length === 0) {
    return result;
  }

  const [services, links] = await Promise.all([
    runtime.db.service.findMany({
      where: { id: { in: serviceIds } },
      select: {
        id: true,
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
        category: { select: { isActive: true, isPublic: true } },
      },
    }),
    runtime.db.masterService.findMany({
      where: {
        serviceId: { in: serviceIds },
        isEnabled: true,
        master: { isActive: true, isPublic: true },
      },
      include: {
        master: {
          select: {
            id: true,
            publicName: true,
            isActive: true,
            isPublic: true,
            isOnlineBookingEnabled: true,
            sortOrder: true,
          },
        },
      },
      orderBy: [{ master: { sortOrder: "asc" } }],
    }),
  ]);

  const serviceById = new Map(services.map((service) => [service.id, service]));
  const linksByServiceId = new Map<string, typeof links>();

  for (const link of links) {
    const bucket = linksByServiceId.get(link.serviceId) ?? [];
    bucket.push(link);
    linksByServiceId.set(link.serviceId, bucket);
  }

  for (const serviceId of serviceIds) {
    const service = serviceById.get(serviceId);
    const serviceLinks = linksByServiceId.get(serviceId) ?? [];

    if (!service?.isActive) {
      continue;
    }

    let hasOnlinePath = false;
    for (const link of serviceLinks) {
      if (
        await canBookServiceOnline(
          serviceId,
          service,
          link,
          runtime.resolveTiming,
        )
      ) {
        hasOnlinePath = true;
        break;
      }
    }

    if (hasOnlinePath && selfBookingEnabled) {
      result.set(serviceId, {
        bookingMode: "ONLINE",
        managerMasterId: null,
        managerMasterName: null,
      });
      continue;
    }

    const managerLink =
      serviceLinks.find((link) => !link.master.isOnlineBookingEnabled) ??
      serviceLinks[0];

    result.set(serviceId, {
      bookingMode: "MANAGER_ONLY",
      managerMasterId: managerLink?.master.id ?? null,
      managerMasterName: managerLink?.master.publicName ?? null,
    });
  }

  return result;
}

export async function getBookingCatalog(
  runtime: BookingPolicyRuntime = DEFAULT_BOOKING_POLICY_RUNTIME,
): Promise<{
  categories: BookingCatalogCategory[];
}> {
  // One studio-settings read per catalog request (not per service).
  const studioOnline =
    (await (runtime.isStudioOnlineBookingEnabled ??
      defaultIsStudioOnlineBookingEnabled)()) === true;

  const categories = await prisma.serviceCategory.findMany({
    where: { isActive: true, isPublic: true },
    orderBy: { sortOrder: "asc" },
    include: {
      services: {
        where: {
          isActive: true,
          isPublic: true,
          id: { notIn: [...SEED_TEST_SERVICE_IDS] },
        },
        orderBy: [{ sortOrder: "asc" }, { publicName: "asc" }],
        select: {
          id: true,
          publicName: true,
          clientDescription: true,
          durationMinutes: true,
          breakAfterMinutes: true,
          priceFrom: true,
          priceTo: true,
        },
      },
    },
  });

  const serviceIds = categories.flatMap((category) =>
    category.services.map((service) => service.id),
  );
  const bookingModes = await resolveServiceBookingModes(serviceIds, runtime, {
    selfBookingEnabled: studioOnline,
  });

  const defaultManagerOnly: ServiceBookingModeResult = {
    bookingMode: "MANAGER_ONLY",
    managerMasterId: null,
    managerMasterName: null,
  };

  return {
    categories: categories
      .map((category) => ({
        id: category.id,
        name: category.name,
        services: category.services.map((service) => {
          const price = resolveServicePrice(service.priceFrom, service.priceTo);
          return {
            id: service.id,
            publicName: service.publicName,
            clientDescription: service.clientDescription,
            durationMinutes: service.durationMinutes,
            breakAfterMinutes: service.breakAfterMinutes,
            priceLabel: price.priceLabel,
            basePrice: price.basePrice,
            categoryName: category.name,
            ...(bookingModes.get(service.id) ?? defaultManagerOnly),
          };
        }),
      }))
      .filter((category) => category.services.length > 0),
  };
}

export async function listMastersForService(
  serviceId: string,
  runtime: BookingPolicyRuntime = DEFAULT_BOOKING_POLICY_RUNTIME,
): Promise<BookingCatalogMaster[]> {
  const masters = await runtime.db.master.findMany({
    where: onlinePublicMastersForServiceWhere(serviceId),
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      publicName: true,
      clientDescription: true,
      photoUrl: true,
      isOnlineBookingEnabled: true,
    },
  });

  const withTiming = await Promise.all(
    masters.map(async (master) => ({
      master,
      timing: await runtime.resolveTiming(master.id, serviceId),
    })),
  );

  return withTiming
    .filter((entry) => entry.timing != null)
    .map((entry) => entry.master);
}

export async function listBookableMasters(): Promise<BookingCatalogMaster[]> {
  return prisma.master.findMany({
    where: {
      isActive: true,
      isPublic: true,
    },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      publicName: true,
      clientDescription: true,
      photoUrl: true,
      isOnlineBookingEnabled: true,
    },
  });
}

export async function listServicesForMaster(
  masterId: string,
  runtime: BookingPolicyRuntime = DEFAULT_BOOKING_POLICY_RUNTIME,
): Promise<BookingCatalogService[]> {
  // One studio-settings read per by-master services request (not per service).
  const studioOnline =
    (await (runtime.isStudioOnlineBookingEnabled ??
      defaultIsStudioOnlineBookingEnabled)()) === true;

  const [master, masterServices] = await Promise.all([
    runtime.db.master.findUnique({
      where: { id: masterId },
      select: { id: true, publicName: true },
    }),
    runtime.db.masterService.findMany({
      where: onlinePublicMasterServiceWhere(masterId),
      include: {
        service: {
          select: {
            id: true,
            publicName: true,
            clientDescription: true,
            durationMinutes: true,
            breakAfterMinutes: true,
            priceFrom: true,
            priceTo: true,
            category: { select: { name: true } },
          },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { service: { publicName: "asc" } }],
    }),
  ]);

  const services: BookingCatalogService[] = [];

  for (const entry of masterServices) {
    const timing = await runtime.resolveTiming(masterId, entry.serviceId);
    if (!timing) {
      continue;
    }

    const price = resolveServicePrice(
      entry.service.priceFrom,
      entry.service.priceTo,
    );

    // When studio self-booking is off, keep the service visible but hand off
    // to manager-request with the selected master as preference.
    const bookingMode: BookingServiceMode = studioOnline
      ? "ONLINE"
      : "MANAGER_ONLY";

    services.push({
      id: entry.service.id,
      publicName: entry.service.publicName,
      clientDescription: entry.service.clientDescription,
      durationMinutes: timing.durationMinutes,
      breakAfterMinutes: timing.breakAfterMinutes,
      priceLabel: price.priceLabel,
      basePrice: price.basePrice,
      categoryName: entry.service.category.name,
      bookingMode,
      managerMasterId: studioOnline ? null : masterId,
      managerMasterName: studioOnline ? null : (master?.publicName ?? null),
    });
  }

  return services;
}

export async function getAvailableTimeSlots(
  masterId: string,
  serviceId: string,
  dateKey: string,
  studioToday: string,
  options: PublicSlotCalculationOptions = {},
): Promise<string[]> {
  const timing = await assertOnlineBookable(
    masterId,
    serviceId,
    options.bookingPolicyRuntime ?? DEFAULT_BOOKING_POLICY_RUNTIME,
  );
  const context = await loadSlotContext(masterId, dateKey);

  if (!context) {
    return [];
  }

  const { workStart, workEnd, constrainAppointmentEnd } = context.workHours;
  const { rangeStart, rangeEnd } = resolveSlotIterationBounds(
    workStart,
    workEnd,
    context.extraWorkWindows,
  );
  const slotStep = Math.max(5, context.master.slotMinutes);
  const slots: string[] = [];
  const now = options.now ?? getStudioNow();
  const minStartTime =
    dateKey === studioToday ? formatStudioTimeInput(now) : "00:00";

  let current = rangeStart;
  while (
    constrainAppointmentEnd
      ? compareTimeStrings(current, rangeEnd) < 0
      : compareTimeStrings(current, rangeEnd) <= 0
  ) {
    const serviceEnd = addMinutesToTime(
      dateKey,
      current,
      timing.durationMinutes + timing.breakAfterMinutes,
    );

    const fitsHours = constrainAppointmentEnd
      ? compareTimeStrings(serviceEnd, rangeEnd) <= 0
      : true;

    if (fitsHours) {
      if (
        compareTimeStrings(current, minStartTime) >= 0 &&
        !isPublicMorningSlotBlocked({
          slotDateKey: dateKey,
          startTime: current,
          now,
        }) &&
        isSlotAvailable(
          dateKey,
          current,
          timing.durationMinutes,
          timing.breakAfterMinutes,
          context,
        )
      ) {
        slots.push(current);
      }
    }

    current = addMinutesToTime(dateKey, current, slotStep);
  }

  const rawSlots = [...new Set(slots)];

  const loader =
    options.loadOnlineFillTimings ?? loadOnlineFillTimingsForMaster;

  const resolved = await resolveOnlineFillTimingsForRequest({
    chainsEnabled: isOnlineBookingSlotChainsEnabled(),
    preloadedOnlineTimings: options.preloadedOnlineTimings,
    load: () => loader(masterId),
  });

  if (resolved.mode === "skip_filter") {
    return rawSlots;
  }

  if (resolved.timings == null || resolved.timings.length === 0) {
    return rawSlots;
  }

  return filterSlotsByReachableChains({
    rawSlots,
    slotStepMinutes: slotStep,
    gridOriginMinutes: parseTimeToMinutes(rangeStart),
    workWindows: buildSlotChainWorkWindows(
      workStart,
      workEnd,
      constrainAppointmentEnd,
      context.extraWorkWindows,
    ),
    blockingIntervals: buildSlotChainBlockingIntervals(
      context.appointments,
      context.scheduleBlocks,
    ),
    onlineTimings: resolved.timings,
  });
}

export async function getAvailableDaysInMonth(
  masterId: string,
  serviceId: string,
  monthKey: string,
  studioToday: string,
  options: PublicSlotCalculationOptions = {},
): Promise<string[]> {
  const { days } = getStudioMonthRangeFromMonthKey(monthKey);
  const futureDays = days.filter((dateKey) => dateKey >= studioToday);
  const availableDays: string[] = [];

  // Resolve studio kill-switch once for the month loop (avoid N+1 StudioSettings reads).
  const baseRuntime =
    options.bookingPolicyRuntime ?? DEFAULT_BOOKING_POLICY_RUNTIME;
  await assertStudioOnlineBookingEnabled(
    baseRuntime.isStudioOnlineBookingEnabled ??
      defaultIsStudioOnlineBookingEnabled,
  );
  const monthRuntime: BookingPolicyRuntime = {
    ...baseRuntime,
    isStudioOnlineBookingEnabled: async () => true,
  };

  const loader =
    options.loadOnlineFillTimings ?? loadOnlineFillTimingsForMaster;

  let preloadedOnlineTimings = options.preloadedOnlineTimings;
  if (
    preloadedOnlineTimings === undefined &&
    isOnlineBookingSlotChainsEnabled()
  ) {
    preloadedOnlineTimings = await loader(masterId);
  }

  for (const dateKey of futureDays) {
    const slots = await getAvailableTimeSlots(
      masterId,
      serviceId,
      dateKey,
      studioToday,
      {
        preloadedOnlineTimings,
        loadOnlineFillTimings: options.loadOnlineFillTimings,
        bookingPolicyRuntime: monthRuntime,
        now: options.now,
      },
    );
    if (slots.length > 0) {
      availableDays.push(dateKey);
    }
  }

  return availableDays;
}

export async function createOnlineBooking(
  input: OnlineBookingInput,
  options: CreateOnlineBookingOptions = {},
) {
  const name = input.name.trim();
  const phone = input.phone.trim();

  if (!isClientConsentGiven(input.personalDataConsent)) {
    throw new AppointmentValidationError(
      "Необходимо согласие на обработку персональных данных",
    );
  }
  if (!isClientConsentGiven(input.offerAcknowledgement)) {
    throw new AppointmentValidationError(
      "Необходимо подтвердить ознакомление с условиями записи и публичной офертой",
    );
  }

  const fieldErrors = validateClientContactFields(name, phone);

  if (fieldErrors.name) {
    throw new AppointmentValidationError(fieldErrors.name);
  }

  if (fieldErrors.phone) {
    throw new AppointmentValidationError(fieldErrors.phone);
  }

  await assertRequiredLegalDocumentsPublished();
  const timing = await assertOnlineBookable(input.masterId, input.serviceId);

  // Единый now фиксируется сразу перед cutoff / slots — после read-only validation.
  const now = options.now ?? getStudioNow();

  // Явная cutoff-проверка до client/lead и Appointment (stale submit после 21:00).
  assertPublicMorningSlotAllowed({
    slotDateKey: input.date,
    startTime: input.startTime,
    now,
  });

  const studioToday = formatStudioDateKey(now);
  const availableSlots = await getAvailableTimeSlots(
    input.masterId,
    input.serviceId,
    input.date,
    studioToday,
    { now },
  );
  if (!availableSlots.includes(input.startTime)) {
    throw new AppointmentConflictError(
      "Выбранное время больше недоступно. Пожалуйста, выберите другое время.",
    );
  }

  const [serviceContext, clientContext] = await Promise.all([
    loadServicePromoContext(input.serviceId),
    resolveClientContextByPhone(phone),
  ]);

  const priceBounds = fromPriceBounds(
    decimalToNumber(serviceContext?.priceFrom ?? serviceContext?.price),
    decimalToNumber(serviceContext?.priceTo ?? serviceContext?.priceFrom ?? serviceContext?.price),
  );

  const appliedPromotions = evaluateStoredAppliedPromotions({
    serviceId: input.serviceId,
    categoryId: serviceContext?.categoryId,
    categoryName: serviceContext?.category?.name,
    clientContext: {
      isFirstVisit: clientContext.isFirstVisit,
      isNewClient: clientContext.isNewClient,
    },
    basePrice: priceBounds ? getBasePrice(priceBounds) : null,
    priceMax: priceBounds?.max ?? null,
  });

  if (process.env.NODE_ENV !== "production") {
    safeLogError("[booking/createOnlineBooking] client promo context", null, {
      isFirstVisit: clientContext.isFirstVisit,
      qualifyingBookings: clientContext.visitHistory.totalBookings,
      appliedPromotionsCount: appliedPromotions.length,
    });
  }

  const endTime = addMinutesToTime(
    input.date,
    input.startTime,
    timing.durationMinutes + timing.breakAfterMinutes,
  );

  const clientLink = await resolveClientForLead({
    fullName: name,
    phone,
    source: "online_booking",
    serviceName: serviceContext?.publicName ?? null,
  });

  return createOnlineAppointment({
    masterId: input.masterId,
    dateKey: input.date,
    startTime: input.startTime,
    endTime,
    serviceId: input.serviceId,
    clientName: name,
    clientPhone: phone,
    comment: input.comment?.trim() || null,
    appliedPromotions,
    clientId: clientLink.clientId,
    siteAttribution: input.attribution,
  });
}
