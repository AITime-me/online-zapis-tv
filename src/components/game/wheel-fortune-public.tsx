"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { BookingLegalConsentFields } from "@/components/booking/booking-legal-links";
import { PhoneCountrySelect } from "@/components/booking/phone-country-select";
import {
  buildFullPhoneNumber,
  getPhonePlaceholder,
  type PhoneCountryCode,
} from "@/lib/booking/client-validation";
import { createWheelAttemptId } from "@/lib/game/wheel/client-attempt-id";
import {
  WHEEL_PUBLIC_INTEREST_KEYS,
  WHEEL_PUBLIC_INTEREST_LABELS,
  type WheelPublicInterestKey,
} from "@/lib/game/wheel/public-interest";
import type { WheelPublicSectorLabel } from "@/lib/game/wheel/wheel-public-dto";

type WheelFortunePublicProps = {
  catalogSlug: string;
  title: string;
  sectorLabels: WheelPublicSectorLabel[];
};

type AnimationResult = {
  sectorIndex: number;
  prizeDisplayName: string;
  totalSectors: number;
};

type Phase = "lead" | "spinning" | "result" | "claim" | "submitted";

const ZONE_OPTIONS = [
  { value: "lips", label: "Губы" },
  { value: "brows", label: "Брови" },
  { value: "eyelids", label: "Веки" },
] as const;

function attemptStorageKey(slug: string) {
  return `wheel_attempt_${slug}`;
}

function claimStorageKey(slug: string) {
  return `wheel_claim_idempotency_${slug}`;
}

function clearWheelSessionKeys(slug: string) {
  window.sessionStorage.removeItem(attemptStorageKey(slug));
  window.sessionStorage.removeItem(claimStorageKey(slug));
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function WheelFortunePublic({
  catalogSlug,
  title,
  sectorLabels,
}: WheelFortunePublicProps) {
  const [attemptId, setAttemptId] = useState("");
  const [phase, setPhase] = useState<Phase>("lead");
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState<PhoneCountryCode>("RU");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [personalDataConsent, setPersonalDataConsent] = useState(false);
  const [offerAcknowledgement, setOfferAcknowledgement] = useState(false);
  const [interest, setInterest] = useState<WheelPublicInterestKey | "">("");
  const [confirmedZone, setConfirmedZone] = useState<string>("");
  const [animation, setAnimation] = useState<AnimationResult | null>(null);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, startTransition] = useTransition();
  const spinningLock = useRef(false);
  const startRequestSerial = useRef(0);
  const startSucceededRef = useRef(false);
  const totalSectors = Math.max(sectorLabels.length, 16);
  const sectorAngle = 360 / totalSectors;
  void sectorAngle;

  useEffect(() => {
    // Hydrate from sessionStorage after paint to avoid cascading sync setState-in-effect.
    queueMicrotask(() => {
      const key = attemptStorageKey(catalogSlug);
      const existing = window.sessionStorage.getItem(key);
      if (existing && existing.length >= 16) {
        setAttemptId(existing);
        return;
      }
      const created = createWheelAttemptId();
      window.sessionStorage.setItem(key, created);
      setAttemptId(created);
    });
  }, [catalogSlug]);

  useEffect(() => {
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/game/wheel/result?catalogSlug=${encodeURIComponent(catalogSlug)}`,
          { credentials: "include" },
        );
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as {
          ok?: boolean;
          bookingSubmitted?: boolean;
          animation?: AnimationResult | null;
          status?: string;
        };
        if (!data.ok || !data.animation) {
          return;
        }
        setAnimation(data.animation);
        setRotationDeg(computeTargetRotation(data.animation.sectorIndex, totalSectors));
        if (data.bookingSubmitted) {
          setPhase("submitted");
          setStatusMessage("Заявка уже отправлена. Студия свяжется с вами.");
          return;
        }
        if (data.status === "COMPLETED" || data.status === "ACTIVE") {
          setPhase("claim");
          setStatusMessage(`Ваш приз: ${data.animation.prizeDisplayName}`);
        }
      } catch {
        // ignore resume errors
      }
    });
  }, [catalogSlug, totalSectors]);

  function phoneE164() {
    return buildFullPhoneNumber(countryCode, phoneLocal);
  }

  function computeTargetRotation(sectorIndex: number, sectors: number) {
    const angle = 360 / sectors;
    const pointerCenter = 0;
    const sectorCenter = sectorIndex * angle + angle / 2;
    const base = 360 * 4;
    return base + (pointerCenter - sectorCenter);
  }

  async function onStart() {
    if (spinningLock.current || busy) {
      return;
    }
    setError(null);
    if (!name.trim()) {
      setError("Укажите имя");
      return;
    }
    if (!phoneLocal.trim()) {
      setError("Укажите телефон");
      return;
    }
    if (!personalDataConsent || !offerAcknowledgement) {
      setError("Примите обязательные согласия");
      return;
    }
    if (!attemptId) {
      setError("Подготовка попытки… попробуйте ещё раз");
      return;
    }
    spinningLock.current = true;
    startSucceededRef.current = false;
    const requestSerial = ++startRequestSerial.current;
    startTransition(async () => {
      try {
        const response = await fetch("/api/game/wheel/start", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            catalogSlug,
            name: name.trim(),
            phone: phoneE164(),
            attemptId,
            personalDataConsent: true,
            offerAcknowledgement: true,
          }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          animation?: AnimationResult;
        };
        // Ignore stale responses from overlapping submits (e.g. double-click /
        // parallel requests that lost the visitor-cookie race).
        if (requestSerial !== startRequestSerial.current) {
          return;
        }
        if (!response.ok || !data.ok || !data.animation) {
          if (startSucceededRef.current) {
            return;
          }
          setError(data.error || "Не удалось начать игру");
          spinningLock.current = false;
          return;
        }
        startSucceededRef.current = true;
        setError(null);
        setAnimation(data.animation);
        setPhase("spinning");
        setStatusMessage("Колесо крутится…");
        const reduced = prefersReducedMotion();
        const target = computeTargetRotation(
          data.animation.sectorIndex,
          data.animation.totalSectors || totalSectors,
        );
        if (reduced) {
          setRotationDeg(target);
          setPhase("claim");
          setStatusMessage(`Ваш приз: ${data.animation.prizeDisplayName}`);
          spinningLock.current = false;
          return;
        }
        requestAnimationFrame(() => {
          setRotationDeg(target);
        });
        window.setTimeout(() => {
          if (requestSerial !== startRequestSerial.current) {
            return;
          }
          setPhase("claim");
          setStatusMessage(`Ваш приз: ${data.animation!.prizeDisplayName}`);
          spinningLock.current = false;
        }, 4200);
      } catch {
        if (
          requestSerial !== startRequestSerial.current ||
          startSucceededRef.current
        ) {
          return;
        }
        setError("Сеть недоступна. Попробуйте ещё раз.");
        spinningLock.current = false;
      }
    });
  }

  async function onComplete() {
    if (busy || spinningLock.current) {
      return;
    }
    setError(null);
    if (!interest) {
      setError("Выберите интерес");
      return;
    }
    if (
      (interest === "cover" || interest === "refresh") &&
      !confirmedZone
    ) {
      setError("Укажите зону для перекрытия или рефреша");
      return;
    }
    if (!personalDataConsent || !offerAcknowledgement) {
      setError("Примите обязательные согласия");
      return;
    }

    const claimKeyStorage = claimStorageKey(catalogSlug);
    let idempotencyKey = window.sessionStorage.getItem(claimKeyStorage);
    if (!idempotencyKey) {
      idempotencyKey = createWheelAttemptId();
      window.sessionStorage.setItem(claimKeyStorage, idempotencyKey);
    }

    spinningLock.current = true;
    startTransition(async () => {
      try {
        const response = await fetch("/api/game/wheel/complete", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey!,
          },
          body: JSON.stringify({
            catalogSlug,
            interest,
            confirmedZone:
              interest === "cover" || interest === "refresh"
                ? confirmedZone
                : undefined,
            name: name.trim(),
            phone: phoneE164(),
            personalDataConsent: true,
            offerAcknowledgement: true,
          }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          prizeDisplayName?: string;
        };
        if (!response.ok || !data.ok) {
          setError(data.error || "Не удалось отправить заявку");
          spinningLock.current = false;
          return;
        }
        setPhase("submitted");
        setStatusMessage(
          `Заявка принята. Ваш приз: ${data.prizeDisplayName || animation?.prizeDisplayName || "приз"}. Студия свяжется с вами.`,
        );
        clearWheelSessionKeys(catalogSlug);
        spinningLock.current = false;
      } catch {
        setError("Сеть недоступна. Повторите отправку — результат не потеряется.");
        spinningLock.current = false;
      }
    });
  }

  return (
    <main
      className="mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col gap-4 px-4 py-6 text-zinc-900"
      data-testid="wheel-fortune-public"
    >
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800">
          Твоё время
        </p>
        <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
      </header>

      <section
        className="relative mx-auto aspect-square w-full max-w-[340px]"
        aria-label="Колесо фортуны"
      >
        <div
          className="absolute left-1/2 top-0 z-10 h-0 w-0 -translate-x-1/2 border-l-[10px] border-r-[10px] border-t-[18px] border-l-transparent border-r-transparent border-t-emerald-800"
          aria-hidden
        />
        <div
          className="h-full w-full rounded-full border-4 border-emerald-900 shadow-inner transition-transform ease-out"
          style={{
            transform: `rotate(${rotationDeg}deg)`,
            transitionDuration: prefersReducedMotion() ? "0ms" : "4000ms",
            background: conicGradient(sectorLabels, totalSectors),
          }}
        />
        <div className="absolute inset-[32%] flex items-center justify-center rounded-full bg-white text-center text-sm font-medium shadow">
          {animation?.prizeDisplayName || "Крутите колесо"}
        </div>
      </section>

      <div className="sr-only" aria-live="polite" role="status">
        {statusMessage}
      </div>

      {error ? (
        <p
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
          data-testid="wheel-error-alert"
        >
          {error}
        </p>
      ) : null}

      {phase === "lead" || phase === "spinning" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onStart();
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Имя
            <input
              className="min-h-12 rounded border border-zinc-300 px-3"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Телефон
            <div className="flex gap-2">
              <PhoneCountrySelect
                value={countryCode}
                onChange={setCountryCode}
                borderColor="#d4d4d8"
                className="min-h-12 rounded border px-3 text-sm"
              />
              <input
                type="tel"
                className="min-h-12 flex-1 rounded border border-zinc-300 px-3"
                value={phoneLocal}
                onChange={(event) => setPhoneLocal(event.target.value)}
                placeholder={getPhonePlaceholder(countryCode)}
                inputMode="tel"
                autoComplete="tel-national"
                aria-label="Номер телефона"
                data-testid="wheel-phone-input"
                required
              />
            </div>
          </label>
          <BookingLegalConsentFields
            personalDataConsent={personalDataConsent}
            onPersonalDataConsentChange={setPersonalDataConsent}
            offerAcknowledgement={offerAcknowledgement}
            onOfferAcknowledgementChange={setOfferAcknowledgement}
          />
          <button
            type="submit"
            className="min-h-12 rounded bg-emerald-800 px-4 text-base font-medium text-white disabled:opacity-60"
            disabled={busy || phase === "spinning"}
            data-testid="wheel-start-button"
          >
            {phase === "spinning" ? "Крутим…" : "Крутить колесо"}
          </button>
        </form>
      ) : null}

      {phase === "claim" && animation ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onComplete();
          }}
        >
          <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            Ваш результат:{" "}
            <strong data-testid="wheel-prize-name">
              {animation.prizeDisplayName}
            </strong>
          </p>
          {/*
            Name/phone stay in React state across spin→claim, but are lost on
            refresh. Claim form must collect them again (no PII in sessionStorage).
          */}
          <label className="flex flex-col gap-1 text-sm">
            Имя
            <input
              className="min-h-12 rounded border border-zinc-300 px-3"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Телефон
            <div className="flex gap-2">
              <PhoneCountrySelect
                value={countryCode}
                onChange={setCountryCode}
                borderColor="#d4d4d8"
                className="min-h-12 rounded border px-3 text-sm"
              />
              <input
                type="tel"
                className="min-h-12 flex-1 rounded border border-zinc-300 px-3"
                value={phoneLocal}
                onChange={(event) => setPhoneLocal(event.target.value)}
                placeholder={getPhonePlaceholder(countryCode)}
                inputMode="tel"
                autoComplete="tel-national"
                aria-label="Номер телефона"
                data-testid="wheel-phone-input"
                required
              />
            </div>
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Что вас интересует?</legend>
            {WHEEL_PUBLIC_INTEREST_KEYS.map((key) => (
              <label key={key} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="interest"
                  value={key}
                  checked={interest === key}
                  onChange={() => {
                    setInterest(key);
                    setConfirmedZone("");
                  }}
                />
                {WHEEL_PUBLIC_INTEREST_LABELS[key]}
              </label>
            ))}
          </fieldset>
          {interest === "cover" || interest === "refresh" ? (
            <label className="flex flex-col gap-1 text-sm">
              Зона
              <select
                className="min-h-12 rounded border border-zinc-300 px-3"
                value={confirmedZone}
                onChange={(event) => setConfirmedZone(event.target.value)}
                required
              >
                <option value="">Выберите зону</option>
                {ZONE_OPTIONS.map((zone) => (
                  <option key={zone.value} value={zone.value}>
                    {zone.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <BookingLegalConsentFields
            personalDataConsent={personalDataConsent}
            onPersonalDataConsentChange={setPersonalDataConsent}
            offerAcknowledgement={offerAcknowledgement}
            onOfferAcknowledgementChange={setOfferAcknowledgement}
          />
          <button
            type="submit"
            className="min-h-12 rounded bg-emerald-800 px-4 text-base font-medium text-white disabled:opacity-60"
            disabled={busy}
            data-testid="wheel-complete-button"
          >
            Отправить заявку
          </button>
        </form>
      ) : null}

      {phase === "submitted" ? (
        <div
          className="rounded border border-emerald-200 bg-emerald-50 px-4 py-5 text-center text-sm text-emerald-950"
          data-testid="wheel-submitted"
        >
          <p className="text-base font-semibold">Спасибо!</p>
          <p className="mt-2" data-testid="wheel-submitted-status">
            {statusMessage}
          </p>
        </div>
      ) : null}

      {sectorLabels.length > 0 ? (
        <details className="text-sm text-zinc-600">
          <summary className="cursor-pointer">Секторы колеса</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {sectorLabels.map((sector) => (
              <li key={sector.sectorIndex}>
                {sector.sectorIndex + 1}. {sector.prizeDisplayName}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </main>
  );
}

function conicGradient(
  sectors: WheelPublicSectorLabel[],
  totalSectors: number,
): string {
  const colors = ["#ecfdf5", "#d1fae5", "#a7f3d0", "#6ee7b7"];
  const angle = 360 / totalSectors;
  const stops: string[] = [];
  for (let index = 0; index < totalSectors; index += 1) {
    const color = colors[index % colors.length]!;
    stops.push(
      `${color} ${index * angle}deg ${(index + 1) * angle}deg`,
    );
  }
  void sectors;
  return `conic-gradient(from -90deg, ${stops.join(", ")})`;
}
