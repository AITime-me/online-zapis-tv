import { WheelLayout } from "./wheel-layout";

type WheelLoadingStepProps = {
  title: string;
  message?: string;
};

export function WheelLoadingStep({
  title,
  message = "Загружаем колесо…",
}: WheelLoadingStepProps) {
  return (
    <WheelLayout title={title} phase="loading" compactHeader>
      <div
        className="flex flex-1 flex-col items-center justify-center gap-4"
        data-testid="loading-state"
        aria-busy="true"
        aria-live="polite"
      >
        <div
          className="h-12 w-12 rounded-full border-2 border-[var(--wheel-gold)]/25 border-t-[var(--wheel-gold)] motion-safe:animate-spin"
          aria-hidden
        />
        <p className="text-[15px] text-[var(--wheel-cream-soft)]">{message}</p>
      </div>
    </WheelLayout>
  );
}
