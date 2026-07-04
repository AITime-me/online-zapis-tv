import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  formatStudioTimeInput,
  parseStudioDateTime,
} from "@/lib/datetime/date-key";
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

export type BookingCatalogService = {
  id: string;
  publicName: string;
  clientDescription: string | null;
  durationMinutes: number;
  breakAfterMinutes: number;
  priceLabel: string | null;
  categoryName?: string | null;
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
};

export type OnlineBookingInput = {
  serviceId: string;
  masterId: string;
  date: string;
  startTime: string;
  name: string;
  phone: string;
};

function decimalToNumber(value: Prisma.Decimal | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  return Number(value);
}

function formatPriceLabel(
  priceFrom: Prisma.Decimal | null,
  priceTo: Prisma.Decimal | null,
): string | null {
  const from = decimalToNumber(priceFrom);
  const to = decimalToNumber(priceTo);

  if (from != null && to != null) {
    return `${from}–${to} ₽`;
  }
  if (from != null) {
    return `от ${from} ₽`;
  }
  if (to != null) {
    return `до ${to} ₽`;
  }
  return null;
}

function addMinutesToTime(dateKey: string, time: string, minutes: number): string {
  const base = parseStudioDateTime(dateKey, time);
  const result = new Date(base.getTime() + minutes * 60_000);
  return formatStudioTimeInput(result);
}

function compareTimeStrings(left: string, right: string): number {
  return left.localeCompare(right);
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
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

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
      startsAt: block.startsAt ?? new Date(0),
      endsAt: block.endsAt ?? new Date(0),
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
          isOnlineBookingEnabled: true,
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

  return {
    categories: categories
      .filter((category) => category.services.length > 0)
      .map((category) => ({
        id: category.id,
        name: category.name,
        services: category.services.map((service) => ({
          id: service.id,
          publicName: service.publicName,
          clientDescription: service.clientDescription,
          durationMinutes: service.durationMinutes,
          breakAfterMinutes: service.breakAfterMinutes,
          priceLabel: formatPriceLabel(service.priceFrom, service.priceTo),
        })),
      })),
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
      isOnlineBookingEnabled: true,
      isPublic: true,
      masterServices: {
        some: {
          isEnabled: true,
          isOnlineBookingEnabled: true,
          service: {
            isActive: true,
            isOnlineBookingEnabled: true,
            id: { notIn: [...SEED_TEST_SERVICE_IDS] },
          },
        },
      },
    },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      publicName: true,
      clientDescription: true,
      photoUrl: true,
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

    services.push({
      id: entry.service.id,
      publicName: entry.service.publicName,
      clientDescription: entry.service.clientDescription,
      durationMinutes: timing.durationMinutes,
      breakAfterMinutes: timing.breakAfterMinutes,
      priceLabel: formatPriceLabel(
        entry.service.priceFrom,
        entry.service.priceTo,
      ),
      categoryName: entry.service.category.name,
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
    dateKey === studioToday ? formatStudioTimeInput(new Date()) : "00:00";

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

  if (!name) {
    throw new AppointmentValidationError("Укажите имя");
  }

  if (!phone) {
    throw new AppointmentValidationError("Укажите телефон");
  }

  const timing = await assertOnlineBookable(input.masterId, input.serviceId);
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
  });
}
