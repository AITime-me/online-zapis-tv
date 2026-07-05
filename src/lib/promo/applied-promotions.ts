import { buildStoredAppliedPromotions, type RulesEngineInput } from "@/lib/promo/rules-engine";
import type { AppliedPromotionRecord } from "@/types/applied-promotion";

export type { AppliedPromotionRecord };

function isAppliedPromotionRecord(value: unknown): value is AppliedPromotionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.type === "string" &&
    typeof record.label === "string" &&
    (record.value === null || typeof record.value === "number")
  );
}

/** Нормализует JSON из БД в типизированный массив акций. */
export function parseAppliedPromotions(value: unknown): AppliedPromotionRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isAppliedPromotionRecord);
}

export function evaluateStoredAppliedPromotions(
  input: RulesEngineInput,
): AppliedPromotionRecord[] {
  return buildStoredAppliedPromotions(input);
}
