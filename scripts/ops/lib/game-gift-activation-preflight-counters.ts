/**
 * Pure counter logic mirroring scripts/ops/lib/game-gift-activation-preflight.sql.
 * Used by security tests — no DB required.
 */

export const HANDS_GIFT_ID = "11111111-1111-4111-8111-111111111111";
export const COURSE_GIFT_IDS = [
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
] as const;

export const GAME_GIFT_ACTIVATION_PREFLIGHT_COUNTER_ORDER = [
  "gift_total",
  "hands_gift_missing_count",
  "course_gifts_missing_count",
  "partial_schema_count",
  "empty_condition_count",
  "course_missing_min_count",
  "hands_gift_mismatch_count",
  "course_gifts_mismatch_count",
] as const;

export type GiftActivationPreflightRow = {
  id: string;
  activationMode?: string | null;
  minCourseSessions?: number | null;
  activationConditionText?: string | null;
};

export type GiftActivationPreflightColumns = {
  hasActivationMode: boolean;
  hasConditionText: boolean;
  hasMinSessions: boolean;
};

export type GiftActivationSchemaForm = "absent" | "present" | "partial";

export type GiftActivationPreflightCounters = {
  gift_total: number;
  hands_gift_missing_count: number;
  course_gifts_missing_count: number;
  partial_schema_count: number;
  empty_condition_count: number;
  course_missing_min_count: number;
  hands_gift_mismatch_count: number;
  course_gifts_mismatch_count: number;
};

/** Mirrors SQL schema_form: 0 → absent, 3 → present, else partial. */
export function giftActivationSchemaForm(
  cols: GiftActivationPreflightColumns,
): GiftActivationSchemaForm {
  const n =
    Number(cols.hasActivationMode) +
    Number(cols.hasConditionText) +
    Number(cols.hasMinSessions);
  if (n === 0) {
    return "absent";
  }
  if (n === 3) {
    return "present";
  }
  return "partial";
}

function missingCount(expected: number, present: number): number {
  if (present === expected) {
    return 0;
  }
  return Math.max(1, Math.abs(expected - present));
}

/**
 * Pure counter mirror of game-gift-activation-preflight.sql.
 * Partial schema returns partial_schema_count=1 (SQL does not abort).
 */
export function computeGameGiftActivationPreflightCounters(
  gifts: readonly GiftActivationPreflightRow[],
  cols: GiftActivationPreflightColumns,
): GiftActivationPreflightCounters {
  const form = giftActivationSchemaForm(cols);
  const postMigration = form === "present";
  const handsPresent = gifts.filter((g) => g.id === HANDS_GIFT_ID).length;
  const coursePresent = gifts.filter((g) =>
    (COURSE_GIFT_IDS as readonly string[]).includes(g.id),
  ).length;

  const empty_condition_count = postMigration
    ? gifts.filter((g) => !(g.activationConditionText ?? "").trim()).length
    : 0;

  const course_missing_min_count = postMigration
    ? gifts.filter(
        (g) =>
          g.activationMode === "COURSE_MIN_SESSIONS" &&
          (g.minCourseSessions == null ||
            g.minCourseSessions < 1 ||
            g.minCourseSessions > 100),
      ).length
    : 0;

  const hands_gift_mismatch_count = postMigration
    ? gifts.filter(
        (g) =>
          g.id === HANDS_GIFT_ID &&
          (g.activationMode !== "SINGLE_PAID_SERVICE" ||
            !(g.activationConditionText ?? "").trim()),
      ).length
    : 0;

  const course_gifts_mismatch_count = postMigration
    ? gifts.filter(
        (g) =>
          (COURSE_GIFT_IDS as readonly string[]).includes(g.id) &&
          (g.activationMode !== "COURSE_MIN_SESSIONS" ||
            (g.minCourseSessions ?? 0) !== 5),
      ).length
    : 0;

  return {
    gift_total: gifts.length,
    hands_gift_missing_count: missingCount(1, handsPresent),
    course_gifts_missing_count: missingCount(3, coursePresent),
    partial_schema_count: form === "partial" ? 1 : 0,
    empty_condition_count,
    course_missing_min_count,
    hands_gift_mismatch_count,
    course_gifts_mismatch_count,
  };
}

export function preflightCountersAreClean(
  counters: GiftActivationPreflightCounters,
): boolean {
  return (
    counters.hands_gift_missing_count === 0 &&
    counters.course_gifts_missing_count === 0 &&
    counters.partial_schema_count === 0 &&
    counters.empty_condition_count === 0 &&
    counters.course_missing_min_count === 0 &&
    counters.hands_gift_mismatch_count === 0 &&
    counters.course_gifts_mismatch_count === 0
  );
}

/** Parse one tab-separated psql -At row into counters (or null if shape is wrong). */
export function parseGameGiftActivationPreflightPsqlRow(
  line: string,
): GiftActivationPreflightCounters | null {
  const parts = line.trim().split("\t");
  if (parts.length !== GAME_GIFT_ACTIVATION_PREFLIGHT_COUNTER_ORDER.length) {
    return null;
  }
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0)) {
    return null;
  }
  return {
    gift_total: nums[0]!,
    hands_gift_missing_count: nums[1]!,
    course_gifts_missing_count: nums[2]!,
    partial_schema_count: nums[3]!,
    empty_condition_count: nums[4]!,
    course_missing_min_count: nums[5]!,
    hands_gift_mismatch_count: nums[6]!,
    course_gifts_mismatch_count: nums[7]!,
  };
}
