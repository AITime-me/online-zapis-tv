import {
  WHEEL_SECTOR_ANGLE,
  WHEEL_SECTOR_COUNT,
  WHEEL_SPIN_MIN_TURNS,
} from "./wheel-ui.constants";
import type {
  WheelContactErrors,
  WheelLeadDraft,
  WheelProcedureIntent,
  WheelSector,
  WheelZone,
} from "./wheel-ui.types";

/** Splits shortLabel into at most two short lines for SVG sectors. */
export function splitSectorLabel(label: string): [string, string?] {
  const trimmed = label.trim();
  if (trimmed.length <= 10) return [trimmed];

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    const mid = Math.ceil(trimmed.length / 2);
    return [trimmed.slice(0, mid), trimmed.slice(mid)];
  }

  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < parts.length; i += 1) {
    const left = parts.slice(0, i).join(" ").length;
    const right = parts.slice(i).join(" ").length;
    const diff = Math.abs(left - right);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }

  return [parts.slice(0, best).join(" "), parts.slice(best).join(" ")];
}

/**
 * Target rotation so sectorId center lands under the top pointer.
 * The wheel does not pick the winner.
 */
export function computeRotationForSector(
  sectorId: string,
  sectors: WheelSector[],
  currentRotationDeg = 0,
  minTurns = WHEEL_SPIN_MIN_TURNS,
): number {
  const index = sectors.findIndex((s) => s.id === sectorId);
  if (index < 0) {
    return currentRotationDeg + 360 * minTurns;
  }

  const sectorCenterFromTop =
    index * WHEEL_SECTOR_ANGLE + WHEEL_SECTOR_ANGLE / 2;
  const landing = (360 - sectorCenterFromTop) % 360;
  const base = Math.ceil(currentRotationDeg / 360) * 360;
  let target = base + 360 * minTurns + landing;

  if (target <= currentRotationDeg) {
    target += 360;
  }

  return target;
}

export function getSectorIndex(
  sectorId: string,
  sectors: WheelSector[],
): number {
  return sectors.findIndex((s) => s.id === sectorId);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isZoneRequired(intent: WheelProcedureIntent | null): boolean {
  return intent !== null && intent !== "undecided";
}

export function canContinuePreferences(
  intent: WheelProcedureIntent | null,
  zone: WheelZone | null,
): boolean {
  if (!intent) return false;
  if (isZoneRequired(intent) && !zone) return false;
  return true;
}

export function countPhoneDigits(phone: string): number {
  return phone.replace(/\D/g, "").length;
}

/** Presentation draft checks; host may replace with PhoneCountrySelect rules. */
export function validateLead(lead: WheelLeadDraft): WheelContactErrors {
  const errors: WheelContactErrors = {};

  if (!lead.name.trim()) {
    errors.name = "Укажите имя";
  }

  if (!lead.phone.trim()) {
    errors.phone = "Укажите телефон";
  } else if (countPhoneDigits(lead.phone) < 10) {
    errors.phone = "Введите номер полностью";
  }

  if (!lead.personalDataConsent) {
    errors.personalDataConsent = "Нужно согласие на обработку данных";
  }

  if (!lead.offerAcknowledgement) {
    errors.offerAcknowledgement = "Подтвердите ознакомление с условиями";
  }

  return errors;
}

export function hasContactErrors(errors: WheelContactErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function assertSectorCount(sectors: WheelSector[]): void {
  if (sectors.length !== WHEEL_SECTOR_COUNT) {
    throw new Error(
      `Ожидается ${WHEEL_SECTOR_COUNT} секторов, получено ${sectors.length}`,
    );
  }
}

export function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

export function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}
