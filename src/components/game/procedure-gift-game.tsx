"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookingClientFields } from "@/components/booking/booking-client-fields";
import {
  buildFullPhoneNumber,
  type ClientDataFieldErrors,
  type PhoneCountryCode,
  validateClientData,
} from "@/lib/booking/client-validation";
import { studioBrand } from "@/lib/brand/studio-brand";

type PublicGameConfig = {
  isActive: boolean;
  title: string;
  description: string;
  image: string | null;
  resultHeaderText: string;
  directionLabelText: string;
  giftLabelText: string;
  ctaButtonText: string;
  managerMessageHeader: string;
  managerMessageFooter: string;
};

type GameGift = {
  id: string;
  name: string;
  shortDescription: string;
  image: string | null;
  priority: string;
  cardStyle: string;
};

type Step = "intro" | "quiz" | "result" | "lead";

function buildManagerMessage(input: {
  header: string;
  footer: string;
  gameDirection: string;
  skinNeed: string;
  resultType: string;
  premiumLevel: number;
  gift: GameGift | null;
  clientName: string;
}): string {
  const lines: string[] = [];
  if (input.header.trim()) {
    lines.push(input.header.trim());
  }
  lines.push("");
  lines.push("Направление: " + input.gameDirection);
  lines.push("Потребность: " + input.skinNeed);
  lines.push("Тип результата: " + input.resultType);
  lines.push("Premium level: " + String(input.premiumLevel));
  lines.push("");
  lines.push("Мой подарок: " + (input.gift?.name ?? "—"));
  lines.push("");
  if (input.footer.trim()) {
    lines.push(input.footer.trim());
    lines.push("");
  }
  lines.push("Имя:");
  lines.push(input.clientName.trim());
  return lines.join("\n");
}

export function ProcedureGiftGame({ config }: { config: PublicGameConfig | null }) {
  const [step, setStep] = useState<Step>("intro");

  // “Механика игры” сейчас минимальная (опрос). Можно расширять без смены API.
  const [gameDirection, setGameDirection] = useState("лицо");
  const [skinNeed, setSkinNeed] = useState("увлажнение");
  const [resultType, setResultType] = useState("качество кожи");
  const [premiumLevel, setPremiumLevel] = useState(0);

  const [playId, setPlayId] = useState<string | null>(null);
  const [gift, setGift] = useState<GameGift | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState<PhoneCountryCode>("RU");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ClientDataFieldErrors>({});
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadSuccess, setLeadSuccess] = useState(false);

  const fullPhone = useMemo(
    () => buildFullPhoneNumber(countryCode, phoneLocal),
    [countryCode, phoneLocal],
  );

  if (!config) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 md:px-6">
        <div className="rounded-2xl border bg-white p-6" style={{ borderColor: studioBrand.goldLine }}>
          <h1 className="font-display text-2xl font-semibold" style={{ color: studioBrand.green }}>
            Игра недоступна
          </h1>
          <p className="font-body mt-3 text-sm" style={{ color: studioBrand.inkMuted }}>
            Конфигурация игры ещё не настроена.
          </p>
          <div className="mt-6">
            <Link
              href="/"
              className="home-btn home-btn-secondary font-body inline-flex min-h-12 items-center justify-center rounded-2xl border bg-white/92 px-5 py-3 text-base font-medium text-[var(--brand-green)]"
            >
              На главную
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!config.isActive) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 md:px-6">
        <div className="rounded-2xl border bg-white p-6" style={{ borderColor: studioBrand.goldLine }}>
          <h1 className="font-display text-2xl font-semibold" style={{ color: studioBrand.green }}>
            {config.title}
          </h1>
          <p className="font-body mt-3 text-sm" style={{ color: studioBrand.inkMuted }}>
            Игра временно выключена. Попробуйте позже.
          </p>
          <div className="mt-6">
            <Link
              href="/booking"
              className="home-btn home-btn-primary font-body inline-flex min-h-12 items-center justify-center rounded-2xl px-5 py-3 text-base font-medium text-white"
            >
              Перейти к онлайн-записи
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const startGame = () => {
    setError(null);
    setStep("quiz");
  };

  const finishGame = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/game/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameDirection,
          skinNeed,
          resultType,
          premiumLevel,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        playId?: string;
        gift?: GameGift | null;
      };
      if (!response.ok || !payload.ok || !payload.playId) {
        throw new Error(payload.error ?? "Не удалось завершить игру");
      }
      setPlayId(payload.playId);
      setGift(payload.gift ?? null);
      setStep("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось завершить игру");
    } finally {
      setLoading(false);
    }
  };

  const submitLead = async () => {
    const validationErrors = validateClientData({
      clientName: name,
      clientPhone: fullPhone,
      consent,
    });
    setFieldErrors(validationErrors);
    if (validationErrors.name || validationErrors.phone || validationErrors.consent) {
      return;
    }

    if (!playId) {
      setError("Не найден идентификатор прохождения игры");
      return;
    }

    setLeadSubmitting(true);
    setError(null);
    try {
      const comment = buildManagerMessage({
        header: config.managerMessageHeader,
        footer: config.managerMessageFooter,
        gameDirection,
        skinNeed,
        resultType,
        premiumLevel,
        gift,
        clientName: name,
      });

      const response = await fetch("/api/booking/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: name.trim(),
          clientPhone: fullPhone,
          comment,
          masterId: null,
          type: "CONSULTATION_REQUEST",
          consent,
          gamePlayId: playId,
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Не удалось отправить заявку");
      }
      setLeadSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить заявку");
    } finally {
      setLeadSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 md:px-6">
      <div
        className="rounded-[2rem] border bg-white/92 p-6 shadow-[0_18px_50px_rgba(28,46,38,0.10)]"
        style={{ borderColor: studioBrand.goldLine }}
      >
        <header className="text-center">
          <p className="font-body text-xs font-semibold uppercase tracking-[0.24em]" style={{ color: studioBrand.gold }}>
            Твоё время
          </p>
          <h1 className="font-display mt-3 text-3xl font-semibold leading-tight" style={{ color: studioBrand.green }}>
            {config.title}
          </h1>
          {config.description ? (
            <p className="font-body mx-auto mt-3 max-w-xl text-sm leading-relaxed" style={{ color: studioBrand.inkMuted }}>
              {config.description}
            </p>
          ) : null}
        </header>

        {error ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {step === "intro" ? (
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={startGame}
              className="home-btn home-btn-primary font-body flex min-h-12 w-full items-center justify-center rounded-2xl px-5 py-3 text-base font-medium text-white sm:w-auto sm:min-w-[240px]"
            >
              Начать
            </button>
            <Link
              href="/booking"
              className="home-btn home-btn-secondary font-body flex min-h-12 w-full items-center justify-center rounded-2xl border bg-white/92 px-5 py-3 text-base font-medium text-[var(--brand-green)] sm:w-auto sm:min-w-[240px]"
            >
              Перейти к онлайн-записи
            </Link>
          </div>
        ) : null}

        {step === "quiz" ? (
          <div className="mt-6 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-body text-xs font-medium" style={{ color: studioBrand.greenMuted }}>
                  Направление ухода
                </span>
                <select
                  className="rounded-2xl border bg-white/92 px-3 py-2.5 text-sm"
                  style={{ borderColor: studioBrand.goldLineSoft, color: studioBrand.green }}
                  value={gameDirection}
                  onChange={(e) => setGameDirection(e.target.value)}
                >
                  <option value="лицо">Лицо</option>
                  <option value="увлажнение">Увлажнение</option>
                  <option value="восстановление">Восстановление</option>
                  <option value="сияние">Сияние</option>
                  <option value="качество кожи">Качество кожи</option>
                  <option value="премиум сияние">Премиум сияние</option>
                  <option value="премиум восстановление">Премиум восстановление</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-body text-xs font-medium" style={{ color: studioBrand.greenMuted }}>
                  Потребность кожи
                </span>
                <select
                  className="rounded-2xl border bg-white/92 px-3 py-2.5 text-sm"
                  style={{ borderColor: studioBrand.goldLineSoft, color: studioBrand.green }}
                  value={skinNeed}
                  onChange={(e) => setSkinNeed(e.target.value)}
                >
                  <option value="увлажнение">Увлажнение</option>
                  <option value="тонус">Тонус</option>
                  <option value="восстановление">Восстановление</option>
                  <option value="сияние">Сияние</option>
                  <option value="комфорт">Комфорт</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-body text-xs font-medium" style={{ color: studioBrand.greenMuted }}>
                  Тип результата
                </span>
                <select
                  className="rounded-2xl border bg-white/92 px-3 py-2.5 text-sm"
                  style={{ borderColor: studioBrand.goldLineSoft, color: studioBrand.green }}
                  value={resultType}
                  onChange={(e) => setResultType(e.target.value)}
                >
                  <option value="качество кожи">Качество кожи</option>
                  <option value="увлажнение">Увлажнение</option>
                  <option value="сияние">Сияние</option>
                  <option value="восстановление">Восстановление</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-body text-xs font-medium" style={{ color: studioBrand.greenMuted }}>
                  Premium level
                </span>
                <input
                  type="number"
                  min={0}
                  className="rounded-2xl border bg-white/92 px-3 py-2.5 text-sm"
                  style={{ borderColor: studioBrand.goldLineSoft, color: studioBrand.green }}
                  value={premiumLevel}
                  onChange={(e) => setPremiumLevel(Number(e.target.value))}
                />
              </label>
            </div>

            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                disabled={loading}
                onClick={() => void finishGame()}
                className="home-btn home-btn-primary font-body flex min-h-12 items-center justify-center rounded-2xl px-5 py-3 text-base font-medium text-white disabled:opacity-60 sm:min-w-[240px]"
              >
                {loading ? "Считаем результат…" : "Получить результат"}
              </button>
              <button
                type="button"
                onClick={() => setStep("intro")}
                className="home-btn home-btn-secondary font-body flex min-h-12 items-center justify-center rounded-2xl border bg-white/92 px-5 py-3 text-base font-medium text-[var(--brand-green)] sm:min-w-[240px]"
              >
                Назад
              </button>
            </div>
          </div>
        ) : null}

        {step === "result" ? (
          <div className="mt-6 space-y-4">
            <h2 className="font-display text-2xl font-semibold" style={{ color: studioBrand.green }}>
              {config.resultHeaderText}
            </h2>
            <div className="rounded-2xl border px-4 py-4" style={{ borderColor: studioBrand.goldLineSoft }}>
              <p className="font-body text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: studioBrand.goldMuted }}>
                {config.directionLabelText}
              </p>
              <p className="font-display mt-2 text-lg font-semibold" style={{ color: studioBrand.green }}>
                {gameDirection}
              </p>
              <p className="font-body mt-2 text-sm" style={{ color: studioBrand.inkMuted }}>
                Потребность: {skinNeed} · Тип результата: {resultType}
              </p>
            </div>

            <div className="rounded-2xl border px-4 py-4" style={{ borderColor: studioBrand.goldLineSoft }}>
              <p className="font-body text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: studioBrand.goldMuted }}>
                {config.giftLabelText}
              </p>
              <p className="font-display mt-2 text-lg font-semibold" style={{ color: studioBrand.green }}>
                {gift?.name ?? "Подарок не найден"}
              </p>
              {gift?.shortDescription ? (
                <p className="font-body mt-2 text-sm leading-relaxed" style={{ color: studioBrand.inkMuted }}>
                  {gift.shortDescription}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => setStep("lead")}
                className="home-btn home-btn-primary font-body flex min-h-12 items-center justify-center rounded-2xl px-5 py-3 text-base font-medium text-white sm:min-w-[260px]"
              >
                {config.ctaButtonText}
              </button>
              <button
                type="button"
                onClick={() => setStep("quiz")}
                className="home-btn home-btn-secondary font-body flex min-h-12 items-center justify-center rounded-2xl border bg-white/92 px-5 py-3 text-base font-medium text-[var(--brand-green)] sm:min-w-[260px]"
              >
                Изменить ответы
              </button>
            </div>
          </div>
        ) : null}

        {step === "lead" ? (
          <div className="mt-6 space-y-4">
            <h2 className="font-display text-2xl font-semibold" style={{ color: studioBrand.green }}>
              Заявка менеджеру
            </h2>
            {leadSuccess ? (
              <div className="rounded-2xl border px-4 py-4" style={{ borderColor: studioBrand.goldLineSoft }}>
                <p className="font-body text-sm" style={{ color: studioBrand.inkMuted }}>
                  Заявка отправлена. Менеджер студии свяжется с вами.
                </p>
                <div className="mt-4 flex justify-center">
                  <Link
                    href="/booking"
                    className="home-btn home-btn-primary font-body inline-flex min-h-12 items-center justify-center rounded-2xl px-5 py-3 text-base font-medium text-white"
                  >
                    Перейти к онлайн-записи
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <BookingClientFields
                  variant="wizard"
                  name={name}
                  onNameChange={setName}
                  countryCode={countryCode}
                  onCountryCodeChange={setCountryCode}
                  phoneLocal={phoneLocal}
                  onPhoneLocalChange={setPhoneLocal}
                  consent={consent}
                  onConsentChange={setConsent}
                  errors={fieldErrors}
                  onClearError={(field) =>
                    setFieldErrors((current) => ({ ...current, [field]: undefined }))
                  }
                  showComment={false}
                />

                <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-center">
                  <button
                    type="button"
                    disabled={leadSubmitting}
                    onClick={() => void submitLead()}
                    className="home-btn home-btn-primary font-body flex min-h-12 items-center justify-center rounded-2xl px-5 py-3 text-base font-medium text-white disabled:opacity-60 sm:min-w-[260px]"
                  >
                    {leadSubmitting ? "Отправляем…" : "Отправить заявку"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep("result")}
                    className="home-btn home-btn-secondary font-body flex min-h-12 items-center justify-center rounded-2xl border bg-white/92 px-5 py-3 text-base font-medium text-[var(--brand-green)] sm:min-w-[260px]"
                  >
                    Назад к результату
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}

