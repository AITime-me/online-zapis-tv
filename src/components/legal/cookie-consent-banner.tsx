"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { bookingTheme } from "@/components/booking/booking-theme";
import {
  promoPathNeedsCookieBannerOffset,
  shouldShowCookieBanner,
  WHEEL_COOKIE_BANNER_OFFSET_VAR,
} from "@/lib/legal/cookie-banner-placement";

const CONSENT_STORAGE_KEY = "tvoe_vremya_cookie_consent";
const CONSENT_ACCEPTED_VALUE = "accepted";
const PROMO_BANNER_OFFSET_FALLBACK_PX = 168;
const PROMO_BANNER_GAP_PX = 16;

function clearWheelCookieBannerOffset(): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.removeProperty(WHEEL_COOKIE_BANNER_OFFSET_VAR);
}

function applyWheelCookieBannerOffset(heightPx: number): void {
  const measured = Number.isFinite(heightPx) ? Math.ceil(heightPx) : 0;
  const offset =
    (measured > 0 ? measured : PROMO_BANNER_OFFSET_FALLBACK_PX) +
    PROMO_BANNER_GAP_PX;
  document.documentElement.style.setProperty(
    WHEEL_COOKIE_BANNER_OFFSET_VAR,
    `${offset}px`,
  );
}

const DEFAULT_BANNER_TEXT =
  "Мы используем cookie, чтобы сайт работал корректно и становился удобнее. Продолжая пользоваться сайтом, вы соглашаетесь с использованием cookie.";
const DEFAULT_DETAILS_URL = "/cookies";

export function CookieConsentBanner() {
  const pathname = usePathname();
  const bannerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [bannerText, setBannerText] = useState(DEFAULT_BANNER_TEXT);
  const [detailsUrl, setDetailsUrl] = useState(DEFAULT_DETAILS_URL);

  useEffect(() => {
    if (!shouldShowCookieBanner(pathname)) {
      setVisible(false);
      clearWheelCookieBannerOffset();
      return;
    }

    const accepted = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (accepted === CONSENT_ACCEPTED_VALUE) {
      setVisible(false);
      clearWheelCookieBannerOffset();
      return;
    }

    setVisible(true);

    void fetch("/api/settings/public")
      .then((response) => response.json())
      .then((payload) => {
        if (!payload.ok || !payload.settings) return;
        if (typeof payload.settings.cookieBannerText === "string") {
          const text = payload.settings.cookieBannerText.trim();
          if (text) setBannerText(text);
        }
        if (typeof payload.settings.cookieDetailsUrl === "string") {
          const url = payload.settings.cookieDetailsUrl.trim();
          if (url) setDetailsUrl(url);
        }
      })
      .catch(() => {
        // Оставляем дефолтные значения.
      });
  }, [pathname]);

  useEffect(() => {
    if (!visible || !promoPathNeedsCookieBannerOffset(pathname)) {
      clearWheelCookieBannerOffset();
      return;
    }

    const node = bannerRef.current;
    if (!node) {
      applyWheelCookieBannerOffset(0);
      return;
    }

    const apply = () => {
      applyWheelCookieBannerOffset(node.getBoundingClientRect().height);
    };
    apply();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      clearWheelCookieBannerOffset();
    };
  }, [visible, pathname, bannerText]);

  const acceptCookies = () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, CONSENT_ACCEPTED_VALUE);
    clearWheelCookieBannerOffset();
    setVisible(false);
  };

  if (!visible) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex justify-center md:inset-x-auto md:right-6 md:bottom-6 md:justify-end"
      role="dialog"
      aria-live="polite"
      aria-label="Уведомление об использовании cookie"
      data-testid="cookie-consent-banner"
    >
      <div
        ref={bannerRef}
        className="pointer-events-auto w-full max-w-[min(100%,32.5rem)] rounded-2xl border px-4 py-3.5 shadow-[0_12px_40px_rgba(18,64,50,0.12)] sm:px-5 sm:py-4"
        style={{
          borderColor: bookingTheme.goldMuted,
          backgroundColor: "#fffdf9",
        }}
      >
        <p
          className="font-body text-sm leading-relaxed"
          style={{ color: bookingTheme.greenMuted }}
        >
          {bannerText}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 sm:gap-2.5">
          <Link
            href={detailsUrl}
            className="font-body inline-flex min-h-9 items-center justify-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition hover:opacity-90 sm:px-4"
            style={{
              borderColor: bookingTheme.border,
              backgroundColor: bookingTheme.surface,
              color: bookingTheme.green,
            }}
          >
            Подробнее
          </Link>
          <button
            type="button"
            onClick={acceptCookies}
            className="font-body inline-flex min-h-9 items-center justify-center rounded-full px-3.5 py-1.5 text-sm font-medium text-white transition hover:opacity-90 sm:px-4"
            style={{ backgroundColor: bookingTheme.green }}
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}
