export const STUDIO_LOGO = {
  green: "/logo/logo-green.png",
  gold: "/logo/logo-gold.png",
} as const;

export type StudioLogoVariant = keyof typeof STUDIO_LOGO;
export type StudioLogoSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<StudioLogoSize, string> = {
  sm: "h-8 w-auto max-w-[168px]",
  md: "h-9 w-auto max-w-[220px] md:h-11",
  lg: "h-11 w-auto max-w-[280px] md:h-14",
};

type StudioLogoProps = {
  variant?: StudioLogoVariant;
  size?: StudioLogoSize;
  className?: string;
  priority?: boolean;
};

/**
 * Единый логотип студии.
 * green — светлый фон; gold — тёмно-зелёные премиальные блоки.
 * Использует нативный img для корректной alpha-прозрачности PNG.
 */
export function StudioLogo({
  variant = "green",
  size = "md",
  className = "",
  priority = false,
}: StudioLogoProps) {
  return (
    <img
      src={STUDIO_LOGO[variant]}
      alt="Твоё время"
      width={size === "lg" ? 280 : size === "md" ? 220 : 168}
      height={size === "lg" ? 62 : size === "md" ? 48 : 36}
      decoding="async"
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      className={`studio-logo block object-contain object-left ${SIZE_CLASS[size]} ${className}`}
    />
  );
}

/** Алиас для единого компонента Logo. */
export const Logo = StudioLogo;
