import { PHASE_PROGRESS, PROGRESS_STEPS } from "./wheel-ui.constants";
import type { WheelUiPhase } from "./wheel-ui.types";

type WheelProgressProps = {
  phase: WheelUiPhase;
};

export function WheelProgress({ phase }: WheelProgressProps) {
  const current = PHASE_PROGRESS[phase];
  if (current === undefined || current === 0) return null;

  return (
    <nav aria-label="Прогресс оформления подарка" className="mb-5">
      <ol className="flex items-center justify-between gap-1">
        {PROGRESS_STEPS.map((label, index) => {
          const step = index + 1;
          const done = current > step;
          const active = current === step || (current === 4 && step === 4);

          return (
            <li
              key={label}
              className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            >
              <span
                className={[
                  "flex h-2 w-full max-w-16 rounded-full transition-colors duration-300",
                  done || active
                    ? "bg-[var(--wheel-gold)]"
                    : "bg-[var(--wheel-cream)]/15",
                ].join(" ")}
                aria-hidden
              />
              <span
                className={[
                  "truncate text-[11px] font-medium",
                  active || done
                    ? "text-[var(--wheel-gold)]"
                    : "text-[var(--wheel-cream)]/40",
                ].join(" ")}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
