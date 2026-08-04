import { FortuneWheel } from "./fortune-wheel";
import { WheelButton } from "./wheel-button";
import { WheelLayout } from "./wheel-layout";
import { INTENT_LABELS, ZONE_LABELS } from "./wheel-ui.constants";
import type {
  WheelProcedureIntent,
  WheelSector,
  WheelZone,
} from "./wheel-ui.types";
import { prefersReducedMotion } from "./wheel-ui.utils";

export type WheelSpinStepProps = {
  title: string;
  sectors: WheelSector[];
  rotationDeg: number;
  spinning: boolean;
  selectedSectorId?: string | null;
  selectedIntent: WheelProcedureIntent | null;
  selectedZone: WheelZone | null;
  onSpin: () => void;
  onBack: () => void;
  busy?: boolean;
};

export function WheelSpinStep({
  title,
  sectors,
  rotationDeg,
  spinning,
  selectedSectorId,
  selectedIntent,
  selectedZone,
  onSpin,
  onBack,
  busy,
}: WheelSpinStepProps) {
  const reduced = prefersReducedMotion();

  return (
    <WheelLayout
      title={title}
      subtitle="Удачи — подарок уже в колесе"
      phase={spinning ? "spinning" : "ready"}
      compactHeader
      footer={
        spinning ? null : (
          <WheelButton variant="ghost" onClick={onBack} disabled={busy}>
            Назад
          </WheelButton>
        )
      }
    >
      <div className="flex flex-col gap-4 overflow-y-auto pb-2">
        <h2 tabIndex={-1} className="sr-only" data-testid="spin-step-heading">
          Экран колеса
        </h2>

        <div className="flex flex-wrap items-center justify-center gap-2 text-[13px]">
          {selectedIntent ? (
            <span className="rounded-full border border-[var(--wheel-gold)]/35 px-3 py-1 text-[var(--wheel-cream)]">
              {INTENT_LABELS[selectedIntent]}
            </span>
          ) : null}
          {selectedZone && selectedIntent !== "undecided" ? (
            <span className="rounded-full border border-[var(--wheel-gold)]/35 px-3 py-1 text-[var(--wheel-cream)]">
              {ZONE_LABELS[selectedZone]}
            </span>
          ) : null}
        </div>

        <FortuneWheel
          sectors={sectors}
          rotationDeg={rotationDeg}
          spinning={spinning}
          selectedSectorId={selectedSectorId}
          onSpin={onSpin}
          disabled={Boolean(busy) || spinning}
          reducedMotion={reduced}
        />
      </div>
    </WheelLayout>
  );
}

/** Ready phase before spin — same shell as WheelSpinStep with spinning=false. */
export function WheelReadyStep(props: Omit<WheelSpinStepProps, "spinning">) {
  return <WheelSpinStep {...props} spinning={false} />;
}
