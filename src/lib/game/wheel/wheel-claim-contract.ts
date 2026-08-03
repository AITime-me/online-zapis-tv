/**
 * Future wheel claim → BookingRequest contract (stage 1: types + validation only).
 * No Client/Appointment creation on spin; claim happens after contacts + consents + interest.
 */

import {
  isWheelInterestKey,
  type WheelInterestKey,
} from "@/lib/game/wheel/procedure-types";
import { validateClaimZoneForInterest } from "@/lib/game/wheel/zone-resolution";
import type { WheelZone } from "@/lib/game/wheel/zone-types";
import type { PrizeReplacementReason } from "@/lib/game/wheel/prize-replacement";

/** Compatible with existing analytics; catch-time uses the same source today. */
export const WHEEL_BOOKING_SOURCE = "procedure_gift_game" as const;

export type WheelWinUsageStatus =
  | "unused"
  | "reserved"
  | "used"
  | "expired"
  | "replaced";

export type WheelClaimPrizeRef = {
  systemKey: string;
  giftId: string;
  name: string;
  prizeType: string;
};

export type WheelClaimContractV1 = {
  version: 1;
  source: typeof WHEEL_BOOKING_SOURCE;
  gameCatalogId: string;
  gamePlayId: string;
  gameTitle: string;
  campaignKey: string | null;
  originalPrize: WheelClaimPrizeRef;
  finalPrize: WheelClaimPrizeRef;
  replacementApplied: boolean;
  replacementReason: PrizeReplacementReason | null;
  selectedInterest: WheelInterestKey;
  confirmedZone: WheelZone;
  replacedAt: string | null;
  clientName: string;
  clientPhone: string;
  normalizedPhone: string;
  existingClientId: string | null;
  possibleDuplicate: boolean;
  confirmExpiresAt: string;
  procedureExpiresAt: string;
  winUsageStatus: WheelWinUsageStatus;
  giftSnapshot: Record<string, unknown>;
  rulesSnapshot: Record<string, unknown>;
  personalDataConsent: true;
  offerAcknowledgement: true;
};

export type WheelClaimInputBody = {
  gamePlayId?: unknown;
  catalogSlug?: unknown;
  name?: unknown;
  phone?: unknown;
  selectedInterest?: unknown;
  /** Required only for cover/refresh (zonal prizes). */
  confirmedZone?: unknown;
  /** Forbidden client fields — rejected if present. */
  prizeId?: unknown;
  sectorId?: unknown;
  sectorIndex?: unknown;
  giftId?: unknown;
  originalPrize?: unknown;
  finalPrize?: unknown;
  personalDataConsent?: unknown;
  offerAcknowledgement?: unknown;
};

const FORBIDDEN_CLAIM_KEYS = [
  "prizeId",
  "sectorId",
  "sectorIndex",
  "giftId",
  "giftSnapshot",
  "originalPrize",
  "finalPrize",
  "prizeSystemKey",
  "campaignKey",
  "winUsageStatus",
  "replacementReason",
  "replacedAt",
] as const;

export function collectForbiddenWheelClaimKeys(
  body: Record<string, unknown>,
): string[] {
  return FORBIDDEN_CLAIM_KEYS.filter((key) => key in body);
}

export function rejectForbiddenWheelClaimFields(
  body: unknown,
): { ok: true } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: true };
  }
  const forbidden = collectForbiddenWheelClaimKeys(
    body as Record<string, unknown>,
  );
  if (forbidden.length === 0) {
    return { ok: true };
  }
  return { ok: false, error: `${forbidden[0]} не поддерживается` };
}

export function validateWheelClaimInterest(
  value: unknown,
): { ok: true; interest: WheelInterestKey } | { ok: false; error: string } {
  if (!isWheelInterestKey(value)) {
    return {
      ok: false,
      error:
        "selectedInterest должен быть одним из: brows_permanent, lips_permanent, eyelids_permanent, cover, refresh, undecided",
    };
  }
  return { ok: true, interest: value };
}

export function validateWheelClaimBody(body: unknown):
  | {
      ok: true;
      data: {
        gamePlayId: string;
        name: string;
        phone: string;
        selectedInterest: WheelInterestKey;
        confirmedZone: WheelZone;
        personalDataConsent: true;
        offerAcknowledgement: true;
      };
    }
  | { ok: false; error: string } {
  const forbidden = rejectForbiddenWheelClaimFields(body);
  if (!forbidden.ok) {
    return forbidden;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Тело запроса обязательно" };
  }

  const raw = body as WheelClaimInputBody;
  if (typeof raw.gamePlayId !== "string" || !raw.gamePlayId.trim()) {
    return { ok: false, error: "gamePlayId обязателен" };
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    return { ok: false, error: "Имя обязательно" };
  }
  if (typeof raw.phone !== "string" || !raw.phone.trim()) {
    return { ok: false, error: "Телефон обязателен" };
  }
  if (raw.personalDataConsent !== true) {
    return { ok: false, error: "Необходимо согласие на обработку персональных данных" };
  }
  if (raw.offerAcknowledgement !== true) {
    return { ok: false, error: "Необходимо подтверждение оферты" };
  }

  const interest = validateWheelClaimInterest(raw.selectedInterest);
  if (!interest.ok) {
    return interest;
  }

  const zone = validateClaimZoneForInterest({
    interest: interest.interest,
    confirmedZone: raw.confirmedZone,
  });
  if (!zone.ok) {
    return zone;
  }

  return {
    ok: true,
    data: {
      gamePlayId: raw.gamePlayId.trim(),
      name: raw.name.trim(),
      phone: raw.phone.trim(),
      selectedInterest: interest.interest,
      confirmedZone: zone.confirmedZone,
      personalDataConsent: true,
      offerAcknowledgement: true,
    },
  };
}
