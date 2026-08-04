import { BRAND } from "./wheel-ui.constants";

type WheelBrandHeaderProps = {
  title?: string;
  subtitle?: string;
  compact?: boolean;
};

export function WheelBrandHeader({
  title = BRAND.gameTitle,
  subtitle,
  compact = false,
}: WheelBrandHeaderProps) {
  return (
    <header className={`text-center ${compact ? "mb-3" : "mb-6"}`}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--wheel-gold)]">
        {BRAND.studioFull}
      </p>
      <h1
        className={`font-[family-name:var(--font-display)] font-semibold text-[var(--wheel-cream)] ${
          compact
            ? "text-2xl leading-tight"
            : "text-[2rem] leading-none sm:text-[2.35rem]"
        }`}
      >
        {title}
      </h1>
      {subtitle ? (
        <p
          className={`mx-auto mt-3 max-w-[34ch] text-[var(--wheel-cream-soft)] ${
            compact ? "text-sm" : "text-[15px] leading-relaxed"
          }`}
        >
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}
