import type { WheelLeadDraft } from "./wheel-ui.types";

type WheelConsentFieldsProps = {
  lead: WheelLeadDraft;
  onChange: (lead: WheelLeadDraft) => void;
  errors?: {
    personalDataConsent?: string;
    offerAcknowledgement?: string;
  };
  disabled?: boolean;
};

function ConsentRow({
  id,
  checked,
  onChange,
  disabled,
  error,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  error?: string;
  children: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="flex cursor-pointer items-start gap-3 text-[13px] leading-snug text-[var(--wheel-ink-soft)]"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-[var(--wheel-beige)] accent-[var(--wheel-gold)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wheel-gold)]"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <span>{children}</span>
      </label>
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="pl-8 text-sm text-[var(--wheel-danger)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Fallback consent UI for presentation previews.
 * Production should pass `consentSlot` with BookingLegalConsentFields.
 */
export function WheelConsentFields({
  lead,
  onChange,
  errors,
  disabled,
}: WheelConsentFieldsProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="wheel-consent-fallback">
      <ConsentRow
        id="wheel-consent-personal"
        checked={lead.personalDataConsent}
        disabled={disabled}
        error={errors?.personalDataConsent}
        onChange={(personalDataConsent) =>
          onChange({ ...lead, personalDataConsent })
        }
      >
        Соглашаюсь на обработку персональных данных для сохранения подарка и
        связи со мной.
      </ConsentRow>
      <ConsentRow
        id="wheel-consent-offer"
        checked={lead.offerAcknowledgement}
        disabled={disabled}
        error={errors?.offerAcknowledgement}
        onChange={(offerAcknowledgement) =>
          onChange({ ...lead, offerAcknowledgement })
        }
      >
        Ознакомлен(а) с условиями акции: подарок активируется при записи в
        студию в указанный срок.
      </ConsentRow>
    </div>
  );
}
