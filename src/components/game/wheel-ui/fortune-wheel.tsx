import {
  SECTOR_FILL_COLORS,
  WHEEL_SECTOR_ANGLE,
  WHEEL_SPIN_DURATION_MS,
} from "./wheel-ui.constants";
import type { WheelSector } from "./wheel-ui.types";
import {
  describeArc,
  polarToCartesian,
  splitSectorLabel,
} from "./wheel-ui.utils";

type FortuneWheelProps = {
  sectors: WheelSector[];
  rotationDeg: number;
  spinning: boolean;
  selectedSectorId?: string | null;
  onSpin: () => void;
  disabled?: boolean;
  reducedMotion?: boolean;
};

const SIZE = 320;
const CX = SIZE / 2;
const CY = SIZE / 2;
const OUTER_R = 148;
const LABEL_R = 102;
const HUB_R = 42;

export function FortuneWheel({
  sectors,
  rotationDeg,
  spinning,
  selectedSectorId = null,
  onSpin,
  disabled = false,
  reducedMotion = false,
}: FortuneWheelProps) {
  const canSpin = !spinning && !disabled;
  const statusText = spinning
    ? "Колесо вращается"
    : selectedSectorId
      ? "Колесо остановлено"
      : "Колесо готово к вращению";

  return (
    <div
      className="wheel-stage relative mx-auto w-full max-w-[340px] sm:max-w-[360px] md:max-w-[420px]"
      data-testid="fortune-wheel"
      aria-busy={spinning || undefined}
      aria-live="polite"
    >
      <p className="sr-only">{statusText}</p>

      <div
        className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1"
        aria-hidden
      >
        <svg width="28" height="34" viewBox="0 0 28 34" fill="none">
          <path
            d="M14 32 C14 32 2 18 2 12 C2 5.4 7.4 1 14 1 C20.6 1 26 5.4 26 12 C26 18 14 32 14 32Z"
            fill="#C6A15B"
            stroke="#F3EBDD"
            strokeWidth="1.5"
          />
          <circle cx="14" cy="12" r="3.2" fill="#0F2F2A" />
        </svg>
      </div>

      <div className="wheel-glow relative aspect-square w-full">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-full w-full overflow-visible"
          role="img"
          aria-label={`Колесо фортуны с ${sectors.length} подарками`}
        >
          <circle
            cx={CX}
            cy={CY}
            r={OUTER_R + 8}
            fill="none"
            stroke="rgba(198,161,91,0.22)"
            strokeWidth="10"
            aria-hidden
          />

          <g
            style={{
              transformOrigin: `${CX}px ${CY}px`,
              transform: `rotate(${rotationDeg}deg)`,
              transition:
                spinning && !reducedMotion
                  ? `transform ${WHEEL_SPIN_DURATION_MS}ms cubic-bezier(0.12, 0.75, 0.12, 1)`
                  : reducedMotion
                    ? "none"
                    : "transform 400ms ease-out",
            }}
            data-testid="wheel-disc"
          >
            <circle
              cx={CX}
              cy={CY}
              r={OUTER_R}
              fill="#0F2F2A"
              stroke="#C6A15B"
              strokeWidth="6"
            />
            <circle
              cx={CX}
              cy={CY}
              r={OUTER_R - 4}
              fill="none"
              stroke="#F3EBDD"
              strokeWidth="1.2"
              opacity="0.35"
            />

            {sectors.map((sector, index) => {
              const start = index * WHEEL_SECTOR_ANGLE;
              const end = start + WHEEL_SECTOR_ANGLE;
              const mid = start + WHEEL_SECTOR_ANGLE / 2;
              const [line1, line2] = splitSectorLabel(sector.shortLabel);
              const labelPos = polarToCartesian(CX, CY, LABEL_R, mid);
              const fill =
                SECTOR_FILL_COLORS[index % SECTOR_FILL_COLORS.length];

              return (
                <g key={sector.id}>
                  <path
                    d={describeArc(CX, CY, OUTER_R - 5, start, end)}
                    fill={fill}
                    stroke="rgba(243,235,221,0.28)"
                    strokeWidth="1"
                  />
                  <text
                    x={labelPos.x}
                    y={labelPos.y}
                    fill="#F3EBDD"
                    fontSize="9.5"
                    fontFamily="var(--font-ui), Manrope, sans-serif"
                    fontWeight="600"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${mid}, ${labelPos.x}, ${labelPos.y})`}
                    style={{ pointerEvents: "none" }}
                  >
                    <tspan x={labelPos.x} dy={line2 ? "-0.55em" : "0"}>
                      {line1}
                    </tspan>
                    {line2 ? (
                      <tspan x={labelPos.x} dy="1.15em">
                        {line2}
                      </tspan>
                    ) : null}
                  </text>
                </g>
              );
            })}

            <circle
              cx={CX}
              cy={CY}
              r={HUB_R + 10}
              fill="none"
              stroke="rgba(198,161,91,0.45)"
              strokeWidth="2"
            />
          </g>

          <g data-testid="wheel-hub">
            <circle
              cx={CX}
              cy={CY}
              r={HUB_R + 2}
              fill="#C6A15B"
              opacity="0.35"
            />
            <circle cx={CX} cy={CY} r={HUB_R} fill="#F3EBDD" />
            <circle
              cx={CX}
              cy={CY}
              r={HUB_R - 3}
              fill="none"
              stroke="#C6A15B"
              strokeWidth="1.5"
            />
          </g>
        </svg>

        <button
          type="button"
          className="absolute left-1/2 top-1/2 z-10 flex h-[84px] w-[84px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-[var(--wheel-cream)] text-center font-semibold text-[var(--wheel-deep)] shadow-[0_6px_20px_rgba(15,47,42,0.25)] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wheel-gold)] enabled:hover:scale-[1.03] enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-80"
          onClick={onSpin}
          disabled={!canSpin}
          aria-label={spinning ? "Крутим колесо" : "Крутить колесо"}
          data-testid="wheel-spin-button"
        >
          {spinning ? (
            <span className="text-[13px] leading-tight">Крутим…</span>
          ) : (
            <>
              <span aria-hidden className="mb-0.5 text-[var(--wheel-gold)]">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="2.2" fill="currentColor" />
                  <path
                    d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span className="text-[13px] leading-tight">Крутить</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
