import { WheelButton } from "./wheel-button";
import { WheelLayout } from "./wheel-layout";
import { INTENT_OPTIONS, ZONE_OPTIONS } from "./wheel-ui.constants";
import type { WheelProcedureIntent, WheelZone } from "./wheel-ui.types";
import { canContinuePreferences, isZoneRequired } from "./wheel-ui.utils";

type WheelPreferenceStepProps = {
  title: string;
  selectedIntent: WheelProcedureIntent | null;
  selectedZone: WheelZone | null;
  onIntentChange: (intent: WheelProcedureIntent | null) => void;
  onZoneChange: (zone: WheelZone | null) => void;
  onContinue: () => void;
  onBack: () => void;
  busy?: boolean;
};

function ChoiceCard({
  selected,
  label,
  description,
  onToggle,
  disabled,
}: {
  selected: boolean;
  label: string;
  description?: string;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={[
        "wheel-choice-card group relative w-full rounded-2xl border px-4 py-4 text-left transition duration-200",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wheel-gold)]",
        "active:scale-[0.99] disabled:opacity-50",
        selected
          ? "border-[var(--wheel-gold)] bg-[var(--wheel-cream)] shadow-[0_0_0_1px_var(--wheel-gold),0_10px_28px_rgba(198,161,91,0.18)]"
          : "border-[var(--wheel-beige)]/70 bg-[var(--wheel-cream)]/92 hover:border-[var(--wheel-gold)]/55 hover:bg-[var(--wheel-cream)]",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold text-[var(--wheel-ink)]">
            {label}
          </p>
          {description ? (
            <p className="mt-1 text-[13px] leading-snug text-[var(--wheel-muted)]">
              {description}
            </p>
          ) : null}
        </div>
        <span
          className={[
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition",
            selected
              ? "border-[var(--wheel-gold)] bg-[var(--wheel-gold)] text-[var(--wheel-deep)]"
              : "border-[var(--wheel-beige)] text-transparent",
          ].join(" ")}
          aria-hidden
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 6.2 L4.8 8.5 L9.5 3.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    </button>
  );
}

export function WheelPreferenceStep({
  title,
  selectedIntent,
  selectedZone,
  onIntentChange,
  onZoneChange,
  onContinue,
  onBack,
  busy,
}: WheelPreferenceStepProps) {
  const zoneNeeded = isZoneRequired(selectedIntent);
  const canContinue = canContinuePreferences(selectedIntent, selectedZone);

  return (
    <WheelLayout
      title={title}
      subtitle="Что вам сейчас ближе?"
      phase="preferences"
      compactHeader
      footer={
        <>
          <WheelButton
            onClick={onContinue}
            disabled={!canContinue || busy}
            data-testid="preferences-continue"
          >
            Продолжить
          </WheelButton>
          <WheelButton variant="ghost" onClick={onBack} disabled={busy}>
            Назад
          </WheelButton>
        </>
      }
    >
      <div className="flex flex-col gap-6 overflow-y-auto pb-2">
        <section aria-labelledby="intent-heading">
          <h2
            id="intent-heading"
            tabIndex={-1}
            className="mb-3 font-[family-name:var(--font-display)] text-xl text-[var(--wheel-cream)]"
          >
            Тип процедуры
          </h2>
          <div
            role="group"
            aria-labelledby="intent-heading"
            className="grid gap-2.5"
          >
            {INTENT_OPTIONS.map((option) => (
              <ChoiceCard
                key={option.value}
                selected={selectedIntent === option.value}
                label={option.label}
                description={option.description}
                disabled={busy}
                onToggle={() => {
                  const next =
                    selectedIntent === option.value ? null : option.value;
                  onIntentChange(next);
                  if (next === "undecided" || next === null) {
                    onZoneChange(null);
                  }
                }}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby="zone-heading">
          <h2
            id="zone-heading"
            className="mb-1 font-[family-name:var(--font-display)] text-xl text-[var(--wheel-cream)]"
          >
            Зона
          </h2>
          <p className="mb-3 text-sm text-[var(--wheel-cream-soft)]">
            {zoneNeeded
              ? "Выберите зону — это поможет сохранить подходящий подарок."
              : "Для варианта «Пока выбираю» зона не нужна и не отправляется."}
          </p>
          <div
            role="group"
            aria-labelledby="zone-heading"
            className="grid grid-cols-3 gap-2.5"
          >
            {ZONE_OPTIONS.map((option) => (
              <ChoiceCard
                key={option.value}
                selected={zoneNeeded && selectedZone === option.value}
                label={option.label}
                disabled={busy || !zoneNeeded}
                onToggle={() =>
                  onZoneChange(
                    selectedZone === option.value ? null : option.value,
                  )
                }
              />
            ))}
          </div>
        </section>
      </div>
    </WheelLayout>
  );
}
