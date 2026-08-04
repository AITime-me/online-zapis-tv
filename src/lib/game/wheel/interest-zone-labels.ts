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
  if (!isWheelZone(value) || value === "unknown") {
    return null;
  }
  return WHEEL_ZONE_LABELS[value];
}

/**
 * Compact interest + zone label for manager-facing surfaces.
 * Returns null when neither interest nor a concrete zone is present.
 */
export function formatWheelInterestZoneDisplay(input: {
  confirmedInterest?: unknown;
  confirmedZone?: unknown;
}): string | null {
  const interest =
    typeof input.confirmedInterest === "string"
      ? input.confirmedInterest.trim()
      : "";
  const zone =
    typeof input.confirmedZone === "string" ? input.confirmedZone.trim() : "";

  const interestLabel = resolveWheelInterestLabel(interest);
  const zoneLabel = resolveWheelZoneLabel(zone);

  if (interestLabel && zoneLabel) {
    const interestImpliesZone =
      (interest === "lips_permanent" && zone === "lips") ||
      (interest === "brows_permanent" && zone === "brows") ||
      (interest === "eyelids_permanent" && zone === "eyelids");
    if (interestImpliesZone) {
      return interestLabel;
    }
    return `${interestLabel} · ${zoneLabel}`;
  }

  return interestLabel ?? zoneLabel;
}
