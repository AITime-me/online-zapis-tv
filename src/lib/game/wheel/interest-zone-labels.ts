import {
  WHEEL_INTEREST_LABELS,
  isWheelInterestKey,
} from "@/lib/game/wheel/procedure-types";
import {
  WHEEL_PUBLIC_INTEREST_LABELS,
  isWheelPublicInterestKey,
} from "@/lib/game/wheel/public-interest";
import { isWheelZone, type WheelZone } from "@/lib/game/wheel/zone-types";

const WHEEL_ZONE_LABELS: Record<Exclude<WheelZone, "unknown">, string> = {
  lips: "Губы",
  brows: "Брови",
  eyelids: "Веки",
};

export function resolveWheelInterestLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (isWheelInterestKey(trimmed)) {
    return WHEEL_INTEREST_LABELS[trimmed];
  }
  if (isWheelPublicInterestKey(trimmed)) {
    return WHEEL_PUBLIC_INTEREST_LABELS[trimmed];
  }
  return null;
}

export function resolveWheelZoneLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "lips" || trimmed === "brows" || trimmed === "eyelids") {
    return WHEEL_ZONE_LABELS[trimmed];
  }
  if (trimmed === "Губы" || trimmed === "Брови" || trimmed === "Веки") {
    return trimmed;
  }
  if (!isWheelZone(trimmed) || trimmed === "unknown") {
    return null;
  }
  return WHEEL_ZONE_LABELS[trimmed];
}

/**
 * Compact interest + zone label for manager-facing surfaces.
 * Returns null when neither interest nor a concrete zone is present.
 */
export function formatWheelInterestZoneDisplay(input: {
  confirmedInterest?: unknown;
  confirmedZone?: unknown;
}): string | null {
  const interestLabel = resolveWheelInterestLabel(input.confirmedInterest);
  const zoneLabel = resolveWheelZoneLabel(input.confirmedZone);

  if (interestLabel && zoneLabel) {
    const interest =
      typeof input.confirmedInterest === "string"
        ? input.confirmedInterest.trim()
        : "";
    const zone =
      typeof input.confirmedZone === "string" ? input.confirmedZone.trim() : "";
    const interestImpliesZone =
      (interest === "lips_permanent" && zone === "lips") ||
      (interest === "brows_permanent" && zone === "brows") ||
      (interest === "eyelids_permanent" && zone === "eyelids") ||
      (interest === "lips" && zone === "lips") ||
      (interest === "brows" && zone === "brows") ||
      (interest === "eyelids" && zone === "eyelids");
    if (interestImpliesZone) {
      return interestLabel;
    }
    return `${interestLabel} · ${zoneLabel}`;
  }

  return interestLabel ?? zoneLabel;
}
