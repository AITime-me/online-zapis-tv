import { useEffect, useRef, type ReactNode } from "react";
import { WheelButton } from "./wheel-button";
import { WheelConsentFields } from "./wheel-consent-fields";
import { WheelField } from "./wheel-field";
import { WheelLayout } from "./wheel-layout";
import type {
  WheelContactContext,
  WheelContactErrors,
  WheelLeadDraft,
} from "./wheel-ui.types";

type WheelContactStepProps = {
  title: string;
  lead: WheelLeadDraft;
  errors?: WheelContactErrors;
  onLeadChange: (lead: WheelLeadDraft) => void;
  onContinue: () => void;
  onBack: () => void;
  busy?: boolean;
  /**
   * pre-spin: normal flow before rotation.
   * restored-pending: only after reload when personal data is kept in React state only.
   */
  contactContext?: WheelContactContext;
  /** Host phone control (PhoneCountrySelect). */
  phoneSlot?: ReactNode;
  /** Host consent control (BookingLegalConsentFields). */
  consentSlot?: ReactNode;
};

export function WheelContactStep({
  title,
  lead,
  errors,
  onLeadChange,
  onContinue,
  onBack,
  busy,
  contactContext = "pre-spin",
  phoneSlot,
  consentSlot,
}: WheelContactStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isRestoredPending = contactContext === "restored-pending";

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <WheelLayout
      title={title}
      subtitle={
        isRestoredPending
          ? "После обновления страницы укажите контакты ещё раз, чтобы завершить получение подарка"
          : "Контакты нужны, чтобы сохранить подарок за вами"
      }
      phase="contact"
      compactHeader
      footer={
        <>
          <WheelButton
            onClick={onContinue}
            disabled={busy}
            data-testid="contact-continue"
          >
            {isRestoredPending ? "Продолжить" : "Перейти к колесу"}
          </WheelButton>
          <WheelButton variant="ghost" onClick={onBack} disabled={busy}>
            Назад
          </WheelButton>
        </>
      }
    >
      <div className="flex flex-col gap-5 overflow-y-auto pb-2">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="font-[family-name:var(--font-display)] text-xl text-[var(--wheel-cream)] outline-none"
        >
          {isRestoredPending ? "Подтвердите контакты" : "Ваши данные"}
        </h2>

        <div className="rounded-3xl border border-[var(--wheel-gold)]/20 bg-[var(--wheel-cream)] p-4 sm:p-5">
          <div className="flex flex-col gap-4">
            <WheelField
              id="wheel-name"
              name="name"
              label="Имя"
              autoComplete="given-name"
              placeholder="Как к вам обращаться"
              value={lead.name}
              error={errors?.name}
              disabled={busy}
              onChange={(e) =>
                onLeadChange({ ...lead, name: e.target.value })
              }
            />

            {phoneSlot ? (
              <div data-testid="wheel-phone-slot">{phoneSlot}</div>
            ) : (
              <WheelField
                id="wheel-phone"
                name="phone"
                label="Телефон"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="Номер телефона"
                value={lead.phone}
                error={errors?.phone}
                disabled={busy}
                onChange={(e) =>
                  onLeadChange({ ...lead, phone: e.target.value })
                }
              />
            )}

            {consentSlot ? (
              <div data-testid="wheel-consent-slot">{consentSlot}</div>
            ) : (
              <WheelConsentFields
                lead={lead}
                errors={errors}
                disabled={busy}
                onChange={onLeadChange}
              />
            )}
          </div>
        </div>
      </div>
    </WheelLayout>
  );
}
