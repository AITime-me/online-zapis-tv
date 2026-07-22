import type { AppointmentStatus } from "@prisma/client";
import { isBlockingAppointmentStatus } from "@/lib/schedule/non-blocking-appointment-statuses";
import {
  addMinutesSafe,
  getStudioNow,
  parseStudioDateKey,
} from "@/lib/datetime/date-layer";

export type TimeInterval = {
  startsAt: Date;
  endsAt: Date;
};

export type BusyInterval = TimeInterval & {
  breakAfterMinutes?: number | null;
};

/**
 * Поля Appointment для консервативной публичной занятости.
 * Каталог Service/MasterService сюда не передаётся — только snapshot/факт.
 */
export type PublicBusyIntervalInput = BusyInterval & {
  standardDurationMinutes?: number | null;
  standardBreakAfterMinutes?: number | null;
};

export type ScheduleBlockInterval = TimeInterval & {
  isFullDay?: boolean;
};

export type MasterAvailabilityInput = {
  masterId: string;
  dateKey: string;
  standardWorkStart: string;
  standardWorkEnd: string;
  /**
   * true (индивидуальный график): услуга целиком должна уложиться в окно.
   * false (официальные часы студии): ограничивается только старт ≤ standardWorkEnd;
   * конец процедуры может быть позже.
   */
  constrainAppointmentEnd?: boolean;
  extraWorkWindows: TimeInterval[];
  appointments: Array<PublicBusyIntervalInput & { status: AppointmentStatus }>;
  scheduleBlocks: ScheduleBlockInterval[];
  candidateInterval: BusyInterval;
  /**
   * true: существующие Appointment блокируют по toPublicBusyInterval
   * (публичные слоты / online write). false/undefined: фактический toBusyInterval.
   */
  usePublicBusyForAppointments?: boolean;
};

export type MasterAvailabilityResult = {
  isAvailable: boolean;
  conflicts: Array<{
    type: "appointment" | "block" | "full_day_block" | "outside_work_hours";
  }>;
};

export function toBusyInterval(interval: BusyInterval): TimeInterval {
  const breakMinutes = Math.max(0, interval.breakAfterMinutes ?? 0);

  return {
    startsAt: interval.startsAt,
    endsAt: addMinutesSafe(interval.endsAt, breakMinutes) ?? interval.endsAt,
  };
}

function isFiniteDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function normalizeNonNegativeMinutes(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.trunc(value));
}

/**
 * Консервативная публичная занятость Appointment.
 *
 * procedureBusyEnd = max(actual endsAt, startsAt + standardDurationMinutes?)
 * publicBusyEnd    = procedureBusyEnd + (breakAfterMinutes ?? standardBreakAfterMinutes ?? 0)
 *
 * Без live-каталога Service/MasterService. При битых датах — fallback на actual busy.
 */
export function toPublicBusyInterval(
  interval: PublicBusyIntervalInput,
): TimeInterval {
  if (!isFiniteDate(interval.startsAt) || !isFiniteDate(interval.endsAt)) {
    const startsAt = isFiniteDate(interval.startsAt)
      ? interval.startsAt
      : isFiniteDate(interval.endsAt)
        ? interval.endsAt
        : new Date(NaN);
    const endsAt = isFiniteDate(interval.endsAt) ? interval.endsAt : startsAt;
    return toBusyInterval({
      startsAt,
      endsAt,
      breakAfterMinutes: normalizeNonNegativeMinutes(interval.breakAfterMinutes) ?? 0,
    });
  }

  const standardDuration = normalizeNonNegativeMinutes(
    interval.standardDurationMinutes,
  );
  let procedureBusyEnd = interval.endsAt;

  if (standardDuration != null) {
    const standardProcedureEnd =
      addMinutesSafe(interval.startsAt, standardDuration) ?? interval.endsAt;
    if (
      isFiniteDate(standardProcedureEnd) &&
      standardProcedureEnd.getTime() > procedureBusyEnd.getTime()
    ) {
      procedureBusyEnd = standardProcedureEnd;
    }
  }

  const applicableBreak =
    normalizeNonNegativeMinutes(interval.breakAfterMinutes) ??
    normalizeNonNegativeMinutes(interval.standardBreakAfterMinutes) ??
    0;

  return {
    startsAt: interval.startsAt,
    endsAt:
      addMinutesSafe(procedureBusyEnd, applicableBreak) ?? procedureBusyEnd,
  };
}

function appointmentBusyInterval(
  appointment: PublicBusyIntervalInput,
  usePublicBusy: boolean,
): TimeInterval {
  return usePublicBusy
    ? toPublicBusyInterval(appointment)
    : toBusyInterval(appointment);
}

function intervalsOverlap(left: TimeInterval, right: TimeInterval): boolean {
  return left.startsAt < right.endsAt && right.startsAt < left.endsAt;
}

function parseWorkTimeOnDate(dateKey: string, time: string): Date {
  return parseStudioDateKey(dateKey, time) ?? getStudioNow();
}

export function checkMasterIntervalAvailability(
  input: MasterAvailabilityInput,
): MasterAvailabilityResult {
  const conflicts: MasterAvailabilityResult["conflicts"] = [];

  const fullDayBlocks = input.scheduleBlocks.filter((block) => block.isFullDay);
  if (fullDayBlocks.length > 0) {
    conflicts.push({ type: "full_day_block" });
    return { isAvailable: false, conflicts };
  }

  const standardStart = parseWorkTimeOnDate(
    input.dateKey,
    input.standardWorkStart,
  );
  const standardEnd = parseWorkTimeOnDate(input.dateKey, input.standardWorkEnd);

  const workWindows: TimeInterval[] = [
    { startsAt: standardStart, endsAt: standardEnd },
    ...input.extraWorkWindows,
  ];

  const constrainAppointmentEnd = input.constrainAppointmentEnd ?? true;
  const isInsideWorkWindow = workWindows.some((window, index) => {
    if (input.candidateInterval.startsAt < window.startsAt) {
      return false;
    }

    const isStandardWindow = index === 0;
    if (constrainAppointmentEnd || !isStandardWindow) {
      return input.candidateInterval.endsAt <= window.endsAt;
    }

    // Официальные часы студии: standardWorkEnd — последний допустимый старт.
    return input.candidateInterval.startsAt <= window.endsAt;
  });

  if (!isInsideWorkWindow) {
    conflicts.push({ type: "outside_work_hours" });
  }

  const candidateBusy = toBusyInterval(input.candidateInterval);
  const usePublicBusy = input.usePublicBusyForAppointments === true;

  const activeAppointments = input.appointments.filter(
    (appointment) =>
      isBlockingAppointmentStatus(appointment.status) &&
      intervalsOverlap(
        appointmentBusyInterval(appointment, usePublicBusy),
        candidateBusy,
      ),
  );

  if (activeAppointments.length > 0) {
    conflicts.push({ type: "appointment" });
  }

  const intervalBlocks = input.scheduleBlocks.filter((block) => !block.isFullDay);
  const overlappingBlocks = intervalBlocks.filter((block) =>
    intervalsOverlap(block, candidateBusy),
  );

  if (overlappingBlocks.length > 0) {
    conflicts.push({ type: "block" });
  }

  return {
    isAvailable: conflicts.length === 0,
    conflicts,
  };
}
