import type { ReactNode } from "react";

export type WheelUiPhase =
  | "intro"
  | "preferences"
  | "contact"
  | "ready"
  | "spinning"
  | "result"
  | "submitting"
  | "submitted"
  | "restored"
  | "error"
  | "loading";

export type WheelProcedureIntent =
  | "primary"
  | "refresh"
  | "cover"
  | "undecided";

export type WheelZone = "lips" | "brows" | "eyelids";

export type WheelSector = {
  id: string;
  shortLabel: string;
  fullName: string;
  description?: string;
  conditionText?: string;
  validityDays?: number;
};

export type WheelLeadDraft = {
  name: string;
  phone: string;
  personalDataConsent: boolean;
  offerAcknowledgement: boolean;
};

export type WheelPrizeResult = {
  sectorId: string;
  fullName: string;
  description?: string;
  conditionText?: string;
  validityDays?: number;
};

export type WheelContactErrors = {
  name?: string;
  phone?: string;
  personalDataConsent?: string;
  offerAcknowledgement?: string;
};

/**
 * Contact is shown once before spin in the normal flow.
 * Restored-pending after reload needs contact again because personal data
 * is not persisted in browser storage by the presentation layer.
 */
export type WheelContactContext = "pre-spin" | "restored-pending";

export type WheelFortuneViewProps = {
  title: string;
  subtitle?: string;
  phase: WheelUiPhase;
  sectors: WheelSector[];

  selectedIntent: WheelProcedureIntent | null;
  selectedZone: WheelZone | null;
  lead: WheelLeadDraft;

  result: WheelPrizeResult | null;
  rotationDeg: number;

  busy?: boolean;
  error?: string | null;
  contactErrors?: WheelContactErrors;
  claimStatus?: "pending" | "submitted" | null;
  contactContext?: WheelContactContext;

  /** Host phone UI (e.g. PhoneCountrySelect). Replaces the plain tel fallback. */
  phoneSlot?: ReactNode;
  /** Host consent UI (e.g. BookingLegalConsentFields). Replaces built-in checkboxes. */
  consentSlot?: ReactNode;

  onStart: () => void;
  onIntentChange: (intent: WheelProcedureIntent | null) => void;
  onZoneChange: (zone: WheelZone | null) => void;
  onLeadChange: (lead: WheelLeadDraft) => void;
  onPreferencesContinue: () => void;
  onContactContinue: () => void;
  onSpin: () => void;
  onClaim: () => void;
  onBack: () => void;
  onReset: () => void;

  shareMessage?: string;
  vkUrl?: string;
  maxUrl?: string;
  /** Host-controlled confetti arming — avoids re-burst after failed /complete. */
  confettiActive?: boolean;
};
