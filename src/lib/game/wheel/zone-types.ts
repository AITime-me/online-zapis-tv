/**
 * Zone confirmation for zonal prizes (e.g. lips biorevitalizant).
 * Interest alone is not always enough: cover/refresh need an explicit zone.
 */

export const WHEEL_ZONES = ["lips", "brows", "eyelids", "unknown"] as const;

export type WheelZone = (typeof WHEEL_ZONES)[number];

export function isWheelZone(value: unknown): value is WheelZone {
  return (
    typeof value === "string" &&
    (WHEEL_ZONES as readonly string[]).includes(value)
  );
}

/** Zones that are explicitly not lips — only these may trigger replacement. */
export function isConfirmedNonLipsZone(zone: WheelZone | null | undefined): boolean {
  return zone === "brows" || zone === "eyelids";
}

export function isConfirmedLipsZone(zone: WheelZone | null | undefined): boolean {
  return zone === "lips";
}
