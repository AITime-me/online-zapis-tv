"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { BookingLegalConsentFields } from "@/components/booking/booking-legal-links";
import { PhoneCountrySelect } from "@/components/booking/phone-country-select";
import {
  EMPTY_LEAD,
  WHEEL_SPIN_DURATION_MS,
  WheelFortuneView,
  type WheelContactErrors,
  type WheelLeadDraft,
  type WheelPrizeResult,
  type WheelProcedureIntent,
  type WheelUiPhase,
  type WheelZone,
} from "@/components/game/wheel-ui";
import {
  buildProductionWheelShareMessage,
  mapSectorLabelsToWheelSectors,
  mapUiPreferencesToCompletePayload,
  overlayWinningSectorOnWheelSectors,
  sectorIdFromIndex,
} from "@/components/game/wheel-public-ui-adapter";
import {
  buildFullPhoneNumber,
  getPhonePlaceholder,
  validateClientContactFields,
  type PhoneCountryCode,
} from "@/lib/booking/client-validation";
import { createWheelAttemptId } from "@/lib/game/wheel/client-attempt-id";
import type { WheelPublicSectorLabel } from "@/lib/game/wheel/wheel-public-dto";
import { computeRotationForSector } from "@/components/game/wheel-ui/wheel-ui.utils";

type WheelFortunePublicProps = {
  catalogSlug: string;
  title: string;
  sectorLabels: WheelPublicSectorLabel[];
  vkUrl?: string;
  maxUrl?: string;
};

type AnimationResult = {
  sectorIndex: number;
  prizeDisplayName: string;
  totalSectors: number;
};

type FlowMode = "fresh" | "reclaim";

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

function hasUsableLead(lead: WheelLeadDraft, phoneLocal: string): boolean {
  return (
    lead.name.trim().length > 0 &&
    phoneLocal.trim().length > 0 &&
    lead.personalDataConsent &&
    lead.offerAcknowledgement
  );
}

/**
 * Production controller for the public Wheel of Fortune.
 * Owns fetch, opaque sessionStorage keys, phase machine, locks, and API payloads.
 * Presentation lives in wheel-ui and receives only props/callbacks.
 */
export function WheelFortunePublic({
  catalogSlug,
  title,
  sectorLabels,
  vkUrl,
  maxUrl,
}: WheelFortunePublicProps) {
  const [attemptId, setAttemptId] = useState("");
  const [phase, setPhase] = useState<WheelUiPhase>("loading");
  const [flowMode, setFlowMode] = useState<FlowMode>("fresh");
  const [selectedIntent, setSelectedIntent] =
    useState<WheelProcedureIntent | null>(null);
  const [selectedZone, setSelectedZone] = useState<WheelZone | null>(null);
  const [lead, setLead] = useState<WheelLeadDraft>({ ...EMPTY_LEAD });
  const [countryCode, setCountryCode] = useState<PhoneCountryCode>("RU");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [contactErrors, setContactErrors] = useState<
    WheelContactErrors | undefined
  >();
  const [animation, setAnimation] = useState<AnimationResult | null>(null);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [claimStatus, setClaimStatus] = useState<
    "pending" | "submitted" | null
  >(null);
  /** useTransition busy ends at the first await — keep a real in-flight flag for UI locks. */
  const [requestBusy, setRequestBusy] = useState(false);
  const [, startTransition] = useTransition();
  const spinningLock = useRef(false);
  const startRequestSerial = useRef(0);
  const completeRequestSerial = useRef(0);
  const startSucceededRef = useRef(false);
  const spinTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const [confettiActive, setConfettiActive] = useState(false);
  const [sectorOverride, setSectorOverride] = useState<
    ReturnType<typeof mapSectorLabelsToWheelSectors> | null
  >(null);

  const uiBusy =
    requestBusy || phase === "spinning" || phase === "submitting";

  const sectors = useMemo(() => {
    const base = mapSectorLabelsToWheelSectors(sectorLabels);
    return sectorOverride ?? base;
  }, [sectorLabels, sectorOverride]);

  function applyAnimationSectors(next: AnimationResult) {
    setSectorOverride(
      overlayWinningSectorOnWheelSectors(
        mapSectorLabelsToWheelSectors(sectorLabels),
        next,
      ),
    );
  }

  const result: WheelPrizeResult | null = animation
    ? {
        sectorId: sectorIdFromIndex(animation.sectorIndex),
        fullName: animation.prizeDisplayName,
      }
    : null;

  const shareMessage = useMemo(
    () =>
      animation
        ? buildProductionWheelShareMessage({
            prizeDisplayName: animation.prizeDisplayName,
            intent: selectedIntent,
            zone: selectedZone,
          })
        : undefined,
    [animation, selectedIntent, selectedZone],
  );

  function clearSpinTimer() {
    if (spinTimerRef.current !== null) {
      window.clearTimeout(spinTimerRef.current);
      spinTimerRef.current = null;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearSpinTimer();
    };
  }, []);

  useEffect(() => {
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
    let cancelled = false;
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/game/wheel/result?catalogSlug=${encodeURIComponent(catalogSlug)}`,
          { credentials: "include" },
        );
        if (cancelled || !mountedRef.current) return;
        // 404 / non-OK → fresh intro (not a fatal hard-error screen).
        if (!response.ok) {
          setPhase("intro");
          return;
        }
        const data = (await response.json()) as {
          ok?: boolean;
          bookingSubmitted?: boolean;
          animation?: AnimationResult | null;
          status?: string;
        };
        if (!data.ok || !data.animation) {
          setPhase("intro");
          return;
        }
        setAnimation(data.animation);
        applyAnimationSectors(data.animation);
        const mappedSectors = overlayWinningSectorOnWheelSectors(
          mapSectorLabelsToWheelSectors(sectorLabels),
          data.animation,
        );
        setRotationDeg(
          computeRotationForSector(
            sectorIdFromIndex(data.animation.sectorIndex),
            mappedSectors.length > 0 ? mappedSectors : sectors,
            0,
            0,
          ),
        );
        setConfettiActive(false);
        if (data.bookingSubmitted) {
          setClaimStatus("submitted");
          setPhase("restored");
          setFlowMode("fresh");
          return;
        }
        if (data.status === "COMPLETED" || data.status === "ACTIVE") {
          setClaimStatus("pending");
          setPhase("restored");
          setFlowMode("reclaim");
          return;
        }
        setPhase("intro");
      } catch {
        if (!cancelled && mountedRef.current) {
          setPhase("intro");
        }
      }
    });
    return () => {
      cancelled = true;
      clearSpinTimer();
    };
    // sectorLabels identity is stable per SSR render; avoid re-fetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogSlug]);

  function phoneE164() {
    return buildFullPhoneNumber(countryCode, phoneLocal);
  }

  function syncLeadPhone(nextLocal: string, nextCountry: PhoneCountryCode) {
    setLead((prev) => ({
      ...prev,
      phone: buildFullPhoneNumber(nextCountry, nextLocal),
    }));
  }

  function validateContactFields(): WheelContactErrors {
    const contact = validateClientContactFields(lead.name, phoneE164());
    const errors: WheelContactErrors = {};
    if (contact.name) {
      errors.name = contact.name;
    }
    if (contact.phone) {
      errors.phone = contact.phone;
    }
    if (!lead.personalDataConsent) {
      errors.personalDataConsent = "Нужно согласие на обработку данных";
    }
    if (!lead.offerAcknowledgement) {
      errors.offerAcknowledgement = "Подтвердите ознакомление с условиями";
    }
    return errors;
  }

  function goToResult(requestSerial: number) {
    if (requestSerial !== startRequestSerial.current || !mountedRef.current) {
      return;
    }
    setConfettiActive(true);
    setPhase("result");
    spinningLock.current = false;
    setRequestBusy(false);
  }

  async function onSpin() {
    if (spinningLock.current || uiBusy || phase !== "ready") {
      return;
    }
    setError(null);
    const errors = validateContactFields();
    if (Object.keys(errors).length > 0) {
      setContactErrors(errors);
      setPhase("contact");
      setError("Заполните контакты перед вращением");
      return;
    }
    if (!attemptId) {
      setError("Подготовка попытки… попробуйте ещё раз");
      setPhase("error");
      return;
    }

    const mapped = mapUiPreferencesToCompletePayload({
      intent: selectedIntent,
      zone: selectedZone,
    });
    if (!mapped.ok) {
      setError(mapped.error);
      setPhase("preferences");
      return;
    }

    spinningLock.current = true;
    startSucceededRef.current = false;
    setRequestBusy(true);
    const requestSerial = ++startRequestSerial.current;
    startTransition(async () => {
      try {
        const response = await fetch("/api/game/wheel/start", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            catalogSlug,
            name: lead.name.trim(),
            phone: phoneE164(),
            attemptId,
            interest: mapped.payload.interest,
            ...(mapped.payload.confirmedZone
              ? { confirmedZone: mapped.payload.confirmedZone }
              : {}),
            personalDataConsent: true,
            offerAcknowledgement: true,
          }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          animation?: AnimationResult;
        };
        if (
          requestSerial !== startRequestSerial.current ||
          !mountedRef.current
        ) {
          return;
        }
        if (!response.ok || !data.ok || !data.animation) {
          if (startSucceededRef.current) {
            return;
          }
          setError(data.error || "Не удалось начать игру");
          setPhase("error");
          spinningLock.current = false;
          setRequestBusy(false);
          return;
        }
        startSucceededRef.current = true;
        setError(null);
        setAnimation(data.animation);
        applyAnimationSectors(data.animation);
        setPhase("spinning");

        const target = computeRotationForSector(
          sectorIdFromIndex(data.animation.sectorIndex),
          sectors,
          rotationDeg,
        );
        const reduced = prefersReducedMotion();
        if (reduced) {
          setRotationDeg(target);
          goToResult(requestSerial);
          return;
        }
        requestAnimationFrame(() => {
          if (
            requestSerial === startRequestSerial.current &&
            mountedRef.current
          ) {
            setRotationDeg(target);
          }
        });
        clearSpinTimer();
        spinTimerRef.current = window.setTimeout(() => {
          goToResult(requestSerial);
        }, WHEEL_SPIN_DURATION_MS);
      } catch {
        if (
          requestSerial !== startRequestSerial.current ||
          startSucceededRef.current ||
          !mountedRef.current
        ) {
          return;
        }
        setError("Сеть недоступна. Попробуйте ещё раз.");
        setPhase("error");
        spinningLock.current = false;
        setRequestBusy(false);
      }
    });
  }

  async function runComplete() {
    if (uiBusy || spinningLock.current) {
      return;
    }
    if (!animation) {
      setError("Нет активной игровой сессии для отправки заявки");
      setPhase("error");
      return;
    }
    setError(null);

    const mapped = mapUiPreferencesToCompletePayload({
      intent: selectedIntent,
      zone: selectedZone,
    });
    if (!mapped.ok) {
      setError(mapped.error);
      setPhase("preferences");
      return;
    }

    const errors = validateContactFields();
    if (Object.keys(errors).length > 0) {
      setContactErrors(errors);
      setPhase("contact");
      return;
    }

    const claimKeyStorage = claimStorageKey(catalogSlug);
    let idempotencyKey = window.sessionStorage.getItem(claimKeyStorage);
    if (!idempotencyKey) {
      idempotencyKey = createWheelAttemptId();
      window.sessionStorage.setItem(claimKeyStorage, idempotencyKey);
    }

    spinningLock.current = true;
    setRequestBusy(true);
    setConfettiActive(false);
    setPhase("submitting");
    const requestSerial = ++completeRequestSerial.current;
    startTransition(async () => {
      try {
        const body: {
          catalogSlug: string;
          interest: string;
          confirmedZone?: string;
          name: string;
          phone: string;
          personalDataConsent: boolean;
          offerAcknowledgement: boolean;
        } = {
          catalogSlug,
          interest: mapped.payload.interest,
          name: lead.name.trim(),
          phone: phoneE164(),
          personalDataConsent: true,
          offerAcknowledgement: true,
        };
        if (mapped.payload.confirmedZone) {
          body.confirmedZone = mapped.payload.confirmedZone;
        }

        const response = await fetch("/api/game/wheel/complete", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey!,
          },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          prizeDisplayName?: string;
        };
        if (
          requestSerial !== completeRequestSerial.current ||
          !mountedRef.current
        ) {
          return;
        }
        if (!response.ok || !data.ok) {
          setError(data.error || "Не удалось отправить заявку");
          setPhase(flowMode === "reclaim" ? "contact" : "result");
          spinningLock.current = false;
          setRequestBusy(false);
          return;
        }
        if (data.prizeDisplayName && animation) {
          const nextAnimation = {
            ...animation,
            prizeDisplayName: data.prizeDisplayName,
          };
          setAnimation(nextAnimation);
          applyAnimationSectors(nextAnimation);
        }
        setClaimStatus("submitted");
        setPhase("submitted");
        setFlowMode("fresh");
        clearWheelSessionKeys(catalogSlug);
        spinningLock.current = false;
        setRequestBusy(false);
      } catch {
        if (
          requestSerial !== completeRequestSerial.current ||
          !mountedRef.current
        ) {
          return;
        }
        setError(
          "Сеть недоступна. Повторите отправку — результат не потеряется.",
        );
        setPhase(flowMode === "reclaim" ? "contact" : "result");
        spinningLock.current = false;
        setRequestBusy(false);
      }
    });
  }

  function onClaim() {
    if (uiBusy || spinningLock.current) {
      return;
    }
    setError(null);

    if (phase === "restored" && claimStatus === "pending") {
      setFlowMode("reclaim");
      if (!selectedIntent) {
        setPhase("preferences");
        return;
      }
      if (!hasUsableLead(lead, phoneLocal)) {
        setPhase("contact");
        return;
      }
      void runComplete();
      return;
    }

    if (phase === "result") {
      void runComplete();
    }
  }

  function onContactContinue() {
    if (uiBusy || spinningLock.current) {
      return;
    }
    const errors = validateContactFields();
    setContactErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setContactErrors(undefined);
    setLead((prev) => ({
      ...prev,
      phone: phoneE164(),
    }));
    if (flowMode === "reclaim") {
      void runComplete();
      return;
    }
    setPhase("ready");
  }

  function onPreferencesContinue() {
    if (uiBusy) return;
    if (!selectedIntent) return;
    if (selectedIntent !== "undecided" && !selectedZone) return;
    setPhase("contact");
  }

  function onIntentChange(intent: WheelProcedureIntent | null) {
    setSelectedIntent(intent);
    if (intent === "undecided" || intent === null) {
      setSelectedZone(null);
    }
  }

  function onBack() {
    if (uiBusy) return;
    setError(null);
    setContactErrors(undefined);
    switch (phase) {
      case "preferences":
        setPhase(flowMode === "reclaim" ? "restored" : "intro");
        break;
      case "contact":
        setPhase("preferences");
        break;
      case "ready":
        setPhase("contact");
        break;
      default:
        break;
    }
  }

  function onReset() {
    if (uiBusy && phase !== "error") return;
    setError(null);
    setContactErrors(undefined);
    if (claimStatus === "submitted" || phase === "submitted") {
      setPhase("restored");
      setClaimStatus("submitted");
      return;
    }
    setPhase("intro");
    setFlowMode("fresh");
  }

  const phoneSlot = (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-[var(--wheel-ink)]">
        Телефон
      </span>
      <div className="flex gap-2">
        <PhoneCountrySelect
          value={countryCode}
          onChange={(next) => {
            setCountryCode(next);
            syncLeadPhone(phoneLocal, next);
          }}
          borderColor="#c8b69c"
          className="min-h-12 rounded-2xl border px-3 text-sm text-[var(--wheel-ink)]"
        />
        <input
          type="tel"
          className="min-h-12 flex-1 rounded-2xl border border-[var(--wheel-beige)]/80 bg-[var(--wheel-cream)] px-4 text-[16px] text-[var(--wheel-ink)]"
          value={phoneLocal}
          onChange={(event) => {
            const next = event.target.value;
            setPhoneLocal(next);
            syncLeadPhone(next, countryCode);
          }}
          placeholder={getPhonePlaceholder(countryCode)}
          inputMode="tel"
          autoComplete="tel-national"
          aria-label="Номер телефона"
          data-testid="wheel-phone-input"
          disabled={uiBusy}
        />
      </div>
      {contactErrors?.phone ? (
        <p role="alert" className="text-sm text-[var(--wheel-danger)]">
          {contactErrors.phone}
        </p>
      ) : null}
    </div>
  );

  const consentSlot = (
    <BookingLegalConsentFields
      personalDataConsent={lead.personalDataConsent}
      onPersonalDataConsentChange={(value) =>
        setLead((prev) => ({ ...prev, personalDataConsent: value }))
      }
      offerAcknowledgement={lead.offerAcknowledgement}
      onOfferAcknowledgementChange={(value) =>
        setLead((prev) => ({ ...prev, offerAcknowledgement: value }))
      }
      personalDataConsentError={contactErrors?.personalDataConsent}
      offerAcknowledgementError={contactErrors?.offerAcknowledgement}
      textColor="#3a4f49"
    />
  );

  return (
    <div data-testid="wheel-fortune-public">
      <div className="sr-only" aria-live="polite" role="status">
        {phase === "spinning"
          ? "Колесо крутится"
          : phase === "submitting"
            ? "Отправляем заявку"
            : phase === "submitted" || claimStatus === "submitted"
              ? "Заявка отправлена"
              : phase === "result" && animation
                ? `Ваш приз: ${animation.prizeDisplayName}`
                : phase === "restored" && animation
                  ? `Сохранённый приз: ${animation.prizeDisplayName}`
                  : ""}
      </div>
      {error && phase !== "error" ? (
        <p
          className="mx-auto mb-3 max-w-[640px] rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
          data-testid="wheel-error-alert"
        >
          {error}
        </p>
      ) : null}
      <WheelFortuneView
        title={title}
        phase={phase}
        sectors={sectors}
        selectedIntent={selectedIntent}
        selectedZone={selectedZone}
        lead={lead}
        result={result}
        rotationDeg={rotationDeg}
        busy={uiBusy}
        error={error}
        contactErrors={contactErrors}
        claimStatus={claimStatus}
        contactContext={
          flowMode === "reclaim" ? "restored-pending" : "pre-spin"
        }
        phoneSlot={phoneSlot}
        consentSlot={consentSlot}
        shareMessage={shareMessage}
        vkUrl={vkUrl}
        maxUrl={maxUrl}
        confettiActive={confettiActive}
        onStart={() => {
          if (uiBusy) return;
          setError(null);
          setFlowMode("fresh");
          setPhase("preferences");
        }}
        onIntentChange={onIntentChange}
        onZoneChange={setSelectedZone}
        onLeadChange={setLead}
        onPreferencesContinue={onPreferencesContinue}
        onContactContinue={onContactContinue}
        onSpin={() => {
          void onSpin();
        }}
        onClaim={() => {
          void onClaim();
        }}
        onBack={onBack}
        onReset={onReset}
      />
    </div>
  );
}
