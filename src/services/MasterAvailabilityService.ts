import type { AppointmentStatus } from "@prisma/client";
import {
  getAppointmentBusyInterval,
  type AppointmentBusyTimingSnapshot,
  type TimeInterval,
} from "@/lib/schedule/appointment-busy";
import { isBlockingAppointmentStatus } from "@/lib/schedule/non-blocking-appointment-statuses";
import {
  addMinutesSafe,
  getStudioNow,
  parseStudioDateKey,
} from "@/lib/datetime/date-layer";

export type { TimeInterval } from "@/lib/schedule/appointment-busy";

/**
 * Candidate busy interval: endsAt is already the busy free-at (or procedure end
 * with breakAfterMinutes still applied via toBusyInterval).
 */
export type BusyInterval = TimeInterval & {
  breakAfterMinutes?: number | null;
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
  /** Existing appointments — full busy timing snapshot required. */
  appointments: Array<AppointmentBusyTimingSnapshot & { status: AppointmentStatus }>;
  scheduleBlocks: ScheduleBlockInterval[];
  /**
   * New slot candidate. Prefer endsAt = free-at and breakAfterMinutes = 0
   * so break is not applied twice.
   */
  candidateInterval: BusyInterval;
};

export type MasterAvailabilityResult = {
  isAvailable: boolean;
  conflicts: Array<{
    type: "appointment" | "block" | "full_day_block" | "outside_work_hours";
  }>;
};

/**
 * Candidate-only helper: endsAt + optional breakAfterMinutes.
 * Existing Appointment busy MUST use getAppointmentBusyInterval instead.
 */
export function toBusyInterval(interval: BusyInterval): TimeInterval {
  const breakMinutes = Math.max(0, interval.breakAfterMinutes ?? 0);

  return {
    startsAt: interval.startsAt,
    endsAt: addMinutesSafe(interval.endsAt, breakMinutes) ?? interval.endsAt,
  };
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

  const activeAppointments = input.appointments.filter(
    (appointment) =>
      isBlockingAppointmentStatus(appointment.status) &&
      intervalsOverlap(getAppointmentBusyInterval(appointment), candidateBusy),
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
