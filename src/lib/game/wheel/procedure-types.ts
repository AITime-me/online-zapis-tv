/**
 * Procedure kinds used by wheel prize eligibility rules.
 * Cover of another artist's work is treated as a primary participating procedure.
 */

export const WHEEL_PROCEDURE_TYPES = [
  "permanent_primary",
  "cover",
  "refresh",
  "correction",
  "removal",
  "lips_permanent_primary",
  "lips_cover",
  "lips_refresh",
  "lips_correction",
] as const;

export type WheelProcedureType = (typeof WHEEL_PROCEDURE_TYPES)[number];

export function isWheelProcedureType(
  value: unknown,
): value is WheelProcedureType {
  return (
    typeof value === "string" &&
    (WHEEL_PROCEDURE_TYPES as readonly string[]).includes(value)
  );
}

export const WHEEL_PROCEDURE_TYPE_LABELS: Record<WheelProcedureType, string> = {
  permanent_primary: "Первичный перманент",
  cover: "Перекрытие чужой работы",
  refresh: "Рефреш",
  correction: "Коррекция",
  removal: "Удаление",
  lips_permanent_primary: "Первичный перманент губ",
  lips_cover: "Перекрытие чужой работы на губах",
  lips_refresh: "Рефреш губ",
  lips_correction: "Коррекция губ",
};

/** Client interest after win — not a procedure booking yet. */
export const WHEEL_INTEREST_KEYS = [
  "brows_permanent",
  "lips_permanent",
  "eyelids_permanent",
  "cover",
  "refresh",
  "undecided",
] as const;

export type WheelInterestKey = (typeof WHEEL_INTEREST_KEYS)[number];

export function isWheelInterestKey(value: unknown): value is WheelInterestKey {
  return (
    typeof value === "string" &&
    (WHEEL_INTEREST_KEYS as readonly string[]).includes(value)
  );
}

export const WHEEL_INTEREST_LABELS: Record<WheelInterestKey, string> = {
  brows_permanent: "Перманент бровей",
  lips_permanent: "Перманент губ",
  eyelids_permanent: "Перманент век",
  cover: "Перекрытие чужой работы",
  refresh: "Рефреш",
  undecided: "Пока не определилась",
};

/**
 * @deprecated Prefer resolveConfirmedZone — cover/refresh/undecided are not lips-definite.
 * Kept as a narrow helper for lips_permanent only.
 */
export function interestImpliesLipsZone(interest: WheelInterestKey): boolean {
  return interest === "lips_permanent";
}
