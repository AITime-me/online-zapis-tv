import { useEffect, useRef } from "react";
import { WheelButton } from "./wheel-button";
import { WheelConfettiBurst } from "./wheel-confetti-burst";
import { WheelLayout } from "./wheel-layout";
import { INTENT_LABELS, ZONE_LABELS } from "./wheel-ui.constants";
import type {
  WheelPrizeResult,
  WheelProcedureIntent,
  WheelZone,
} from "./wheel-ui.types";

type WheelResultStepProps = {
  title: string;
  result: WheelPrizeResult;
  selectedIntent: WheelProcedureIntent | null;
  selectedZone: WheelZone | null;
  onClaim: () => void;
  busy?: boolean;
  /** Fires confetti only on the first fresh result screen. */
  confettiActive?: boolean;
};

export function WheelResultStep({
  title,
  result,
  selectedIntent,
  selectedZone,
  onClaim,
  busy,
  confettiActive = true,
}: WheelResultStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <WheelLayout
      title={title}
      phase="result"
      compactHeader
      footer={
        <WheelButton
          onClick={onClaim}
          disabled={busy}
          data-testid="wheel-complete-button"
        >
          Получить подарок
        </WheelButton>
      }
    >
      <div className="relative flex flex-1 flex-col justify-center">
        <div className="wheel-particles" aria-hidden>
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <WheelConfettiBurst active={confettiActive} />

        <article
          className="wheel-result-card relative z-10 overflow-hidden rounded-[1.75rem] border border-[var(--wheel-gold)]/45 bg-[var(--wheel-cream)] p-5 shadow-[0_18px_50px_rgba(15,47,42,0.28)] sm:p-6"
          data-testid="result-card"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="wheel-result-glow" aria-hidden />

          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--wheel-gold-deep)]">
            Ваш подарок
          </p>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="mt-2 break-words font-[family-name:var(--font-display)] text-[1.65rem] leading-tight text-[var(--wheel-ink)] outline-none sm:text-[1.85rem]"
            data-testid="wheel-prize-name"
          >
            {result.fullName}
          </h2>

          {result.description ? (
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--wheel-ink-soft)]">
              {result.description}
            </p>
          ) : null}

          <dl className="mt-5 space-y-2.5 border-t border-[var(--wheel-beige)] pt-4 text-[13px]">
            {result.conditionText ? (
              <div>
                <dt className="text-[var(--wheel-muted)]">Условие</dt>
                <dd className="font-medium text-[var(--wheel-ink)]">
                  {result.conditionText}
                </dd>
              </div>
            ) : null}
            {result.validityDays ? (
              <div>
                <dt className="text-[var(--wheel-muted)]">Срок действия</dt>
                <dd className="font-medium text-[var(--wheel-ink)]">
                  {result.validityDays} дней
                </dd>
              </div>
            ) : null}
            {selectedIntent ? (
              <div>
                <dt className="text-[var(--wheel-muted)]">Направление</dt>
                <dd className="font-medium text-[var(--wheel-ink)]">
                  {INTENT_LABELS[selectedIntent]}
                </dd>
              </div>
            ) : null}
            {selectedZone && selectedIntent && selectedIntent !== "undecided" ? (
              <div>
                <dt className="text-[var(--wheel-muted)]">Зона</dt>
                <dd className="font-medium text-[var(--wheel-ink)]">
                  {ZONE_LABELS[selectedZone]}
                </dd>
              </div>
            ) : null}
          </dl>
        </article>
      </div>
    </WheelLayout>
  );
}
