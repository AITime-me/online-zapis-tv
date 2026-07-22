/**
 * Appointment timing: busy interval snapshot + central resolver.
 *
 * v1 (legacy): endsAt = procedure end; busyEnd = max(endsAt, start+stdDur) + break
 * v2 (canonical): endsAt = free-at; busyEnd = endsAt
 *
 * Future ICS (not implemented in repo):
 * - client DTEND = startsAt + procedure duration (not + technical break)
 * - staff DTEND = free-at busy end
 */

import { addMinutesSafe } from "@/lib/datetime/date-layer";

export const TIMING_SEMANTICS_VERSION_LEGACY = 1;
export const TIMING_SEMANTICS_VERSION_CANONICAL = 2;

/** Required fields for busy resolution — never Partial. */
export type AppointmentBusyTimingSnapshot = {
  startsAt: Date;
  endsAt: Date;
  timingSemanticsVersion: number;
  breakAfterMinutes: number | null;
  standardBreakAfterMinutes: number | null;
  standardDurationMinutes: number | null;
  isManualTimeOverride: boolean;
};

/** Shared Prisma select for production busy/conflict/slots paths. */
export const APPOINTMENT_BUSY_TIMING_SELECT = {
  startsAt: true,
  endsAt: true,
  timingSemanticsVersion: true,
  breakAfterMinutes: true,
  standardBreakAfterMinutes: true,
  standardDurationMinutes: true,
  isManualTimeOverride: true,
} as const;

export type TimeInterval = {
  startsAt: Date;
  endsAt: Date;
};

function isFiniteDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function normalizeNonNegativeMinutes(
  value: number | null | undefined,
): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.trunc(value));
}

/**
 * Break precedence (plan): breakAfterMinutes ?? standardBreakAfterMinutes ?? 0
 */
export function resolveApplicableBreakMinutes(
  breakAfterMinutes: number | null | undefined,
  standardBreakAfterMinutes: number | null | undefined,
): number {
  return (
    normalizeNonNegativeMinutes(breakAfterMinutes) ??
    normalizeNonNegativeMinutes(standardBreakAfterMinutes) ??
    0
  );
}

function normalizeSemanticsVersion(version: number): number {
  if (
    version === TIMING_SEMANTICS_VERSION_LEGACY ||
    version === TIMING_SEMANTICS_VERSION_CANONICAL
  ) {
    return version;
  }
  // Unknown DB version: fail-closed as legacy v1 (never open early).
  return TIMING_SEMANTICS_VERSION_LEGACY;
}

/**
 * Central busy interval for public and internal availability.
 * Half-open [startsAt, busyEnd). Does not mutate input.
 */
export function getAppointmentBusyInterval(
  snapshot: AppointmentBusyTimingSnapshot,
): TimeInterval {
  if (!isFiniteDate(snapshot.startsAt) || !isFiniteDate(snapshot.endsAt)) {
    const startsAt = isFiniteDate(snapshot.startsAt)
      ? snapshot.startsAt
      : isFiniteDate(snapshot.endsAt)
        ? snapshot.endsAt
        : new Date(NaN);
    const endsAt = isFiniteDate(snapshot.endsAt) ? snapshot.endsAt : startsAt;
    return { startsAt, endsAt };
  }

  if (snapshot.endsAt.getTime() <= snapshot.startsAt.getTime()) {
    // Fail-closed: degenerate interval does not open earlier than startsAt.
    return {
      startsAt: snapshot.startsAt,
      endsAt: snapshot.startsAt,
    };
  }

  const version = normalizeSemanticsVersion(snapshot.timingSemanticsVersion);
  const applicableBreak = resolveApplicableBreakMinutes(
    snapshot.breakAfterMinutes,
    snapshot.standardBreakAfterMinutes,
  );

  if (version === TIMING_SEMANTICS_VERSION_CANONICAL) {
    return {
      startsAt: snapshot.startsAt,
      endsAt: snapshot.endsAt,
    };
  }

  // v1 residual conservative floor (PR #6 safety for remaining legacy rows)
  const standardDuration = normalizeNonNegativeMinutes(
    snapshot.standardDurationMinutes,
  );
  let procedureEnd = snapshot.endsAt;

  if (standardDuration != null) {
    const standardProcedureEnd =
      addMinutesSafe(snapshot.startsAt, standardDuration) ?? snapshot.endsAt;
    if (
      isFiniteDate(standardProcedureEnd) &&
      standardProcedureEnd.getTime() > procedureEnd.getTime()
    ) {
      procedureEnd = standardProcedureEnd;
    }
  }

  const busyEnd =
    addMinutesSafe(procedureEnd, applicableBreak) ?? procedureEnd;

  return {
    startsAt: snapshot.startsAt,
    endsAt: busyEnd,
  };
}

export function toAppointmentBusyTimingSnapshot(
  row: AppointmentBusyTimingSnapshot,
): AppointmentBusyTimingSnapshot {
  return {
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    timingSemanticsVersion: row.timingSemanticsVersion,
    breakAfterMinutes: row.breakAfterMinutes,
    standardBreakAfterMinutes: row.standardBreakAfterMinutes,
    standardDurationMinutes: row.standardDurationMinutes,
    isManualTimeOverride: row.isManualTimeOverride,
  };
}
