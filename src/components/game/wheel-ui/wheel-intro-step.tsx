import { WheelButton } from "./wheel-button";
import { WheelLayout } from "./wheel-layout";
import { BRAND } from "./wheel-ui.constants";

type WheelIntroStepProps = {
  title: string;
  subtitle?: string;
  onStart: () => void;
};

const STEPS = [
  "Выберите процедуру",
  "Крутите колесо",
  "Получите подарок к записи",
] as const;

export function WheelIntroStep({
  title,
  subtitle = BRAND.gameSubtitle,
  onStart,
}: WheelIntroStepProps) {
  return (
    <WheelLayout
      title={title}
      subtitle={subtitle}
      phase="intro"
      footer={
        <WheelButton
          onClick={onStart}
          data-testid="wheel-start-button"
        >
          Начать
        </WheelButton>
      }
    >
      <div className="flex flex-1 flex-col justify-center gap-8">
        <p className="mx-auto max-w-[36ch] text-center text-[15px] leading-relaxed text-[var(--wheel-cream-soft)]">
          {BRAND.gameDescription}
        </p>

        <ol className="mx-auto flex w-full max-w-sm flex-col gap-3">
          {STEPS.map((step, index) => (
            <li
              key={step}
              className="flex items-center gap-4 rounded-2xl border border-[var(--wheel-gold)]/20 bg-[var(--wheel-cream)]/[0.04] px-4 py-3.5"
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--wheel-gold)]/50 font-[family-name:var(--font-display)] text-lg text-[var(--wheel-gold)]"
                aria-hidden
              >
                {index + 1}
              </span>
              <span className="text-[15px] font-medium text-[var(--wheel-cream)]">
                {step}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </WheelLayout>
  );
}
