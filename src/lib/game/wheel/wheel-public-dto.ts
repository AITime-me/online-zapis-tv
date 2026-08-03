/**
 * Safe public DTOs for wheel animation / resume. Never include hashes,
 * secrets, prizeSystemKey, raw assignment, or probability.
 */

export type WheelPublicSessionStatus =
  | "ACTIVE"
  | "COMPLETED"
  | "CONSUMED"
  | "EXPIRED";

export type WheelPublicSectorLabel = {
  sectorIndex: number;
  prizeDisplayName: string;
};

export type WheelPublicAnimationResult = {
  sectorIndex: number;
  prizeDisplayName: string;
  totalSectors: number;
};

export type WheelPublicStartResponse = {
  ok: true;
  status: "ACTIVE";
  expiresAt: string;
  created: boolean;
  animation: WheelPublicAnimationResult;
};

/** Internal start result: public fields + session credential for HttpOnly cookie / tests. */
export type WheelPublicStartServiceResult = WheelPublicStartResponse & {
  sessionToken: string;
};

export type WheelPublicResultResponse = {
  ok: true;
  status: WheelPublicSessionStatus;
  expiresAt: string | null;
  hasResult: boolean;
  bookingSubmitted: boolean;
  animation: WheelPublicAnimationResult | null;
  prizeDisplayName: string | null;
};

export type WheelPublicCompleteResponse = {
  ok: true;
  bookingRequestId: string;
  prizeDisplayName: string;
  originalPrizeDisplayName: string;
  replacementApplied: boolean;
  bookingSubmitted: true;
};

export function buildWheelPublicAnimationResult(input: {
  sectorIndex: number;
  prizeDisplayName: string;
  totalSectors: number;
}): WheelPublicAnimationResult {
  return {
    sectorIndex: input.sectorIndex,
    prizeDisplayName: input.prizeDisplayName.trim(),
    totalSectors: input.totalSectors,
  };
}

const FORBIDDEN_PUBLIC_KEYS = [
  "participantPhoneHash",
  "attemptIdHash",
  "tokenHash",
  "sessionToken",
  "prizeSystemKey",
  "serverAssignment",
  "campaignKey",
  "rulesVersion",
  "tierBucket",
  "serverResultTier",
  "probability",
  "weight",
  "AUTH_SECRET",
  "WHEEL_OF_FORTUNE_CAMPAIGN_SECRET",
] as const;

export function assertSafeWheelPublicPayload(payload: unknown): void {
  const raw = JSON.stringify(payload);
  for (const key of FORBIDDEN_PUBLIC_KEYS) {
    if (raw.includes(`"${key}"`)) {
      throw new Error(`Wheel public payload must not include ${key}`);
    }
  }
}
