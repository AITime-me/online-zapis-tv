"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { HomeBrandShell } from "@/components/home/home-ui";
import { StudioLogo } from "@/components/brand/studio-logo";
import { studioBrand } from "@/lib/brand/studio-brand";

export function BookingBrandShell({ children }: { children: ReactNode }) {
  return <HomeBrandShell>{children}</HomeBrandShell>;
}

export function BookingHeader() {
  return (
    <header
      className="border-b backdrop-blur-md"
      style={{
        borderColor: studioBrand.goldLineSoft,
        backgroundColor: "rgba(250, 247, 242, 0.88)",
      }}
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 md:px-6 md:py-3.5">
        <Link href="/" className="home-header-logo min-w-0 shrink-0" aria-label="На главную">
          <StudioLogo priority size="sm" className="home-header-logo-img" />
        </Link>
        <Link
          href="/"
          className="font-body shrink-0 text-sm font-medium transition hover:opacity-70"
          style={{ color: studioBrand.greenMuted }}
        >
          На главную
        </Link>
      </div>
    </header>
  );
}

export function BookingHero() {
  return (
    <section className="booking-hero home-fade-up is-visible relative overflow-hidden px-1 pb-6 pt-8 text-center sm:px-0 sm:pb-8 sm:pt-10">
      <div className="home-hero-ref home-hero-ref--booking" aria-hidden />
      <div className="home-hero-ref-overlay home-hero-ref-overlay--booking" aria-hidden />
      <div className="home-hero-content relative mx-auto w-full max-w-3xl text-center">
      <p
        className="font-body text-[0.7rem] font-semibold uppercase tracking-[0.28em] sm:text-xs"
        style={{ color: studioBrand.gold }}
      >
        Студия красоты «Твоё время»
      </p>
      <h1
        className="font-display mx-auto mt-3 max-w-xl text-[1.75rem] font-semibold leading-[1.15] sm:text-3xl md:text-4xl"
        style={{ color: studioBrand.green }}
      >
        Твоё время — для Вас
      </h1>
      <p
        className="font-body mx-auto mt-3 max-w-lg text-sm leading-relaxed sm:text-base"
        style={{ color: studioBrand.inkMuted }}
      >
        Выберите процедуру, специалиста и удобное время для Вашего визита.
      </p>
      <div className="home-gold-divider mx-auto mt-6 max-w-xs opacity-70" aria-hidden />
      </div>
    </section>
  );
}

export const BOOKING_PANEL_CLASS =
  "home-card home-card-info booking-float-panel booking-panel-premium booking-float-sway rounded-[1.75rem] border p-4 sm:p-6";

export const BOOKING_SELECTABLE_CARD_CLASS =
  "home-card home-card-direction booking-float-card booking-float-sway rounded-[1.75rem] border p-4 text-left transition duration-300 sm:p-5";

export function bookingSwayStyle(index = 0): CSSProperties {
  return {
    "--sway-delay": `${(index % 6) * 0.48}s`,
  } as CSSProperties;
}

export function BookingPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`${BOOKING_PANEL_CLASS} ${className}`}>{children}</div>;
}

type BookingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  children: ReactNode;
};

export function BookingButton({
  variant = "primary",
  children,
  className = "",
  type = "button",
  ...props
}: BookingButtonProps) {
  const base =
    "home-btn booking-btn-sway font-body inline-flex min-h-12 items-center justify-center rounded-2xl px-6 py-3 text-base font-medium transition duration-300 ease-out disabled:cursor-not-allowed disabled:opacity-60";
  const variants = {
    primary: "home-btn-primary text-white",
    secondary:
      "home-btn-secondary border bg-white/92 text-[var(--brand-green)]",
  } as const;

  return (
    <button type={type} className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function BookingStepEyebrow({ children }: { children: ReactNode }) {
  return (
    <p
      className="font-body text-xs font-semibold uppercase tracking-[0.2em]"
      style={{ color: studioBrand.gold }}
    >
      {children}
    </p>
  );
}

export function BookingStepTitle({ children }: { children: ReactNode }) {
  return (
    <h2
      className="font-display mt-1 text-xl font-semibold leading-tight sm:text-2xl"
      style={{ color: studioBrand.green }}
    >
      {children}
    </h2>
  );
}

export function BookingStepDescription({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`font-body text-sm leading-relaxed sm:text-base ${className}`}
      style={{ color: studioBrand.inkMuted }}
    >
      {children}
    </p>
  );
}
