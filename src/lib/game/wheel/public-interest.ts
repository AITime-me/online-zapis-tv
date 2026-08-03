/**
 * Public interest keys for wheel UI/API.
 * Mapped to internal WheelInterestKey used by replacement/zone rules.
 */

import {
  isWheelInterestKey,
  type WheelInterestKey,
} from "@/lib/game/wheel/procedure-types";

export const WHEEL_PUBLIC_INTEREST_KEYS = [
  "lips",
  "brows",
  "eyelids",
  "cover",
  "refresh",
  "undecided",
] as const;

export type WheelPublicInterestKey = (typeof WHEEL_PUBLIC_INTEREST_KEYS)[number];

export const WHEEL_PUBLIC_INTEREST_LABELS: Record<
  WheelPublicInterestKey,
  string
> = {
  lips: "Губы",
  brows: "Брови",
  eyelids: "Веки",
  cover: "Перекрытие чужой работы",
  refresh: "Рефреш",
  undecided: "Пока не определилась",
};

export function isWheelPublicInterestKey(
  value: unknown,
): value is WheelPublicInterestKey {
  return (
    typeof value === "string" &&
    (WHEEL_PUBLIC_INTEREST_KEYS as readonly string[]).includes(value)
  );
}

/** Accept public keys and legacy internal keys from stage 1. */
export function mapToWheelInterestKey(
  value: unknown,
): WheelInterestKey | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  switch (trimmed) {
    case "lips":
      return "lips_permanent";
    case "brows":
      return "brows_permanent";
    case "eyelids":
      return "eyelids_permanent";
    case "cover":
    case "refresh":
    case "undecided":
      return trimmed;
    default:
      return isWheelInterestKey(trimmed) ? trimmed : null;
  }
}

export function wheelInterestToPublicKey(
  interest: WheelInterestKey,
): WheelPublicInterestKey {
  switch (interest) {
    case "lips_permanent":
      return "lips";
    case "brows_permanent":
      return "brows";
    case "eyelids_permanent":
      return "eyelids";
    case "cover":
    case "refresh":
    case "undecided":
      return interest;
  }
}
