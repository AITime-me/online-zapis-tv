import type { WheelInterestKey } from "@/lib/game/wheel/procedure-types";
import {
  isConfirmedNonLipsZone,
  isWheelZone,
  type WheelZone,
} from "@/lib/game/wheel/zone-types";

/**
 * cover / refresh do not encode a zone by themselves — zone must be confirmed separately.
 */
export function interestRequiresExplicitZone(
  interest: WheelInterestKey | null | undefined,
): boolean {
  return interest === "cover" || interest === "refresh";
}

/**
 * Resolve confirmed zone from interest + optional explicit zone.
 * Returns null when interest is absent.
 * Returns "unknown" when interest is present but zone is not confirmed
 * (undecided, cover/refresh without zone).
 */
export function resolveConfirmedZone(input: {
  confirmedInterest: WheelInterestKey | null;
  confirmedZone?: unknown;
}): WheelZone | null {
  const interest = input.confirmedInterest;
  if (!interest) {
    return null;
  }

  if (interest === "lips_permanent") {
    return "lips";
  }
  if (interest === "brows_permanent") {
    return "brows";
  }
  if (interest === "eyelids_permanent") {
    return "eyelids";
  }
  if (interest === "undecided") {
    return "unknown";
  }

  if (interestRequiresExplicitZone(interest)) {
    if (isWheelZone(input.confirmedZone) && input.confirmedZone !== "unknown") {
      return input.confirmedZone;
    }
    return "unknown";
  }

  return "unknown";
}

/**
 * Replacement of a lips-restricted prize by confirmed zone is allowed only
 * for an explicit non-lips zone. Undecided is handled separately in
 * resolvePrizeReplacement because interest is locked at spin.
 */
export function canReplaceLipsRestrictedPrize(
  zone: WheelZone | null | undefined,
): boolean {
  return isConfirmedNonLipsZone(zone);
}

export function validateClaimZoneForInterest(input: {
  interest: WheelInterestKey;
  confirmedZone?: unknown;
}):
  | { ok: true; confirmedZone: WheelZone }
  | { ok: false; error: string } {
  const zone = resolveConfirmedZone({
    confirmedInterest: input.interest,
    confirmedZone: input.confirmedZone,
  });

  if (zone === null) {
    return { ok: false, error: "Не удалось определить зону" };
  }

  if (interestRequiresExplicitZone(input.interest) && zone === "unknown") {
    return {
      ok: false,
      error:
        "Для перекрытия или рефреша укажите зону: lips, brows или eyelids",
    };
  }

  // Zone is required only when needed; for brows/lips/eyelids/undecided we accept.
  // Claim may still proceed with unknown for undecided — replacement will not apply.
  if (
    input.confirmedZone !== undefined &&
    input.confirmedZone !== null &&
    !isWheelZone(input.confirmedZone)
  ) {
    return {
      ok: false,
      error: "confirmedZone должен быть одним из: lips, brows, eyelids, unknown",
    };
  }

  return { ok: true, confirmedZone: zone };
}
