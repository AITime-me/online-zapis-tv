"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { bookingStudio, bookingStudioTelHref } from "@/components/booking/booking-config";
import { BookingLegalLinks } from "@/components/booking/booking-legal-links";
import { StudioLogo } from "@/components/brand/studio-logo";
import { HOME_FOOTER_LEGAL_LINKS } from "@/components/home/home-data";
import { studioBrand } from "@/lib/brand/studio-brand";

type HomeButtonProps = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  onClick?: () => void;
};

export function HomeButton({
  href,
  children,
  variant = "primary",
  className = "",
  onClick,
}: HomeButtonProps) {
  const base =
    "home-btn font-body inline-flex min-h-12 items-center justify-center rounded-2xl px-6 py-3 text-base font-medium transition duration-300 ease-out";

  const variants = {
    primary: "home-btn-primary text-white shadow-none",
    secondary:
      "home-btn-secondary border bg-white/92 text-[var(--brand-green)] shadow-none",
    ghost:
      "home-btn-ghost border border-white/25 bg-white/10 text-white hover:bg-white/14",
  } as const;

  const classNames = `${base} ${variants[variant]} ${className}`;

  if (href.startsWith("#")) {
    return (
      <a href={href} onClick={onClick} className={classNames}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} onClick={onClick} className={classNames}>
      {children}
    </Link>
  );
}

/** @deprecated Используйте StudioLogo */
export { StudioLogo as HomeLogo } from "@/components/brand/studio-logo";

export function HomeBrandShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="home-brand-shell min-h-screen"
      style={{
        backgroundColor: studioBrand.creamWarm,
        ["--brand-green" as string]: studioBrand.green,
        ["--brand-gold" as string]: studioBrand.gold,
      }}
    >
      <div className="home-brand-texture pointer-events-none fixed inset-0 -z-10" aria-hidden />
      {children}
    </div>
  );
}

export function HomeSection({
  id,
  eyebrow,
  title,
  description,
  children,
  className = "",
  dark = false,
  divider = false,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  dark?: boolean;
  divider?: boolean;
}) {
  return (
    <section
      id={id}
      className={`home-fade-up px-4 py-16 sm:py-20 md:px-6 md:py-24 ${className}`}
    >
      <div className="mx-auto max-w-6xl">
        {divider ? <div className="home-gold-divider mx-auto mb-10 max-w-xs sm:mb-12" /> : null}
        <header className="mx-auto mb-10 max-w-3xl text-center md:mb-12">
          {eyebrow ? (
            <p
              className="font-body mb-3 text-xs font-semibold uppercase tracking-[0.24em]"
              style={{ color: studioBrand.gold }}
            >
              {eyebrow}
            </p>
          ) : null}
          <h2
            className="font-display text-2xl font-semibold leading-tight sm:text-3xl md:text-4xl"
            style={{ color: dark ? studioBrand.creamWarm : studioBrand.green }}
          >
            {title}
          </h2>
          {description ? (
            <p
              className={`font-body mt-4 text-base leading-relaxed sm:mt-5 md:text-lg ${
                dark ? "text-white/76" : ""
              }`}
              style={{ color: dark ? undefined : studioBrand.inkMuted }}
            >
              {description}
            </p>
          ) : null}
        </header>
        {children}
      </div>
    </section>
  );
}

type HomeCardVariant = "info" | "direction" | "route" | "premium";

export function HomeCard({
  children,
  className = "",
  variant = "info",
  style,
}: {
  children: ReactNode;
  className?: string;
  variant?: HomeCardVariant;
  style?: CSSProperties;
}) {
  const variantClass = {
    info: "home-card-info",
    direction: "home-card-direction",
    route: "home-card-route",
    premium: "home-card-premium",
  }[variant];

  return (
    <article
      className={`home-card ${variantClass} rounded-[1.75rem] border p-5 sm:p-6 md:p-7 ${className}`}
      style={style}
    >
      {children}
    </article>
  );
}

export function HomeCtaGroup({
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  legalActionLabel = "Записаться онлайн",
  centered = false,
  showLegal = true,
}: {
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  legalActionLabel?: string;
  centered?: boolean;
  showLegal?: boolean;
}) {
  return (
    <div className={centered ? "mx-auto max-w-xl text-center" : ""}>
      <div
        className={`flex flex-col gap-3 sm:flex-row sm:flex-wrap ${
          centered ? "justify-center" : ""
        }`}
      >
        <HomeButton href={primaryHref} className="sm:min-w-[220px]">
          {primaryLabel}
        </HomeButton>
        {secondaryHref && secondaryLabel ? (
          <HomeButton href={secondaryHref} variant="secondary" className="sm:min-w-[220px]">
            {secondaryLabel}
          </HomeButton>
        ) : null}
      </div>
      {showLegal ? (
        <HomeLegalNotice actionLabel={legalActionLabel} className="mt-4" />
      ) : null}
    </div>
  );
}

export function HomeLegalNotice({
  actionLabel = "Записаться онлайн",
  className = "",
}: {
  actionLabel?: string;
  className?: string;
}) {
  return (
    <p
      className={`font-body text-xs leading-relaxed sm:text-sm ${className}`}
      style={{ color: studioBrand.inkMuted }}
    >
      Нажимая «{actionLabel}», Вы соглашаетесь с{" "}
      <BookingLegalLinks
        privacyLabel="политикой конфиденциальности"
        termsLabel="публичной офертой"
      />
      .
    </p>
  );
}

export function HomeFooter() {
  return (
    <footer
      className="border-t px-4 py-6 md:px-6 md:py-12"
      style={{
        borderColor: studioBrand.goldLineSoft,
        backgroundColor: studioBrand.creamDeep,
      }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-5 md:grid md:grid-cols-[1.1fr_1fr_1fr] md:gap-10 md:items-start">
          <div className="space-y-1.5 md:space-y-4">
            <StudioLogo size="sm" className="h-7 md:h-11" />
            <p className="font-body text-sm leading-snug" style={{ color: studioBrand.inkMuted }}>
              Студия красоты «Твоё время»
            </p>
          </div>

          <div className="space-y-1 md:space-y-2">
            <p className="font-body text-sm font-semibold" style={{ color: studioBrand.green }}>
              Контакты
            </p>
            <p className="font-body text-sm leading-snug" style={{ color: studioBrand.inkMuted }}>
              {bookingStudio.address}
            </p>
            <a
              href={bookingStudioTelHref}
              className="font-body inline-block text-sm font-medium transition hover:opacity-75"
              style={{ color: studioBrand.green }}
            >
              {bookingStudio.phoneDisplay}
            </a>
          </div>

          <div className="space-y-1 md:space-y-2">
            <p className="font-body text-sm font-semibold" style={{ color: studioBrand.green }}>
              Документы
            </p>
            <ul className="space-y-1 md:space-y-2">
              {HOME_FOOTER_LEGAL_LINKS.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="font-body text-sm transition hover:opacity-75"
                    style={{ color: studioBrand.inkMuted }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div
          className="home-gold-divider mx-auto mt-5 max-w-4xl opacity-70 md:mt-10"
          aria-hidden
        />

        <p
          className="font-body mt-4 text-center text-xs leading-relaxed md:mt-6 md:text-left"
          style={{ color: studioBrand.inkMuted }}
        >
          © 2026 Студия красоты «Твоё время». Все права защищены.
        </p>
      </div>
    </footer>
  );
}

/** @deprecated Используйте HomeCard. */
export const HomeFloatingCard = HomeCard;
