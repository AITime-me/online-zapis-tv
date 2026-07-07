"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { bookingStudio, bookingStudioTelHref } from "@/components/booking/booking-config";
import { StudioLogo } from "@/components/brand/studio-logo";
import { HOME_NAV } from "@/components/home/home-data";
import { HomeButton } from "@/components/home/home-ui";
import { studioBrand } from "@/lib/brand/studio-brand";

export function HomeHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 12);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header
      className={`home-header sticky top-0 z-50 border-b backdrop-blur-md transition-[background-color,box-shadow,border-color] duration-300 ease-out ${
        scrolled || menuOpen ? "is-scrolled" : ""
      }`}
      style={{ borderColor: studioBrand.goldLineSoft }}
    >
      <div className="home-header-bar mx-auto w-full max-w-6xl overflow-hidden px-4 py-3 md:px-6 md:py-3.5 lg:py-4">
        <div className="flex min-w-0 items-center justify-between gap-2 sm:gap-3 lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
          <Link
            href="/"
            className="home-header-logo min-w-0 flex-1 lg:flex-none"
            aria-label="Твоё время — на главную"
            onClick={closeMenu}
          >
            <StudioLogo priority size="sm" className="home-header-logo-img" />
          </Link>

          <nav
            className="hidden min-w-0 items-center justify-center gap-6 xl:gap-8 lg:flex"
            aria-label="Основная навигация"
          >
            {HOME_NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="font-body whitespace-nowrap text-sm font-medium transition hover:opacity-70"
                style={{ color: studioBrand.greenMuted }}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="home-header-actions flex shrink-0 items-center justify-end gap-2">
            <HomeButton
              href="/booking"
              className="hidden min-h-11 shrink-0 whitespace-nowrap px-4 py-2.5 text-sm md:inline-flex md:px-5 lg:px-6 lg:text-base"
            >
              Записаться онлайн
            </HomeButton>

            <button
              type="button"
              className="home-menu-toggle flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border lg:hidden"
              style={{ borderColor: studioBrand.goldLineSoft, color: studioBrand.green }}
              aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={menuOpen}
              aria-controls="home-mobile-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="sr-only">Меню</span>
              <span className="flex w-5 flex-col gap-1.5" aria-hidden>
                <span
                  className={`block h-0.5 w-full rounded-full transition-transform duration-300 ${
                    menuOpen ? "translate-y-2 rotate-45" : ""
                  }`}
                  style={{ backgroundColor: studioBrand.green }}
                />
                <span
                  className={`block h-0.5 w-full rounded-full transition-opacity duration-300 ${
                    menuOpen ? "opacity-0" : ""
                  }`}
                  style={{ backgroundColor: studioBrand.green }}
                />
                <span
                  className={`block h-0.5 w-full rounded-full transition-transform duration-300 ${
                    menuOpen ? "-translate-y-2 -rotate-45" : ""
                  }`}
                  style={{ backgroundColor: studioBrand.green }}
                />
              </span>
            </button>
          </div>
        </div>
      </div>

      {menuOpen ? (
        <>
          <button
            type="button"
            className="home-mobile-menu-backdrop fixed inset-0 z-40 bg-[#124032]/20 lg:hidden"
            aria-label="Закрыть меню"
            onClick={closeMenu}
          />
          <div
            id="home-mobile-menu"
            className="home-mobile-menu home-mobile-menu-panel relative z-50 border-t lg:hidden"
            style={{
              borderColor: studioBrand.goldLineSoft,
              backgroundColor: "rgba(250, 247, 242, 0.98)",
            }}
          >
            <nav
              className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4"
              aria-label="Мобильная навигация"
            >
              {HOME_NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={closeMenu}
                  className="home-mobile-menu-link font-body rounded-xl px-4 py-3.5 text-base font-medium transition"
                  style={{ color: studioBrand.green }}
                >
                  {item.label}
                </a>
              ))}

              <div className="home-gold-divider my-3 opacity-60" aria-hidden />

              <div className="px-4 py-2">
                <p
                  className="font-body text-xs font-semibold uppercase tracking-[0.18em]"
                  style={{ color: studioBrand.gold }}
                >
                  Контакты
                </p>
                <p
                  className="font-body mt-2 text-sm leading-relaxed"
                  style={{ color: studioBrand.inkMuted }}
                >
                  {bookingStudio.address}
                </p>
                <a
                  href={bookingStudioTelHref}
                  className="font-body mt-1 inline-block text-sm font-medium transition hover:opacity-75"
                  style={{ color: studioBrand.green }}
                  onClick={closeMenu}
                >
                  {bookingStudio.phoneDisplay}
                </a>
              </div>

              <HomeButton href="/booking" className="mt-3 w-full md:hidden" onClick={closeMenu}>
                Записаться онлайн
              </HomeButton>
            </nav>
          </div>
        </>
      ) : null}
    </header>
  );
}
