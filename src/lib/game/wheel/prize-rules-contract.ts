import {
  isWheelProcedureType,
  type WheelProcedureType,
} from "@/lib/game/wheel/procedure-types";
import {
  isGamePrizeType,
  type GamePrizeType,
} from "@/lib/game/wheel/prize-types";

export const PRIZE_RULES_VERSION = 1 as const;
export const MAX_PRIZE_SYSTEM_KEY_LENGTH = 64;
export const MAX_PRIZE_TERMS_LENGTH = 2000;
export const MAX_FALLBACK_KEY_LENGTH = 64;

export type PrizeReplacementRuleV1 = {
  enabled: boolean;
  fallbackSystemKey: string;
  /**
   * Replacement is offered only after the client confirms a non-lips interest.
   * Never auto-apply without confirmed client choice.
   */
  requiresConfirmedInterest: true;
  trigger: "interest_not_lips";
};

export type PrizeRulesV1 = {
  version: 1;
  prizeType: GamePrizeType;
  systemKey: string;
  discountPercent: number | null;
  applicableProcedures: WheelProcedureType[];
  excludedProcedures: WheelProcedureType[];
  /** Zero surcharge for SERVICE_UPGRADE (e.g. biorevitalizant). */
  upgradeSurcharge: number | null;
  stackingWithOtherDiscounts: boolean;
  stackingWithOtherGifts: boolean;
  cashRedemptionForbidden: boolean;
  zoneRestriction: "lips" | null;
  replacement: PrizeReplacementRuleV1 | null;
  termsText: string;
  confirmWindowDays: number | null;
  procedureWindowDays: number | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

function readNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const n = Math.trunc(value);
  return n >= 0 ? n : null;
}

function readProcedureList(value: unknown): WheelProcedureType[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const out: WheelProcedureType[] = [];
  for (const item of value) {
    if (!isWheelProcedureType(item)) {
      return null;
    }
    if (!out.includes(item)) {
      out.push(item);
    }
  }
  return out;
}

export function parsePrizeRules(raw: unknown): PrizeRulesV1 | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (raw.version !== PRIZE_RULES_VERSION) {
    return null;
  }
  if (!isGamePrizeType(raw.prizeType)) {
    return null;
  }
  const systemKey = readNonEmptyString(raw.systemKey, MAX_PRIZE_SYSTEM_KEY_LENGTH);
  if (!systemKey) {
    return null;
  }

  let discountPercent: number | null = null;
  if (raw.discountPercent !== undefined && raw.discountPercent !== null) {
    const parsed = readNonNegativeInt(raw.discountPercent);
    if (parsed === null || parsed > 100) {
      return null;
    }
    discountPercent = parsed;
  }

  const applicable = readProcedureList(raw.applicableProcedures ?? []);
  const excluded = readProcedureList(raw.excludedProcedures ?? []);
  if (!applicable || !excluded) {
    return null;
  }

  let upgradeSurcharge: number | null = null;
  if (raw.upgradeSurcharge !== undefined && raw.upgradeSurcharge !== null) {
    const parsed = readNonNegativeInt(raw.upgradeSurcharge);
    if (parsed === null) {
      return null;
    }
    upgradeSurcharge = parsed;
  }

  if (typeof raw.stackingWithOtherDiscounts !== "boolean") {
    return null;
  }
  if (typeof raw.stackingWithOtherGifts !== "boolean") {
    return null;
  }
  if (typeof raw.cashRedemptionForbidden !== "boolean") {
    return null;
  }

  let zoneRestriction: "lips" | null = null;
  if (raw.zoneRestriction !== undefined && raw.zoneRestriction !== null) {
    if (raw.zoneRestriction !== "lips") {
      return null;
    }
    zoneRestriction = "lips";
  }

  let replacement: PrizeReplacementRuleV1 | null = null;
  if (raw.replacement !== undefined && raw.replacement !== null) {
    if (!isPlainObject(raw.replacement)) {
      return null;
    }
    if (typeof raw.replacement.enabled !== "boolean") {
      return null;
    }
    const fallbackSystemKey = readNonEmptyString(
      raw.replacement.fallbackSystemKey,
      MAX_FALLBACK_KEY_LENGTH,
    );
    if (!fallbackSystemKey) {
      return null;
    }
    if (raw.replacement.requiresConfirmedInterest !== true) {
      return null;
    }
    if (raw.replacement.trigger !== "interest_not_lips") {
      return null;
    }
    replacement = {
      enabled: raw.replacement.enabled,
      fallbackSystemKey,
      requiresConfirmedInterest: true,
      trigger: "interest_not_lips",
    };
  }

  const termsText =
    typeof raw.termsText === "string"
      ? raw.termsText.trim().slice(0, MAX_PRIZE_TERMS_LENGTH)
      : "";

  let confirmWindowDays: number | null = null;
  if (raw.confirmWindowDays !== undefined && raw.confirmWindowDays !== null) {
    confirmWindowDays = readNonNegativeInt(raw.confirmWindowDays);
    if (confirmWindowDays === null || confirmWindowDays < 1) {
      return null;
    }
  }

  let procedureWindowDays: number | null = null;
  if (
    raw.procedureWindowDays !== undefined &&
    raw.procedureWindowDays !== null
  ) {
    procedureWindowDays = readNonNegativeInt(raw.procedureWindowDays);
    if (procedureWindowDays === null || procedureWindowDays < 1) {
      return null;
    }
  }

  if (raw.prizeType === "PERCENT_DISCOUNT" && discountPercent === null) {
    return null;
  }
  if (raw.prizeType === "SERVICE_UPGRADE" && upgradeSurcharge === null) {
    return null;
  }

  return {
    version: 1,
    prizeType: raw.prizeType,
    systemKey,
    discountPercent,
    applicableProcedures: applicable,
    excludedProcedures: excluded,
    upgradeSurcharge,
    stackingWithOtherDiscounts: raw.stackingWithOtherDiscounts,
    stackingWithOtherGifts: raw.stackingWithOtherGifts,
    cashRedemptionForbidden: raw.cashRedemptionForbidden,
    zoneRestriction,
    replacement,
    termsText,
    confirmWindowDays,
    procedureWindowDays,
  };
}

export function prizeRulesToJson(rules: PrizeRulesV1): PrizeRulesV1 {
  return {
    version: 1,
    prizeType: rules.prizeType,
    systemKey: rules.systemKey,
    discountPercent: rules.discountPercent,
    applicableProcedures: [...rules.applicableProcedures],
    excludedProcedures: [...rules.excludedProcedures],
    upgradeSurcharge: rules.upgradeSurcharge,
    stackingWithOtherDiscounts: rules.stackingWithOtherDiscounts,
    stackingWithOtherGifts: rules.stackingWithOtherGifts,
    cashRedemptionForbidden: rules.cashRedemptionForbidden,
    zoneRestriction: rules.zoneRestriction,
    replacement: rules.replacement
      ? {
          enabled: rules.replacement.enabled,
          fallbackSystemKey: rules.replacement.fallbackSystemKey,
          requiresConfirmedInterest: true,
          trigger: "interest_not_lips",
        }
      : null,
    termsText: rules.termsText,
    confirmWindowDays: rules.confirmWindowDays,
    procedureWindowDays: rules.procedureWindowDays,
  };
}
