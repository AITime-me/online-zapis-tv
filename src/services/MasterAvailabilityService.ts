import type { AppointmentStatus } from "@prisma/client";

export type TimeInterval = {
  startsAt: Date;
  endsAt: Date;
};

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
  extraWorkWindows: TimeInterval[];
  appointments: Array<BusyInterval & { status: AppointmentStatus }>;
  scheduleBlocks: ScheduleBlockInterval[];
  candidateInterval: BusyInterval;
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
    endsAt: new Date(interval.endsAt.getTime() + breakMinutes * 60_000),
  };
}

function intervalsOverlap(left: TimeInterval, right: TimeInterval): boolean {
  return left.startsAt < right.endsAt && right.startsAt < left.endsAt;
}

function parseWorkTimeOnDate(dateKey: string, time: string): Date {
  return new Date(`${dateKey}T${time}:00+05:00`);
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

  const isInsideWorkWindow = workWindows.some(
    (window) =>
      input.candidateInterval.startsAt >= window.startsAt &&
      input.candidateInterval.endsAt <= window.endsAt,
  );

  if (!isInsideWorkWindow) {
    conflicts.push({ type: "outside_work_hours" });
  }

  const candidateBusy = toBusyInterval(input.candidateInterval);

  const activeAppointments = input.appointments.filter(
    (appointment) =>
      appointment.status !== "CANCELLED" &&
      intervalsOverlap(toBusyInterval(appointment), candidateBusy),
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
