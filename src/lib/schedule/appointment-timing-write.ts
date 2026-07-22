/**
 * Central timing write adapter for Appointment endsAt semantics.
 * Sole production builder of timing storage fields (Phase 1).
 */

import { addMinutesSafe, diffMinutes } from "@/lib/datetime/date-layer";
import {
  getAppointmentBusyInterval,
  resolveApplicableBreakMinutes,
  TIMING_SEMANTICS_VERSION_CANONICAL,
  TIMING_SEMANTICS_VERSION_LEGACY,
  type AppointmentBusyTimingSnapshot,
} from "@/lib/schedule/appointment-busy";
import { isAppointmentFullBusyEndWritesEnabled } from "@/lib/schedule/appointment-full-busy-writes";

export type LegacyTimingClass =
  | "exact_procedure_only"
  | "exact_already_full"
  | "manual_override"
  | "ambiguous"
  | "missing_duration_snapshot"
  | "non_minute_aligned"
  | "non_positive_interval"
  | "invalid_negative_break";

export type AppointmentTimingWriteInput = {
  startsAt: Date;
  desiredFreeAt: Date;
  /** Catalog / resolved service duration (procedure only). */
  standardDurationMinutes: number | null;
  standardBreakAfterMinutes: number | null;
  /** Applied break snapshot to store. */
  breakAfterMinutes: number | null;
  existing?: AppointmentBusyTimingSnapshot | null;
  /** When false, force evaluating as create (no existing). */
  isUpdate?: boolean;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  now?: Date;
};

export type AppointmentTimingWriteData = {
  endsAt: Date;
  timingSemanticsVersion: number;
  timingCanonicalStoredAt: Date | null;
  serviceDurationMinutes: number;
  breakAfterMinutes: number;
  standardDurationMinutes: number | null;
  standardBreakAfterMinutes: number | null;
  isManualTimeOverride: boolean;
};

export class AppointmentTimingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppointmentTimingValidationError";
  }
}

function isFiniteDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isMinuteAligned(date: Date): boolean {
  if (!isFiniteDate(date)) {
    return false;
  }
  return date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
}

function wallSeconds(startsAt: Date, endsAt: Date): number | null {
  if (!isFiniteDate(startsAt) || !isFiniteDate(endsAt)) {
    return null;
  }
  return (endsAt.getTime() - startsAt.getTime()) / 1000;
}

/**
 * Classify existing v1 (or any) row for write/backfill decisions.
 * Primary bucket is exclusive (CASE order from plan).
 */
export function classifyLegacyTimingRow(
  snapshot: AppointmentBusyTimingSnapshot,
): LegacyTimingClass {
  const wall = wallSeconds(snapshot.startsAt, snapshot.endsAt);
  if (wall == null || wall <= 0) {
    return "non_positive_interval";
  }

  const rawBreak = snapshot.breakAfterMinutes;
  const rawStdBreak = snapshot.standardBreakAfterMinutes;
  if (
    (rawBreak != null && Number.isFinite(rawBreak) && rawBreak < 0) ||
    (rawStdBreak != null && Number.isFinite(rawStdBreak) && rawStdBreak < 0)
  ) {
    return "invalid_negative_break";
  }

  if (!isMinuteAligned(snapshot.startsAt) || !isMinuteAligned(snapshot.endsAt)) {
    return "non_minute_aligned";
  }

  if (snapshot.isManualTimeOverride) {
    return "manual_override";
  }

  if (
    snapshot.standardDurationMinutes == null ||
    !Number.isFinite(snapshot.standardDurationMinutes)
  ) {
    return "missing_duration_snapshot";
  }

  const std = Math.trunc(snapshot.standardDurationMinutes);
  if (std < 0) {
    return "missing_duration_snapshot";
  }

  const applicableBreak = resolveApplicableBreakMinutes(
    snapshot.breakAfterMinutes,
    snapshot.standardBreakAfterMinutes,
  );
  const expectedProc = std * 60;
  const expectedFull = (std + applicableBreak) * 60;

  if (wall === expectedProc) {
    return "exact_procedure_only";
  }
  if (wall === expectedFull) {
    return "exact_already_full";
  }
  return "ambiguous";
}

export function isExactStandardFreeAt(
  startsAt: Date,
  desiredFreeAt: Date,
  standardDurationMinutes: number | null,
  applicableBreak: number,
): boolean {
  if (
    standardDurationMinutes == null ||
    !Number.isFinite(standardDurationMinutes) ||
    standardDurationMinutes < 0
  ) {
    return false;
  }
  const expected =
    addMinutesSafe(
      startsAt,
      Math.trunc(standardDurationMinutes) + applicableBreak,
    ) ?? null;
  if (!expected) {
    return false;
  }
  return expected.getTime() === desiredFreeAt.getTime();
}

/**
 * Compare business timing using getTime() — no fuzzy tolerance.
 */
export function isAppointmentTimingDirty(input: {
  current: AppointmentBusyTimingSnapshot;
  currentServiceId: string | null;
  currentMasterId: string;
  currentDateKey: string;
  desiredStartsAt: Date;
  desiredFreeAt: Date;
  desiredServiceId: string | null;
  desiredMasterId: string;
  desiredDateKey: string;
  forceTimingDirty?: boolean;
}): boolean {
  if (input.forceTimingDirty) {
    return true;
  }

  const currentFreeAt = getAppointmentBusyInterval(input.current).endsAt;

  if (input.desiredStartsAt.getTime() !== input.current.startsAt.getTime()) {
    return true;
  }
  if (input.desiredFreeAt.getTime() !== currentFreeAt.getTime()) {
    return true;
  }
  if ((input.desiredServiceId ?? null) !== (input.currentServiceId ?? null)) {
    return true;
  }
  if (input.desiredMasterId !== input.currentMasterId) {
    return true;
  }
  if (input.desiredDateKey !== input.currentDateKey) {
    return true;
  }
  return false;
}

export function buildAppointmentTimingWriteData(
  input: AppointmentTimingWriteInput,
): AppointmentTimingWriteData {
  const { startsAt, desiredFreeAt } = input;

  if (!isFiniteDate(startsAt) || !isFiniteDate(desiredFreeAt)) {
    throw new AppointmentTimingValidationError(
      "Некорректные дата или время записи",
    );
  }
  if (desiredFreeAt.getTime() <= startsAt.getTime()) {
    throw new AppointmentTimingValidationError(
      "Окончание должно быть позже начала",
    );
  }

  const applicableBreak = resolveApplicableBreakMinutes(
    input.breakAfterMinutes,
    input.standardBreakAfterMinutes,
  );
  const standardDuration =
    input.standardDurationMinutes != null &&
    Number.isFinite(input.standardDurationMinutes)
      ? Math.max(0, Math.trunc(input.standardDurationMinutes))
      : null;
  const standardBreak =
    input.standardBreakAfterMinutes != null &&
    Number.isFinite(input.standardBreakAfterMinutes)
      ? Math.max(0, Math.trunc(input.standardBreakAfterMinutes))
      : null;

  const isStandardResult = isExactStandardFreeAt(
    startsAt,
    desiredFreeAt,
    standardDuration,
    applicableBreak,
  );
  const isManualTimeOverride = !isStandardResult;

  const flagOn = isAppointmentFullBusyEndWritesEnabled(input.env);
  const now = input.now ?? new Date();
  const existing = input.existing ?? null;
  const existingVersion = existing?.timingSemanticsVersion ?? null;

  let storeAsCanonicalV2 = false;

  if (existingVersion === TIMING_SEMANTICS_VERSION_CANONICAL) {
    // once-v2-always-v2
    storeAsCanonicalV2 = true;
  } else if (!existing) {
    // new create
    storeAsCanonicalV2 = isManualTimeOverride || flagOn;
  } else {
    const legacyClass = classifyLegacyTimingRow(existing);
    if (
      legacyClass === "manual_override" ||
      existing.isManualTimeOverride ||
      isManualTimeOverride
    ) {
      storeAsCanonicalV2 = true;
    } else if (
      legacyClass === "ambiguous" ||
      legacyClass === "missing_duration_snapshot" ||
      legacyClass === "non_minute_aligned" ||
      legacyClass === "non_positive_interval" ||
      legacyClass === "invalid_negative_break"
    ) {
      storeAsCanonicalV2 = true;
    } else if (legacyClass === "exact_already_full") {
      storeAsCanonicalV2 = true;
    } else if (legacyClass === "exact_procedure_only") {
      if (isManualTimeOverride) {
        storeAsCanonicalV2 = true;
      } else if (flagOn) {
        storeAsCanonicalV2 = true;
      } else if (isStandardResult) {
        storeAsCanonicalV2 = false;
      } else {
        storeAsCanonicalV2 = true;
      }
    } else {
      storeAsCanonicalV2 = true;
    }
  }

  let endsAt: Date;
  let timingSemanticsVersion: number;
  let timingCanonicalStoredAt: Date | null;

  if (storeAsCanonicalV2) {
    endsAt = desiredFreeAt;
    timingSemanticsVersion = TIMING_SEMANTICS_VERSION_CANONICAL;
    timingCanonicalStoredAt = now;
  } else {
    // Legacy encode: only exact standard procedure-only path
    if (!isStandardResult) {
      throw new AppointmentTimingValidationError(
        "Нельзя сохранить нестандартное время в legacy-формате",
      );
    }
    const stored = addMinutesSafe(desiredFreeAt, -applicableBreak);
    if (!stored || stored.getTime() <= startsAt.getTime()) {
      throw new AppointmentTimingValidationError(
        "Некорректный интервал после учёта перерыва",
      );
    }
    endsAt = stored;
    timingSemanticsVersion = TIMING_SEMANTICS_VERSION_LEGACY;
    timingCanonicalStoredAt = null;
  }

  const serviceDurationMinutes = isManualTimeOverride
    ? Math.max(1, diffMinutes(startsAt, desiredFreeAt))
    : (standardDuration ?? Math.max(1, diffMinutes(startsAt, desiredFreeAt)));

  return {
    endsAt,
    timingSemanticsVersion,
    timingCanonicalStoredAt,
    serviceDurationMinutes,
    breakAfterMinutes: applicableBreak,
    standardDurationMinutes: standardDuration,
    standardBreakAfterMinutes: standardBreak,
    isManualTimeOverride,
  };
}
