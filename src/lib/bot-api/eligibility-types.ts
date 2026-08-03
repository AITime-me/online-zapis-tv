/**
 * Internal bot eligibility contract (PR A).
 * No client-facing copy; reasonCode is machine-stable only.
 */

export type BotEligibilityOutcome =
  | "SELF_BOOKING_ALLOWED"
  | "MANAGER_HANDOFF";

export type BotEligibilityReasonCode =
  | "STUDIO_ONLINE_DISABLED"
  | "SERVICE_INACTIVE"
  | "SERVICE_NOT_FOUND"
  | "MASTER_INACTIVE"
  | "ONLINE_DISABLED"
  | "MASTER_SERVICE_UNAVAILABLE"
  | "MANAGER_ONLY";

export type BotEligibilityAlternativeMaster = {
  id: string;
  publicName: string;
};

export type BotEligibilityRequest = {
  serviceId: string;
  masterId?: string;
  includeAlternatives?: boolean;
};

export type BotEligibilityResult = {
  outcome: BotEligibilityOutcome;
  reasonCode: BotEligibilityReasonCode | null;
  selectedPairAllowed: boolean;
  serviceOnlineInGeneral: boolean;
  otherOnlineMasterCount: number;
  otherOnlineMasters?: BotEligibilityAlternativeMaster[];
};

export type BotEligibilitySuccessResponse = {
  ok: true;
} & BotEligibilityResult;
