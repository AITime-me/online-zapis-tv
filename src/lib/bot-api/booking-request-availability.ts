/**
 * Request-only slot calculation for bot BookingRequest availability / book.
 * INTERNAL eligibility only — never assertOnlineBookable / public online flags.
 * Includes ALL extraWorkWindows for the day (not only isOnlineBookingEnabled).
 */
import "server-only";

import { buildBotSlotId } from "@/lib/booking/bot-slot-id";
import {
  addMinutesSafe,
  formatStudioDateKey,
  formatStudioOffsetDateTime,
  formatStudioTimeInput,
  getEpochDate,
  getStudioNow,
  parseStudioDateTime,
} from "@/lib/datetime/date-layer";
import {
  getStudioDayRangeFromDateKey,
  getStudioMonthRangeFromMonthKey,
} from "@/lib/datetime/studio";
import { APPOINTMENT_BUSY_TIMING_SELECT } from "@/lib/schedule/appointment-busy";
import { resolveMasterWorkHours } from "@/lib/schedule/master-work-hours";
import { prisma } from "@/lib/db";
import { checkMasterIntervalAvailability } from "@/services/MasterAvailabilityService";
import { blocksForDayWhere } from "@/services/ScheduleBlockService";
import { resolveServiceTimingForMaster } from "@/services/ServiceTimingService";
import type {
  BotBookingRequestAvailabilitySlotDto,
  BotBookingRequestErrorCode,
} from "@/lib/bot-api/booking-request-types";

export type RequestOnlyAvailabilityError = {
  code: Extract<
    BotBookingRequestErrorCode,
    | "MASTER_UNAVAILABLE"
    | "SERVICE_UNAVAILABLE"
    | "SERVICE_MASTER_MISMATCH"
    | "INTERNAL_ERROR"
  >;
};

function addMinutesToTime(
  dateKey: string,
  time: string,
  minutes: number,
): string {
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

/**
 * INTERNAL soft eligibility (mirrors lockInternalPolicyRows + master.isActive).
 * Does not read / require public or online booking flags.
 */
export async function assertInternalRequestBookable(
  masterId: string,
  serviceId: string,
): Promise<
  | { ok: true; durationMinutes: number; breakAfterMinutes: number }
  | { ok: false; code: RequestOnlyAvailabilityError["code"] }
> {
  const [master, service, masterService, timing] = await Promise.all([
    prisma.master.findUnique({
      where: { id: masterId },
      select: { id: true, isActive: true },
    }),
    prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true, isActive: true },
    }),
    prisma.masterService.findUnique({
      where: { masterId_serviceId: { masterId, serviceId } },
      select: { isEnabled: true },
    }),
    resolveServiceTimingForMaster(masterId, serviceId),
  ]);

  if (!master || !master.isActive) {
    return { ok: false, code: "MASTER_UNAVAILABLE" };
  }
  if (!service || !service.isActive) {
    return { ok: false, code: "SERVICE_UNAVAILABLE" };
  }
  if (!masterService || masterService.isEnabled !== true) {
    return { ok: false, code: "SERVICE_MASTER_MISMATCH" };
  }
  if (!timing) {
    return { ok: false, code: "SERVICE_UNAVAILABLE" };
  }

  return {
    ok: true,
    durationMinutes: timing.durationMinutes,
    breakAfterMinutes: timing.breakAfterMinutes,
  };
}

/**
 * Like BookingService.loadSlotContext but includes ALL extraWorkWindows
 * for the day (not only isOnlineBookingEnabled:true).
 */
export async function loadRequestOnlySlotContext(
  masterId: string,
  dateKey: string,
) {
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
        // Request-only: include every extra window, online flag ignored.
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
  context: NonNullable<Awaited<ReturnType<typeof loadRequestOnlySlotContext>>>,
): boolean {
  const startsAt = parseStudioDateTime(dateKey, startTime);
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

/**
 * Same slot iteration as getAvailableTimeSlots, without assertOnlineBookable,
 * public morning cutoff, or online slot-chain filtering.
 */
export async function getRequestOnlyAvailableTimeSlots(input: {
  masterId: string;
  serviceId: string;
  dateKey: string;
  studioToday: string;
  now?: Date;
}): Promise<
  | { ok: true; times: string[] }
  | { ok: false; code: RequestOnlyAvailabilityError["code"] }
> {
  const policy = await assertInternalRequestBookable(
    input.masterId,
    input.serviceId,
  );
  if (!policy.ok) {
    return policy;
  }

  const context = await loadRequestOnlySlotContext(
    input.masterId,
    input.dateKey,
  );
  if (!context) {
    return { ok: false, code: "MASTER_UNAVAILABLE" };
  }

  const { workStart, workEnd, constrainAppointmentEnd } = context.workHours;
  const { rangeStart, rangeEnd } = resolveSlotIterationBounds(
    workStart,
    workEnd,
    context.extraWorkWindows,
  );
  const slotStep = Math.max(5, context.master.slotMinutes);
  const slots: string[] = [];
  const now = input.now ?? getStudioNow();
  const minStartTime =
    input.dateKey === input.studioToday ? formatStudioTimeInput(now) : "00:00";

  let current = rangeStart;
  while (
    constrainAppointmentEnd
      ? compareTimeStrings(current, rangeEnd) < 0
      : compareTimeStrings(current, rangeEnd) <= 0
  ) {
    const serviceEnd = addMinutesToTime(
      input.dateKey,
      current,
      policy.durationMinutes + policy.breakAfterMinutes,
    );

    const fitsHours = constrainAppointmentEnd
      ? compareTimeStrings(serviceEnd, rangeEnd) <= 0
      : true;

    if (
      fitsHours &&
      compareTimeStrings(current, minStartTime) >= 0 &&
      isSlotAvailable(
        input.dateKey,
        current,
        policy.durationMinutes,
        policy.breakAfterMinutes,
        context,
      )
    ) {
      slots.push(current);
    }

    current = addMinutesToTime(input.dateKey, current, slotStep);
  }

  return { ok: true, times: [...new Set(slots)] };
}

export async function projectRequestOnlySlots(input: {
  serviceId: string;
  masterId: string;
  dateKey: string;
  times: string[];
}): Promise<
  | { ok: true; slots: BotBookingRequestAvailabilitySlotDto[] }
  | { ok: false; code: "INTERNAL_ERROR" }
> {
  const seenTimes = new Set<string>();
  const slots: BotBookingRequestAvailabilitySlotDto[] = [];

  for (const startTime of input.times) {
    if (seenTimes.has(startTime)) {
      return { ok: false, code: "INTERNAL_ERROR" };
    }
    seenTimes.add(startTime);

    const startsAt = formatStudioOffsetDateTime(input.dateKey, startTime);
    if (!startsAt) {
      return { ok: false, code: "INTERNAL_ERROR" };
    }

    slots.push({
      slotId: buildBotSlotId({
        serviceId: input.serviceId,
        masterId: input.masterId,
        dateKey: input.dateKey,
        startTime,
      }),
      startsAt,
    });
  }

  slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { ok: true, slots };
}

export async function getRequestOnlyAvailableDaysInMonth(input: {
  masterId: string;
  serviceId: string;
  monthKey: string;
  studioToday: string;
  now?: Date;
}): Promise<
  | { ok: true; dateKeys: string[] }
  | { ok: false; code: RequestOnlyAvailabilityError["code"] }
> {
  const policy = await assertInternalRequestBookable(
    input.masterId,
    input.serviceId,
  );
  if (!policy.ok) {
    return policy;
  }

  const { days } = getStudioMonthRangeFromMonthKey(input.monthKey);
  const futureDays = days.filter((dateKey) => dateKey >= input.studioToday);
  const availableDays: string[] = [];

  for (const dateKey of futureDays) {
    const slots = await getRequestOnlyAvailableTimeSlots({
      masterId: input.masterId,
      serviceId: input.serviceId,
      dateKey,
      studioToday: input.studioToday,
      now: input.now,
    });
    if (!slots.ok) {
      return slots;
    }
    if (slots.times.length > 0) {
      availableDays.push(dateKey);
    }
  }

  return { ok: true, dateKeys: availableDays };
}

export async function isRequestOnlySlotAvailable(input: {
  masterId: string;
  serviceId: string;
  dateKey: string;
  startTime: string;
  studioToday: string;
  now?: Date;
}): Promise<
  | {
      ok: true;
      available: boolean;
      durationMinutes: number;
      breakAfterMinutes: number;
    }
  | { ok: false; code: RequestOnlyAvailabilityError["code"] }
> {
  const policy = await assertInternalRequestBookable(
    input.masterId,
    input.serviceId,
  );
  if (!policy.ok) {
    return policy;
  }

  const slots = await getRequestOnlyAvailableTimeSlots({
    masterId: input.masterId,
    serviceId: input.serviceId,
    dateKey: input.dateKey,
    studioToday: input.studioToday,
    now: input.now,
  });
  if (!slots.ok) {
    return slots;
  }

  return {
    ok: true,
    available: slots.times.includes(input.startTime),
    durationMinutes: policy.durationMinutes,
    breakAfterMinutes: policy.breakAfterMinutes,
  };
}

export { formatStudioDateKey };
