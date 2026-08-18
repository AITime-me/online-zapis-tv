import type { PrizeRulesV1 } from "@/lib/game/wheel/prize-rules-contract";
import type { WheelInterestKey } from "@/lib/game/wheel/procedure-types";
import {
  canReplaceLipsRestrictedPrize,
  resolveConfirmedZone,
} from "@/lib/game/wheel/zone-resolution";
import type { WheelZone } from "@/lib/game/wheel/zone-types";

export type PrizeIdentity = {
  systemKey: string;
  giftId: string;
  name: string;
};

export type PrizeReplacementReason =
  | "confirmed_non_lips_zone"
  | "undecided_interest";

export function isPrizeReplacementReason(
  value: unknown,
): value is PrizeReplacementReason {
  return value === "confirmed_non_lips_zone" || value === "undecided_interest";
}

export type PrizeReplacementDecision =
  | {
      replaced: false;
      original: PrizeIdentity;
      final: PrizeIdentity;
      confirmedInterest: WheelInterestKey | null;
      confirmedZone: WheelZone | null;
      replacementReason: null;
      replacedAt: null;
    }
  | {
      replaced: true;
      original: PrizeIdentity;
      final: PrizeIdentity;
      fallbackSystemKey: string;
      confirmedInterest: WheelInterestKey;
      confirmedZone: WheelZone;
      replacementReason: PrizeReplacementReason;
      replacedAt: string;
    };

/**
 * Biorevitalizant → hand care replacement.
 * Never auto-applies until a non-lips zone is explicitly confirmed.
 *
 * - brows_permanent / eyelids_permanent → replace
 * - lips_permanent → keep
 * - cover / refresh without zone → keep
 * - cover / refresh + lips → keep
 * - cover / refresh + brows|eyelids → replace
 * - undecided → replace (intent is locked at spin; lips-only would be a dead end)
 * - null → keep
 */
export function resolvePrizeReplacement(input: {
  original: PrizeIdentity;
  originalRules: PrizeRulesV1;
  confirmedInterest: WheelInterestKey | null;
  confirmedZone?: unknown;
  fallbackPrize: PrizeIdentity | null;
  now?: Date;
}): PrizeReplacementDecision {
  const { original, originalRules, confirmedInterest, fallbackPrize } = input;
  const confirmedZone = resolveConfirmedZone({
    confirmedInterest,
    confirmedZone: input.confirmedZone,
  });
  const baseNoReplace = {
    replaced: false as const,
    original,
    final: original,
    confirmedInterest,
    confirmedZone,
    replacementReason: null,
    replacedAt: null,
  };

  if (!confirmedInterest) {
    return baseNoReplace;
  }

  const replacement = originalRules.replacement;
  if (!replacement?.enabled) {
    return baseNoReplace;
  }

  if (replacement.trigger !== "interest_not_lips") {
    return baseNoReplace;
  }

  if (!replacement.requiresConfirmedInterest) {
    return baseNoReplace;
  }

  const replaceForUndecided = confirmedInterest === "undecided";
  if (!replaceForUndecided && !canReplaceLipsRestrictedPrize(confirmedZone)) {
    return baseNoReplace;
  }

  if (!fallbackPrize) {
    return baseNoReplace;
  }

  if (fallbackPrize.systemKey !== replacement.fallbackSystemKey) {
    return baseNoReplace;
  }

  const now = input.now ?? new Date();

  return {
    replaced: true,
    original,
    final: fallbackPrize,
    fallbackSystemKey: replacement.fallbackSystemKey,
    confirmedInterest,
    confirmedZone: confirmedZone ?? "unknown",
    replacementReason: replaceForUndecided
      ? "undecided_interest"
      : "confirmed_non_lips_zone",
    replacedAt: now.toISOString(),
  };
}
