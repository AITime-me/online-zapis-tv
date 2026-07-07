import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  addMinutesSafe,
  formatStudioTimeInput,
  getEpochDate,
  getStudioNow,
  parseStudioDateTime,
} from "@/lib/datetime/date-layer";
import { getStudioDayRangeFromDateKey, getStudioMonthRangeFromMonthKey } from "@/lib/datetime/studio";
import { resolveMasterWorkHours } from "@/lib/schedule/master-work-hours";
import { SEED_TEST_SERVICE_IDS } from "@/lib/services/seed-test-service-ids";
import {
  AppointmentValidationError,
  createOnlineAppointment,
} from "@/services/AppointmentService";
import { checkMasterIntervalAvailability } from "@/services/MasterAvailabilityService";
import { blocksForDayWhere } from "@/services/ScheduleBlockService";
import { resolveServiceTimingForMaster } from "@/services/ServiceTimingService";
import { validateClientContactFields } from "@/lib/booking/client-validation";
import {
  formatPriceDisplay,
  fromPriceBounds,
  getBasePrice,
} from "@/lib/pricing/price-layer";
import { evaluateStoredAppliedPromotions } from "@/lib/promo/applied-promotions";
import { resolveClientContextByPhone } from "@/services/ClientContextService";

export type BookingServiceMode = "ONLINE" | "MANAGER_ONLY";

export type BookingCatalogService = {
  id: string;
  publicName: string;
  clientDescription: string | null;
  durationMinutes: number;
  breakAfterMinutes: number;
  priceLabel: string | null;
  basePrice: number | null;
  categoryName?: string | null;
  bookingMode: BookingServiceMode;
  managerMasterId: string | null;
  managerMasterName: string | null;
};

export type BookingCatalogCategory = {
  id: string;
  name: string;
  services: BookingCatalogService[];
};

export type BookingCatalogMaster = {
  id: string;
  publicName: string;
  clientDescription: string | null;
  photoUrl: string | null;
  isOnlineBookingEnabled: boolean;
};

export type OnlineBookingInput = {
  serviceId: string;
  masterId: string;
  date: string;
  startTime: string;
  name: string;
  phone: string;
  comment?: string;
};

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

async function loadServicePromoContext(serviceId: string) {
  return prisma.service.findUnique({
    where: { id: serviceId },
    select: {
      categoryId: true,
      price: true,
      priceFrom: true,
      priceTo: true,
      category: { select: { name: true } },
    },
  });
}

async function assertOnlineBookable(
  masterId: string,
  serviceId: string,
): Promise<{ durationMinutes: number; breakAfterMinutes: number }> {
  const [service, master, masterService, timing] = await Promise.all([
    prisma.service.findUnique({
      where: { id: serviceId },
      select: { isActive: true, isOnlineBookingEnabled: true },
    }),
    prisma.master.findUnique({
      where: { id: masterId },
      select: { isActive: true, isOnlineBookingEnabled: true },
    }),
    prisma.masterService.findUnique({
      where: { masterId_serviceId: { masterId, serviceId } },
      select: { isEnabled: true, isOnlineBookingEnabled: true },
    }),
    resolveServiceTimingForMaster(masterId, serviceId),
  ]);

  if (
    !service?.isActive ||
    !service.isOnlineBookingEnabled ||
    !master?.isActive ||
    !master.isOnlineBookingEnabled ||
    masterService?.isEnabled !== true ||
    masterService.isOnlineBookingEnabled !== true ||
    timing == null
  ) {
    throw new AppointmentValidationError("Услуга или мастер недоступны для онлайн-записи");
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
        startsAt: true,
        endsAt: true,
        breakAfterMinutes: true,
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
    workHours: resolveMasterWorkHours(master, dateKey),
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
  const endsAt = addMinutesSafe(startsAt, durationMinutes) ?? startsAt;
  const epoch = getEpochDate();

  const availability = checkMasterIntervalAvailability({
    masterId: context.master.id,
    dateKey,
    standardWorkStart: context.workHours.workStart,
    standardWorkEnd: context.workHours.workEnd,
    extraWorkWindows: context.extraWorkWindows,
    appointments: context.appointments.map((appointment) => ({
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      breakAfterMinutes: appointment.breakAfterMinutes ?? 0,
      status: appointment.status,
    })),
    scheduleBlocks: context.scheduleBlocks.map((block) => ({
      startsAt: block.startsAt ?? epoch,
      endsAt: block.endsAt ?? epoch,
      isFullDay: block.isFullDay,
    })),
    candidateInterval: {
      startsAt,
      endsAt,
      breakAfterMinutes,
    },
  });

  return availability.isAvailable;
}

type ServiceBookingModeResult = {
  bookingMode: BookingServiceMode;
  managerMasterId: string | null;
  managerMasterName: string | null;
};

async function canBookServiceOnline(
  serviceId: string,
  service: { isOnlineBookingEnabled: boolean },
  link: {
    isEnabled: boolean;
    isOnlineBookingEnabled: boolean;
    masterId: string;
    master: { isOnlineBookingEnabled: boolean };
  },
): Promise<boolean> {
  if (
    !service.isOnlineBookingEnabled ||
    !link.isEnabled ||
    !link.isOnlineBookingEnabled ||
    !link.master.isOnlineBookingEnabled
  ) {
    return false;
  }

  const timing = await resolveServiceTimingForMaster(link.masterId, serviceId);
  return timing != null;
}

async function resolveServiceBookingModes(
  serviceIds: string[],
): Promise<Map<string, ServiceBookingModeResult>> {
  const result = new Map<string, ServiceBookingModeResult>();

  if (serviceIds.length === 0) {
    return result;
  }

  const [services, links] = await Promise.all([
    prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, isActive: true, isOnlineBookingEnabled: true },
    }),
    prisma.masterService.findMany({
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
      if (await canBookServiceOnline(serviceId, service, link)) {
        hasOnlinePath = true;
        break;
      }
    }

    if (hasOnlinePath) {
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

export async function getBookingCatalog(): Promise<{
  categories: BookingCatalogCategory[];
}> {
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
  const bookingModes = await resolveServiceBookingModes(serviceIds);

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
): Promise<BookingCatalogMaster[]> {
  const masters = await prisma.master.findMany({
    where: {
      isActive: true,
      isOnlineBookingEnabled: true,
      isPublic: true,
      masterServices: {
        some: {
          serviceId,
          isEnabled: true,
          isOnlineBookingEnabled: true,
        },
      },
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

  const withTiming = await Promise.all(
    masters.map(async (master) => ({
      master,
      timing: await resolveServiceTimingForMaster(master.id, serviceId),
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
): Promise<BookingCatalogService[]> {
  const masterServices = await prisma.masterService.findMany({
    where: {
      masterId,
      isEnabled: true,
      isOnlineBookingEnabled: true,
      service: {
        isActive: true,
        isOnlineBookingEnabled: true,
        id: { notIn: [...SEED_TEST_SERVICE_IDS] },
      },
    },
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
  });

  const services: BookingCatalogService[] = [];

  for (const entry of masterServices) {
    const timing = await resolveServiceTimingForMaster(masterId, entry.serviceId);
    if (!timing) {
      continue;
    }

    const price = resolveServicePrice(
      entry.service.priceFrom,
      entry.service.priceTo,
    );

    services.push({
      id: entry.service.id,
      publicName: entry.service.publicName,
      clientDescription: entry.service.clientDescription,
      durationMinutes: timing.durationMinutes,
      breakAfterMinutes: timing.breakAfterMinutes,
      priceLabel: price.priceLabel,
      basePrice: price.basePrice,
      categoryName: entry.service.category.name,
      bookingMode: "ONLINE",
      managerMasterId: null,
      managerMasterName: null,
    });
  }

  return services;
}

export async function getAvailableTimeSlots(
  masterId: string,
  serviceId: string,
  dateKey: string,
  studioToday: string,
): Promise<string[]> {
  const timing = await assertOnlineBookable(masterId, serviceId);
  const context = await loadSlotContext(masterId, dateKey);

  if (!context) {
    return [];
  }

  const { workStart, workEnd } = context.workHours;
  const slotStep = Math.max(5, context.master.slotMinutes);
  const slots: string[] = [];
  const minStartTime =
    dateKey === studioToday ? formatStudioTimeInput(getStudioNow()) : "00:00";

  let current = workStart;
  while (compareTimeStrings(current, workEnd) < 0) {
    const serviceEnd = addMinutesToTime(
      dateKey,
      current,
      timing.durationMinutes + timing.breakAfterMinutes,
    );

    if (compareTimeStrings(serviceEnd, workEnd) <= 0) {
      if (
        compareTimeStrings(current, minStartTime) >= 0 &&
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

  return slots;
}

export async function getAvailableDaysInMonth(
  masterId: string,
  serviceId: string,
  monthKey: string,
  studioToday: string,
): Promise<string[]> {
  const { days } = getStudioMonthRangeFromMonthKey(monthKey);
  const futureDays = days.filter((dateKey) => dateKey >= studioToday);
  const availableDays: string[] = [];

  for (const dateKey of futureDays) {
    const slots = await getAvailableTimeSlots(
      masterId,
      serviceId,
      dateKey,
      studioToday,
    );
    if (slots.length > 0) {
      availableDays.push(dateKey);
    }
  }

  return availableDays;
}

export async function createOnlineBooking(input: OnlineBookingInput) {
  const name = input.name.trim();
  const phone = input.phone.trim();
  const fieldErrors = validateClientContactFields(name, phone);

  if (fieldErrors.name) {
    throw new AppointmentValidationError(fieldErrors.name);
  }

  if (fieldErrors.phone) {
    throw new AppointmentValidationError(fieldErrors.phone);
  }

  const timing = await assertOnlineBookable(input.masterId, input.serviceId);
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

  console.error("[booking/createOnlineBooking] client promo context:", {
    phoneSuffix: phone.replace(/\D/g, "").slice(-10),
    isFirstVisit: clientContext.isFirstVisit,
    qualifyingBookings: clientContext.visitHistory.totalBookings,
    appliedPromotionsCount: appliedPromotions.length,
  });

  const endTime = addMinutesToTime(
    input.date,
    input.startTime,
    timing.durationMinutes,
  );

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
  });
}
