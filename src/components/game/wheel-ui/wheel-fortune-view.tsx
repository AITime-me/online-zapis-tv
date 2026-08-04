import { FortuneWheel } from "./fortune-wheel";
import { WheelBrandHeader } from "./wheel-brand-header";
import { WheelButton } from "./wheel-button";
import { WheelConfettiBurst } from "./wheel-confetti-burst";
import { WheelConsentFields } from "./wheel-consent-fields";
import { WheelContactStep } from "./wheel-contact-step";
import { WheelCopySendActions } from "./wheel-copy-send-actions";
import { WheelErrorStep } from "./wheel-error-step";
import { WheelField } from "./wheel-field";
import { WheelIntroStep } from "./wheel-intro-step";
import { WheelLayout } from "./wheel-layout";
import { WheelLoadingStep } from "./wheel-loading-step";
import { WheelPreferenceStep } from "./wheel-preference-step";
import { WheelProgress } from "./wheel-progress";
import { WheelReadyStep } from "./wheel-ready-step";
import { WheelRestoredStep } from "./wheel-restored-step";
import { WheelResultStep } from "./wheel-result-step";
import { WheelSpinStep } from "./wheel-spin-step";
import { WheelSubmittedStep } from "./wheel-submitted-step";
import type { WheelFortuneViewProps } from "./wheel-ui.types";

/**
 * Controlled presentation shell for Wheel of Fortune.
 * No fetch, storage, cookies, Prisma, or prize assignment.
 */
export function WheelFortuneView(props: WheelFortuneViewProps) {
  const {
    title,
    subtitle,
    phase,
    sectors,
    selectedIntent,
    selectedZone,
    lead,
    result,
    rotationDeg,
    busy,
    error,
    contactErrors,
    claimStatus,
    contactContext,
    phoneSlot,
    consentSlot,
    shareMessage,
    vkUrl,
    maxUrl,
    confettiActive,
    onStart,
    onIntentChange,
    onZoneChange,
    onLeadChange,
    onPreferencesContinue,
    onContactContinue,
    onSpin,
    onClaim,
    onBack,
    onReset,
  } = props;

  switch (phase) {
    case "intro":
      return (
        <WheelIntroStep title={title} subtitle={subtitle} onStart={onStart} />
      );

    case "preferences":
      return (
        <WheelPreferenceStep
          title={title}
          selectedIntent={selectedIntent}
          selectedZone={selectedZone}
          onIntentChange={onIntentChange}
          onZoneChange={onZoneChange}
          onContinue={onPreferencesContinue}
          onBack={onBack}
          busy={busy}
        />
      );

    case "contact":
      return (
        <WheelContactStep
          title={title}
          lead={lead}
          errors={contactErrors}
          onLeadChange={onLeadChange}
          onContinue={onContactContinue}
          onBack={onBack}
          busy={busy}
          contactContext={contactContext}
          phoneSlot={phoneSlot}
          consentSlot={consentSlot}
        />
      );

    case "ready":
      return (
        <WheelReadyStep
          title={title}
          sectors={sectors}
          rotationDeg={rotationDeg}
          selectedSectorId={result?.sectorId}
          selectedIntent={selectedIntent}
          selectedZone={selectedZone}
          onSpin={onSpin}
          onBack={onBack}
          busy={busy}
        />
      );

    case "spinning":
      return (
        <WheelSpinStep
          title={title}
          sectors={sectors}
          rotationDeg={rotationDeg}
          spinning
          selectedSectorId={result?.sectorId}
          selectedIntent={selectedIntent}
          selectedZone={selectedZone}
          onSpin={onSpin}
          onBack={onBack}
          busy={busy}
        />
      );

    case "result":
    case "submitting":
      if (!result) {
        return (
          <WheelErrorStep
            title={title}
            error="Результат ещё не готов"
            onReset={onReset}
          />
        );
      }
      return (
        <WheelResultStep
          title={title}
          result={result}
          selectedIntent={selectedIntent}
          selectedZone={selectedZone}
          onClaim={onClaim}
          busy={busy || phase === "submitting"}
          confettiActive={
            confettiActive !== undefined
              ? confettiActive
              : phase === "result"
          }
        />
      );

    case "submitted":
      if (!result) {
        return (
          <WheelErrorStep
            title={title}
            error="Нет сохранённого подарка"
            onReset={onReset}
          />
        );
      }
      return (
        <WheelSubmittedStep
          title={title}
          result={result}
          selectedIntent={selectedIntent}
          selectedZone={selectedZone}
          shareMessage={shareMessage}
          vkUrl={vkUrl}
          maxUrl={maxUrl}
        />
      );

    case "restored":
      if (!result) {
        return (
          <WheelErrorStep
            title={title}
            error="Нет сохранённого результата"
            onReset={onReset}
          />
        );
      }
      return (
        <WheelRestoredStep
          title={title}
          result={result}
          claimStatus={claimStatus}
          onClaim={onClaim}
          busy={busy}
          shareMessage={shareMessage}
          vkUrl={vkUrl}
          maxUrl={maxUrl}
        />
      );

    case "error":
      return <WheelErrorStep title={title} error={error} onReset={onReset} />;

    case "loading":
      return <WheelLoadingStep title={title} />;

    default:
      return (
        <WheelErrorStep
          title={title}
          error="Неизвестное состояние интерфейса"
          onReset={onReset}
        />
      );
  }
}

export {
  FortuneWheel,
  WheelBrandHeader,
  WheelButton,
  WheelConfettiBurst,
  WheelConsentFields,
  WheelContactStep,
  WheelCopySendActions,
  WheelErrorStep,
  WheelField,
  WheelIntroStep,
  WheelLayout,
  WheelLoadingStep,
  WheelPreferenceStep,
  WheelProgress,
  WheelReadyStep,
  WheelRestoredStep,
  WheelResultStep,
  WheelSpinStep,
  WheelSubmittedStep,
};

export type * from "./wheel-ui.types";
