import { useEffect, useRef } from "react";
import { WheelButton } from "./wheel-button";
import { WheelLayout } from "./wheel-layout";

type WheelErrorStepProps = {
  title: string;
  error?: string | null;
  onReset: () => void;
};

export function WheelErrorStep({
  title,
  error,
  onReset,
}: WheelErrorStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <WheelLayout
      title={title}
      phase="error"
      compactHeader
      footer={
        <WheelButton onClick={onReset} data-testid="error-reset">
          Попробовать снова
        </WheelButton>
      }
    >
      <div className="flex flex-1 flex-col justify-center">
        <div
          className="rounded-[1.75rem] border border-[var(--wheel-danger)]/30 bg-[var(--wheel-cream)] p-5 sm:p-6"
          data-testid="error-card"
          role="alert"
        >
          <span className="sr-only" data-testid="wheel-error-alert">
            {error ?? "Не удалось продолжить. Попробуйте ещё раз."}
          </span>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="font-[family-name:var(--font-display)] text-[1.5rem] text-[var(--wheel-ink)] outline-none"
          >
            Что-то пошло не так
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--wheel-ink-soft)]">
            {error ?? "Не удалось продолжить. Попробуйте ещё раз."}
          </p>
        </div>
      </div>
    </WheelLayout>
  );
}
