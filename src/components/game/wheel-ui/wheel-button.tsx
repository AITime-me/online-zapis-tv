import type { ButtonHTMLAttributes, ReactNode } from "react";

type WheelButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  fullWidth?: boolean;
};

const VARIANT_CLASS: Record<
  NonNullable<WheelButtonProps["variant"]>,
  string
> = {
  primary:
    "bg-[var(--wheel-gold)] text-[var(--wheel-deep)] hover:bg-[var(--wheel-gold-soft)] active:scale-[0.98] shadow-[0_8px_24px_rgba(198,161,91,0.28)]",
  secondary:
    "bg-transparent text-[var(--wheel-cream)] border border-[var(--wheel-gold)]/55 hover:border-[var(--wheel-gold)] hover:bg-[var(--wheel-gold)]/10",
  ghost:
    "bg-transparent text-[var(--wheel-muted)] hover:text-[var(--wheel-cream)]",
};

export function WheelButton({
  children,
  variant = "primary",
  fullWidth = true,
  className = "",
  type = "button",
  ...props
}: WheelButtonProps) {
  return (
    <button
      type={type}
      className={[
        "wheel-btn inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold tracking-wide transition duration-200",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wheel-gold)]",
        "disabled:pointer-events-none disabled:opacity-45",
        VARIANT_CLASS[variant],
        fullWidth ? "w-full" : "",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
