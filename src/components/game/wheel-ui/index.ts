export { FortuneWheel } from "./fortune-wheel";
export { WheelBrandHeader } from "./wheel-brand-header";
export { WheelButton } from "./wheel-button";
export { WheelConfettiBurst } from "./wheel-confetti-burst";
export { WheelConsentFields } from "./wheel-consent-fields";
export { WheelContactStep } from "./wheel-contact-step";
export { WheelCopySendActions } from "./wheel-copy-send-actions";
export { WheelErrorStep } from "./wheel-error-step";
export { WheelField } from "./wheel-field";
export {
  WheelFortuneView,
} from "./wheel-fortune-view";
export { WheelIntroStep } from "./wheel-intro-step";
export { WheelLayout } from "./wheel-layout";
export { WheelLoadingStep } from "./wheel-loading-step";
export { WheelPreferenceStep } from "./wheel-preference-step";
export { WheelProgress } from "./wheel-progress";
export { WheelReadyStep } from "./wheel-ready-step";
export { WheelRestoredStep } from "./wheel-restored-step";
export { WheelResultStep } from "./wheel-result-step";
export { WheelSpinStep } from "./wheel-spin-step";
export { WheelSubmittedStep } from "./wheel-submitted-step";

export {
  BRAND,
  EMPTY_LEAD,
  INTENT_LABELS,
  INTENT_OPTIONS,
  PHASE_PROGRESS,
  PROGRESS_STEPS,
  SECTOR_FILL_COLORS,
  WHEEL_SECTOR_ANGLE,
  WHEEL_SECTOR_COUNT,
  WHEEL_SPIN_DURATION_MS,
  WHEEL_SPIN_MIN_TURNS,
  ZONE_LABELS,
  ZONE_OPTIONS,
} from "./wheel-ui.constants";

export {
  buildWheelShareMessage,
  copyAndOpenUrl,
  copyTextToClipboard,
} from "./wheel-ui.share";

export {
  assertSectorCount,
  canContinuePreferences,
  computeRotationForSector,
  countPhoneDigits,
  describeArc,
  getSectorIndex,
  hasContactErrors,
  isZoneRequired,
  polarToCartesian,
  prefersReducedMotion,
  splitSectorLabel,
  validateLead,
} from "./wheel-ui.utils";

export type * from "./wheel-ui.types";
