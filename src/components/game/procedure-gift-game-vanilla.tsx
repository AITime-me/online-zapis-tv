"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { createPortal } from "react-dom";
import { BookingClientFields } from "@/components/booking/booking-client-fields";
import {
  buildFullPhoneNumber,
  type ClientDataFieldErrors,
  type PhoneCountryCode,
  validateClientData,
} from "@/lib/booking/client-validation";
import { studioBrand } from "@/lib/brand/studio-brand";
import { BOOKING_REQUEST_SUCCESS_MESSAGE } from "@/lib/booking/request-success-copy";
import {
  buildIdempotencyHeaders,
  clearIdempotencyKey,
  getOrCreateIdempotencyKey,
  resetIdempotencyKey,
} from "@/lib/booking-requests/idempotency-client";
import {
  buildClientGameMessage,
  type GameLeadSession,
} from "@/lib/game/game-lead-messages";

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

const POIMAY_GAME_BASE = "/poimay-game";
const GAME_CATALOG_SLUG = "procedure-gift";

type ServerSessionResult = {
  ok?: boolean;
  status?: string;
  hasResult?: boolean;
  gamePlayId?: string;
  gift?: {
    name: string;
    shortDescription: string;
    image: string | null;
    priority: string;
    cardStyle: string;
  };
  bookingSubmitted?: boolean;
  error?: string;
  code?: string;
};

type PoimayGameAppApi = {
  showScreen?: (screenId: string) => void;
};

type PoimayGameFlowGate = {
  isBookingSubmitted: () => boolean;
  beforeStartGame: (proceed: () => void) => void;
};

function readDomDirectionLabel(): string | null {
  return document.getElementById("result-direction")?.textContent?.trim() || null;
}

function safeGetPlaySession(): GameLeadSession | null {
  try {
    const raw = (window as any).PlaySession?.get?.();
    if (!raw) return null;
    return {
      playId: raw.playId ?? null,
      giftId: raw.giftId ?? null,
      giftName: raw.giftName ?? null,
      gameDirection: raw.gameDirection ?? null,
      skinNeed: raw.skinNeed ?? null,
      resultType: raw.resultType ?? null,
      premiumLevel:
        typeof raw.premiumLevel === "number" ? raw.premiumLevel : null,
    };
  } catch {
    return null;
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

const GAME_BOOKING_IDEMPOTENCY_SCOPE_PREFIX = "booking:procedure-gift";
const BOOKING_SUBMITTED_PLAY_ID_KEY = "procedure-gift:booking-submitted-play-id";

function buildGameBookingScope(playId: string): string {
  return `${GAME_BOOKING_IDEMPOTENCY_SCOPE_PREFIX}:${playId}`;
}

function readSubmittedPlayId(): string | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  try {
    return sessionStorage.getItem(BOOKING_SUBMITTED_PLAY_ID_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function markSubmittedPlayId(playId: string): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(BOOKING_SUBMITTED_PLAY_ID_KEY, playId);
  } catch {
    // Ignore storage errors.
  }
}

function clearSubmittedPlayId(): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    sessionStorage.removeItem(BOOKING_SUBMITTED_PLAY_ID_KEY);
  } catch {
    // Ignore storage errors.
  }
}

export function ProcedureGiftGameVanilla({
  config,
  vkUrl = "https://vk.me/tvoiovremya",
  maxUrl = "https://web.max.ru/267619155",
  gameSuccessMessage = BOOKING_REQUEST_SUCCESS_MESSAGE,
}: {
  config: PublicGameConfig | null;
  vkUrl?: string;
  maxUrl?: string;
  gameSuccessMessage?: string;
}) {
  const [leadOpen, setLeadOpen] = useState(false);
  const [playSession, setPlaySession] = useState<GameLeadSession | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState<PhoneCountryCode>("RU");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [comment, setComment] = useState("");
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ClientDataFieldErrors>({});

  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadSuccess, setLeadSuccess] = useState(false);
  const [submittedPlayId, setSubmittedPlayId] = useState<string | null>(null);
  const [messengerCopied, setMessengerCopied] = useState(false);

  const [leadError, setLeadError] = useState<string | null>(null);
  const [gameRuntimeReady, setGameRuntimeReady] = useState(false);
  const [gameRuntimeError, setGameRuntimeError] = useState<string | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [bookingSubmittedFromServer, setBookingSubmittedFromServer] = useState(false);
  const [flowBlockedMessage, setFlowBlockedMessage] = useState<string | null>(null);

  const fullPhone = useMemo(
    () => buildFullPhoneNumber(countryCode, phoneLocal),
    [countryCode, phoneLocal],
  );

  useEffect(() => {
    setIsMounted(true);
    setSubmittedPlayId(readSubmittedPlayId());
  }, []);

  const syncServerSessionResult = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/game/session/result?catalogSlug=${encodeURIComponent(GAME_CATALOG_SLUG)}`,
        { credentials: "same-origin" },
      );
      const payload = (await response.json()) as ServerSessionResult;
      if (!response.ok || !payload.ok) {
        return;
      }

      if (payload.bookingSubmitted) {
        setBookingSubmittedFromServer(true);
        setFlowBlockedMessage(
          "Заявка по игре уже отправлена. Менеджер студии свяжется с вами.",
        );
      } else {
        setBookingSubmittedFromServer(false);
        setFlowBlockedMessage(null);
      }

      if (payload.hasResult && payload.gamePlayId && payload.gift) {
        const session: GameLeadSession = {
          playId: payload.gamePlayId,
          giftId: null,
          giftName: payload.gift.name,
          gameDirection: null,
          skinNeed: null,
          resultType: null,
          premiumLevel: null,
        };
        setPlaySession(session);
        if (payload.bookingSubmitted) {
          setSubmittedPlayId(payload.gamePlayId);
          setLeadSuccess(true);
          markSubmittedPlayId(payload.gamePlayId);
        }
        const poimayApp = (window as Window & { PoimayGameApp?: PoimayGameAppApi })
          .PoimayGameApp;
        poimayApp?.showScreen?.("screen-result");
        const giftEl = document.getElementById("gift-value");
        if (giftEl) {
          giftEl.textContent = payload.gift.name;
        }
      }
    } catch {
      // Ignore sync errors; client markers remain fallback.
    }
  }, []);

  useEffect(() => {
    if (!config?.isActive) return;
    void syncServerSessionResult();
  }, [config?.isActive, syncServerSessionResult]);

  useEffect(() => {
    if (!config?.isActive) return;

    const handleNewAttempt = () => {
      if (bookingSubmittedFromServer) {
        return;
      }
      setPlaySession(null);
      setLeadOpen(false);
      setLeadSuccess(false);
      setLeadError(null);
      setSubmittedPlayId(null);
      clearSubmittedPlayId();
    };

    window.addEventListener("poimay-game:new-attempt", handleNewAttempt);
    return () => {
      window.removeEventListener("poimay-game:new-attempt", handleNewAttempt);
    };
  }, [config?.isActive, bookingSubmittedFromServer]);

  useEffect(() => {
    if (!config?.isActive) {
      setGameRuntimeReady(false);
      setGameRuntimeError(null);
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const mountVanillaGame = () => {
      if (cancelled) return;

      const poimayApp = (window as Window & {
        PoimayGameApp?: { mount?: () => void; destroy?: () => void };
      }).PoimayGameApp;

      if (poimayApp?.mount) {
        try {
          poimayApp.mount();
          if (!cancelled) {
            setGameRuntimeReady(true);
            setGameRuntimeError(null);
          }
        } catch (error) {
          if (!cancelled) {
            setGameRuntimeReady(false);
            setGameRuntimeError(
              error instanceof Error
                ? error.message
                : "Не удалось инициализировать игру",
            );
          }
        }
        return;
      }

      attempts += 1;
      if (attempts < 50) {
        window.setTimeout(mountVanillaGame, 100);
        return;
      }

      setGameRuntimeReady(false);
      setGameRuntimeError("Не удалось загрузить игровой модуль");
    };

    mountVanillaGame();

    return () => {
      cancelled = true;
      const poimayApp = (window as Window & {
        PoimayGameApp?: { destroy?: () => void };
      }).PoimayGameApp;
      poimayApp?.destroy?.();
      setGameRuntimeReady(false);
    };
  }, [config?.isActive]);

  useEffect(() => {
    if (!config?.isActive) return;

    // Vanilla app.js может заменить ссылку #btn-vk на booking URL, если hasBookingApi=true.
    // В нашем UX booking делается через modal React, поэтому запрещаем замену ссылки.
    let intervalId: number | null = null;
    intervalId = window.setInterval(() => {
      const g = (window as any).GiftConfig;
      if (!g?.hasBookingApi) return;
      if (typeof g.hasBookingApi === "function") {
        g.hasBookingApi = () => false;
        if (intervalId) window.clearInterval(intervalId);
      }
    }, 200);

    return () => {
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [config?.isActive]);

  useEffect(() => {
    if (!config?.isActive) return;

    let lastPlayId: string | null = null;
    const id = window.setInterval(() => {
      const session = safeGetPlaySession();
      if (!session?.playId) {
        if (lastPlayId !== null) {
          lastPlayId = null;
          setPlaySession(null);
          setLeadOpen(false);
        }
        return;
      }
      if (session.playId !== lastPlayId) {
        lastPlayId = session.playId;
        setPlaySession(session);
        setLeadOpen(false);
        setLeadError(null);
        const storedSubmittedPlayId = readSubmittedPlayId();
        setSubmittedPlayId(storedSubmittedPlayId);
        setLeadSuccess(storedSubmittedPlayId === session.playId);
      }
    }, 500);

    return () => window.clearInterval(id);
  }, [config?.isActive]);

  useEffect(() => {
    if (!config?.isActive) return;

    const startButton = document.querySelector(
      '[data-action="go-rules"]',
    ) as HTMLButtonElement | null;
    if (!startButton) return;

    startButton.disabled = !gameRuntimeReady;
    if (gameRuntimeReady) {
      startButton.removeAttribute("aria-disabled");
    } else {
      startButton.setAttribute("aria-disabled", "true");
    }
  }, [config?.isActive, gameRuntimeReady]);

  const isBookingSubmitted =
    bookingSubmittedFromServer ||
    (Boolean(submittedPlayId) &&
      submittedPlayId === (playSession?.playId?.trim() ?? ""));

  const clearClientAttemptState = useCallback((previousPlayId: string | null) => {
    if (previousPlayId) {
      clearIdempotencyKey(buildGameBookingScope(previousPlayId));
    }
    if ((window as Window & { PlaySession?: { beginNewAttempt?: () => void } }).PlaySession?.beginNewAttempt) {
      (window as any).PlaySession.beginNewAttempt();
    } else {
      (window as any).PlaySession?.clear?.();
    }
    setPlaySession(null);
    setLeadOpen(false);
    setLeadSuccess(false);
    setLeadError(null);
    setSubmittedPlayId(null);
    clearSubmittedPlayId();
  }, []);

  const restartGameAttempt = useCallback(async (): Promise<boolean> => {
    const response = await fetch("/api/game/session/restart", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogSlug: GAME_CATALOG_SLUG }),
    });
    const payload = (await response.json()) as ServerSessionResult;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Не удалось начать новую попытку");
    }
    return true;
  }, []);

  const playAgain = useCallback(async () => {
    if (replayLoading || isBookingSubmitted) {
      return;
    }
    const previousPlayId = playSession?.playId?.trim() ?? null;
    setReplayLoading(true);
    setLeadError(null);
    try {
      await restartGameAttempt();
      clearClientAttemptState(previousPlayId);
      const poimayApp = (window as Window & { PoimayGameApp?: PoimayGameAppApi }).PoimayGameApp;
      poimayApp?.showScreen?.("screen-rules");
    } catch (error) {
      setLeadError(
        error instanceof Error ? error.message : "Не удалось начать новую попытку",
      );
    } finally {
      setReplayLoading(false);
    }
  }, [
    clearClientAttemptState,
    isBookingSubmitted,
    playSession?.playId,
    replayLoading,
    restartGameAttempt,
  ]);

  useEffect(() => {
    if (!config?.isActive) return;

    const gate: PoimayGameFlowGate = {
      isBookingSubmitted: () => isBookingSubmitted,
      beforeStartGame: (proceed) => {
        if (isBookingSubmitted) {
          setFlowBlockedMessage(
            "Заявка по игре уже отправлена. Менеджер студии свяжется с вами.",
          );
          return;
        }
        const previousPlayId = safeGetPlaySession()?.playId?.trim() ?? null;
        if (!previousPlayId) {
          proceed();
          return;
        }
        setReplayLoading(true);
        setLeadError(null);
        restartGameAttempt()
          .then(() => {
            clearClientAttemptState(previousPlayId);
            proceed();
          })
          .catch((error) => {
            setLeadError(
              error instanceof Error
                ? error.message
                : "Не удалось начать новую попытку",
            );
          })
          .finally(() => {
            setReplayLoading(false);
          });
      },
    };

    (window as Window & { PoimayGameFlowGate?: PoimayGameFlowGate }).PoimayGameFlowGate =
      gate;

    return () => {
      delete (window as Window & { PoimayGameFlowGate?: PoimayGameFlowGate })
        .PoimayGameFlowGate;
    };
  }, [
    clearClientAttemptState,
    config?.isActive,
    isBookingSubmitted,
    restartGameAttempt,
  ]);

  const openPhoneForm = () => {
    const playId = playSession?.playId?.trim() ?? "";
    if (!playId) {
      setLeadError("Не найден идентификатор прохождения игры");
      return;
    }
    if (isBookingSubmitted) {
      setLeadError("Заявка по этому результату уже отправлена");
      return;
    }

    setComment("");
    setLeadError(null);
    getOrCreateIdempotencyKey(buildGameBookingScope(playId));
    setLeadOpen(true);
  };

  const openMessengerChannel = async (url: string) => {
    const message = buildClientGameMessage(playSession, readDomDirectionLabel());
    const copied = await copyTextToClipboard(message);
    if (copied) {
      setMessengerCopied(true);
      window.setTimeout(() => setMessengerCopied(false), 4000);
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const closePhoneForm = () => {
    setLeadOpen(false);
    setLeadError(null);
    setFieldErrors({});
  };

  const submitLead = async () => {
    setLeadError(null);

    const validationErrors = validateClientData({
      clientName: name,
      clientPhone: fullPhone,
      consent,
    });
    setFieldErrors(validationErrors);
    if (validationErrors.name || validationErrors.phone || validationErrors.consent) {
      return;
    }

    const playId = playSession?.playId?.trim() ?? "";
    if (!playId) {
      setLeadError("Не найден идентификатор прохождения игры");
      return;
    }
    if (isBookingSubmitted) {
      setLeadError("Заявка по этому результату уже отправлена");
      return;
    }

    setLeadSubmitting(true);
    try {
      const userComment = comment.trim() || null;
      const idempotencyScope = buildGameBookingScope(playId);

      const response = await fetch("/api/booking/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildIdempotencyHeaders(idempotencyScope),
        },
        body: JSON.stringify({
          clientName: name.trim(),
          clientPhone: fullPhone,
          comment: userComment,
          masterId: null,
          type: "CONSULTATION_REQUEST",
          consent,
          gamePlayId: playId,
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
      };
      if (!response.ok || !payload.ok) {
        if (payload.code === "IDEMPOTENCY_CONFLICT") {
          resetIdempotencyKey(idempotencyScope);
        }
        throw new Error(payload.error ?? "Не удалось отправить заявку");
      }

      clearIdempotencyKey(idempotencyScope);
      markSubmittedPlayId(playId);
      setSubmittedPlayId(playId);
      setBookingSubmittedFromServer(true);
      setFlowBlockedMessage(
        "Заявка по игре уже отправлена. Менеджер студии свяжется с вами.",
      );

      setLeadSuccess(true);
      setLeadOpen(false);
      setName("");
      setPhoneLocal("");
      setComment("");
      setConsent(false);
    } catch (e) {
      setLeadError(e instanceof Error ? e.message : "Не удалось отправить заявку");
    } finally {
      setLeadSubmitting(false);
    }
  };

  // Body scroll: только когда modal открыта — остальное управляет vanilla экраном.
  useEffect(() => {
    if (!leadOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [leadOpen]);

  const currentPlayId = playSession?.playId?.trim() ?? "";
  const isCurrentPlaySubmitted = isBookingSubmitted;

  if (!config) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 md:px-6">
        <div
          className="rounded-2xl border bg-white p-6"
          style={{ borderColor: studioBrand.goldLine }}
        >
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
        <div
          className="rounded-2xl border bg-white p-6"
          style={{ borderColor: studioBrand.goldLine }}
        >
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

  return (
    <div
      className="poimay-game"
      style={{ overflowX: "hidden", height: "100dvh", overflowY: "hidden" }}
    >
      <style>{`
        .poimay-game .app { height: 100dvh; min-height: 100dvh; overflow: hidden; }
        .poimay-game .screen { flex: 1; min-height: 0; overflow: hidden; }
        .poimay-game .screen__content--result { overflow-y: auto; min-height: 0; }
        .poimay-game .screen__content--start,
        .poimay-game .screen__content--rules { overflow-y: auto; min-height: 0; }
        .game-lead-modal { overflow-x: hidden; box-sizing: border-box; }
        .game-lead-modal *, .game-lead-modal *::before, .game-lead-modal *::after { box-sizing: border-box; }
        .game-lead-modal__panel { width: 100%; max-width: 420px; overflow-x: hidden; }
        .game-lead-modal__body { overflow-x: hidden; }
        .game-lead-modal__field, .game-lead-modal__textarea { width: 100%; max-width: 100%; }
        .game-lead-modal__footer button { width: 100%; max-width: 100%; }
      `}</style>

      {/* Vanilla styles */}
      <link rel="stylesheet" href={`${POIMAY_GAME_BASE}/css/style.css`} />

      {/* Vanilla scripts: только vanilla app.js переключает экраны */}
      <Script
        id="poimay-script-gift-config"
        src={`${POIMAY_GAME_BASE}/js/gift-config.js`}
        strategy="afterInteractive"
      />
      <Script
        id="poimay-script-result-adapter"
        src={`${POIMAY_GAME_BASE}/js/result-adapter.js`}
        strategy="afterInteractive"
      />
      <Script
        id="poimay-script-gift-api"
        src={`${POIMAY_GAME_BASE}/js/gift-api.js`}
        strategy="afterInteractive"
      />
      <Script
        id="poimay-script-play-session"
        src={`${POIMAY_GAME_BASE}/js/play-session.js`}
        strategy="afterInteractive"
      />
      <Script
        id="poimay-script-booking-api"
        src={`${POIMAY_GAME_BASE}/js/booking-api.js`}
        strategy="afterInteractive"
      />
      <Script
        id="poimay-script-confetti"
        src={`${POIMAY_GAME_BASE}/js/confetti.js`}
        strategy="afterInteractive"
      />
      <Script
        id="poimay-script-game"
        src={`${POIMAY_GAME_BASE}/js/game.js`}
        strategy="afterInteractive"
      />
      <Script
        id="poimay-script-app"
        src={`${POIMAY_GAME_BASE}/js/app.js`}
        strategy="afterInteractive"
      />

      {gameRuntimeError ? (
        <div
          className="mx-4 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {gameRuntimeError}
        </div>
      ) : null}

      {flowBlockedMessage ? (
        <div
          className="mx-4 mt-4 rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: studioBrand.goldLineSoft, color: studioBrand.inkMuted }}
          role="status"
        >
          {flowBlockedMessage}
        </div>
      ) : null}

      {!gameRuntimeReady && !gameRuntimeError ? (
        <div
          className="mx-4 mt-4 rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: studioBrand.goldLineSoft, color: studioBrand.inkMuted }}
        >
          Загружаем игру…
        </div>
      ) : null}

      <div className="app">
        <header className="header">
          <img
            src={`${POIMAY_GAME_BASE}/assets/logo.png`}
            alt="Студия красоты «Твоё время»"
            className="logo"
            width={160}
            height={40}
          />
        </header>

        {/* Экран 1: Старт */}
        <section id="screen-start" className="screen screen--active screen--start">
          <div className="start-bg" aria-hidden="true">
            <img
              src={`${POIMAY_GAME_BASE}/assets/start-bg.png`}
              alt=""
              className="start-bg__image"
              width={430}
              height={860}
              loading="eager"
              decoding="async"
            />
            <div className="start-bg__overlay" />
          </div>
          <div className="screen__content screen__content--start">
            <h1 className="title">Поймай своё время</h1>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                window.location.href = "/";
              }}
              style={{ alignSelf: "flex-start", paddingLeft: 16, paddingRight: 16 }}
            >
              ← Вернуться на сайт
            </button>
            <p className="text">Короткая мини-игра от студии красоты «Твоё время».</p>
            <p className="text">
              Ловите уход, массаж, сияние, релакс и час для себя.
              <br />
              Избегайте стресса, недосыпа, дедлайнов и фразы «запишусь потом».
            </p>
            <p className="text text--highlight">
              В конце игра подберёт вам направление для записи и откроет подарок от студии.
            </p>

            <div className="rules-tip rules-tip--start">
              <div className="rules-tip__head">
                <span className="rules-tip__icon" aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 4h12v5l-4 4 4 4v5H8v-5l4-4-4-4V4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                    <path d="M12 13h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                </span>
                <p className="rules-tip__title">Что нужно делать</p>
              </div>
              <p className="rules-tip__text">
                Внизу экрана будут песочные часы. Двигайте их пальцем влево и вправо и ловите полезные слова, которые падают сверху.
              </p>
              <p className="rules-tip__gesture">
                <span className="rules-tip__arrow" aria-hidden="true">←</span>
                <span className="rules-tip__gesture-label">двигайте пальцем</span>
                <span className="rules-tip__arrow" aria-hidden="true">→</span>
              </p>
              <p className="rules-tip__note">
                Поймали уход, массаж или сияние — получили баллы. Поймали стресс или «запишусь потом» — баллы сгорели, как свободное окно в пятницу.
              </p>
            </div>

            <button type="button" className="btn btn--primary" data-action="go-rules">
              {isBookingSubmitted ? "Заявка уже отправлена" : "Начать игру"}
            </button>
          </div>
        </section>

        {/* Экран 2: Правила */}
        <section id="screen-rules" className="screen">
          <div className="screen__content screen__content--rules">
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <button
                type="button"
                className="btn btn--secondary"
                data-action="back-to-start"
                style={{ alignSelf: "flex-start", paddingLeft: 16, paddingRight: 16 }}
              >
                ← Назад
              </button>
            </div>
            <h2 className="title title--sm">Как играть</h2>
            <div className="rules-block rules-block--good">
              <p className="rules-label">Ловите полезные объекты:</p>
              <p className="rules-items">уход, массаж, сияние, релакс, увлажнение, тонус, час для себя</p>
            </div>
            <div className="rules-block rules-block--bad">
              <p className="rules-label">Избегайте того, что крадёт ваше время:</p>
              <p className="rules-items">стресс, недосып, усталость, отёки, дедлайн, запишусь потом, нет времени</p>
            </div>
            <p className="text text--center">У вас 20–30 секунд.</p>
            <button type="button" className="btn btn--primary" data-action="start-game">
              Играть
            </button>
          </div>
        </section>

        {/* Экран 3: Игра */}
        <section id="screen-game" className="screen screen--game">
          <div style={{ padding: 12, paddingBottom: 0 }}>
            <button
              type="button"
              className="btn btn--secondary"
              data-action="back-to-rules"
              style={{ width: "fit-content" }}
            >
              ← Назад
            </button>
          </div>
          <div className="game-hud">
            <div className="hud-item">
              <span className="hud-label">Время</span>
              <span id="game-timer" className="hud-value">25</span>
            </div>
            <div className="hud-item">
              <span className="hud-label">Счёт</span>
              <span id="game-score" className="hud-value">0</span>
            </div>
          </div>
          <canvas id="game-canvas" className="game-canvas"></canvas>
          <div id="score-popup" className="score-popup" aria-hidden="true"></div>
        </section>

        {/* Экран 4: Результат */}
        <section id="screen-result" className="screen screen--result">
          <canvas id="confetti-canvas" className="confetti-canvas" aria-hidden="true"></canvas>
          <div className="screen__content screen__content--result">
            <div className="result-card">
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <button
                  type="button"
                  className="btn btn--secondary"
                  data-action="back-from-result"
                  style={{ paddingLeft: 16, paddingRight: 16 }}
                >
                  ← Назад
                </button>
              </div>
              <p className="result-label">Игра подобрала вам направление:</p>
              <h2 id="result-direction" className="result-direction"></h2>
              <p id="result-explanation" className="result-explanation"></p>

              <div className="gift-block">
                <p className="result-label">Подарок к записи:</p>
                <p id="gift-value" className="gift-value">уход для рук</p>
              </div>

              <p className="copy-hint">
                Чтобы сохранить результат игры, скопируйте фразу и отправьте её в сообщения студии:
              </p>
              <p id="result-phrase" className="result-phrase"></p>

              <div className="result-actions">
                <button type="button" className="btn btn--secondary" id="btn-copy">
                  Скопировать фразу
                </button>
              </div>
            </div>

            {playSession?.playId ? (
              <div className="mt-6">
                {!isCurrentPlaySubmitted ? (
                  <div className="rounded-2xl border px-4 py-5" style={{ borderColor: studioBrand.goldLineSoft }}>
                    <p className="result-label" style={{ marginBottom: 12 }}>
                      Получите свой подарок удобным способом
                    </p>
                    {leadError ? (
                      <p className="font-body mb-3 text-xs text-red-700">{leadError}</p>
                    ) : null}
                    {messengerCopied ? (
                      <p
                        className="font-body mb-3 text-xs"
                        style={{ color: studioBrand.inkMuted }}
                      >
                        Текст сообщения скопирован — вставьте его в чат студии.
                      </p>
                    ) : null}
                    <div className="flex flex-col gap-3">
                      <button
                        type="button"
                        onClick={openPhoneForm}
                        className="btn btn--primary w-full"
                      >
                        Оставить телефон и получить подарок
                      </button>
                      <button
                        type="button"
                        disabled={replayLoading}
                        onClick={() => void playAgain()}
                        className="btn btn--secondary w-full disabled:opacity-60"
                      >
                        {replayLoading ? "Готовим новую попытку…" : "Сыграть ещё раз"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void openMessengerChannel(vkUrl)}
                        className="btn btn--secondary w-full"
                      >
                        Написать в VK
                      </button>
                      <button
                        type="button"
                        onClick={() => void openMessengerChannel(maxUrl)}
                        className="btn btn--secondary w-full"
                      >
                        Написать в MAX
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3 rounded-2xl border px-4 py-4" style={{ borderColor: studioBrand.goldLineSoft }}>
                    <p className="font-body text-sm" style={{ color: studioBrand.inkMuted }}>
                      Заявка уже отправлена. {gameSuccessMessage}
                    </p>
                    <Link
                      href="/"
                      className="btn btn--primary w-full inline-flex items-center justify-center"
                    >
                      Вернуться на сайт
                    </Link>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <div id="toast" className="toast" role="status" aria-live="polite" />

      {leadOpen && isMounted
        ? createPortal(
            <div
              className="game-lead-modal fixed inset-0 z-[80] flex items-center justify-center bg-black/25 p-3 sm:p-4"
              role="presentation"
            >
              <div
                className="game-lead-modal__panel w-full max-w-[420px] overflow-hidden rounded-[1.75rem] border bg-white shadow-[0_18px_50px_rgba(28,46,38,0.12)]"
                style={{ borderColor: studioBrand.goldLineSoft, maxHeight: "calc(100dvh - 1.5rem)" }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="game-lead-modal-title"
              >
                <header
                  className="game-lead-modal__header flex items-start justify-between gap-3 border-b px-4 py-4 sm:px-5"
                  style={{ borderColor: studioBrand.goldLineSoft }}
                >
                  <h2
                    id="game-lead-modal-title"
                    className="font-display text-xl font-semibold leading-tight"
                    style={{ color: studioBrand.green }}
                  >
                    Консультация
                  </h2>
                  <button
                    type="button"
                    onClick={closePhoneForm}
                    className="font-body rounded-xl px-3 py-2 text-sm font-medium"
                    style={{ color: studioBrand.green }}
                  >
                    ← Назад
                  </button>
                </header>

                <div className="game-lead-modal__body min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5">
                  <p className="font-body mb-4 text-sm" style={{ color: studioBrand.inkMuted }}>
                    Оставьте заявку, и менеджер студии свяжется с вами для подбора времени.
                  </p>

                  {leadError ? (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                      {leadError}
                    </div>
                  ) : null}

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

                  <label className="game-lead-modal__field font-body mt-3 block w-full text-sm">
                    <span className="mb-1 block" style={{ color: studioBrand.greenMuted }}>
                      Сообщение для студии
                    </span>
                    <textarea
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      rows={6}
                      className="game-lead-modal__textarea w-full rounded-2xl border bg-white/92 px-3 py-3 text-sm outline-none transition focus:ring-2 focus:ring-[rgba(201,169,106,0.28)]"
                      style={{ borderColor: "rgba(201, 169, 106, 0.34)" }}
                    />
                  </label>
                </div>

                <footer
                  className="game-lead-modal__footer flex flex-col gap-3 border-t px-4 py-4 sm:px-5"
                  style={{ borderColor: studioBrand.goldLineSoft }}
                >
                  <button
                    type="button"
                    disabled={leadSubmitting}
                    onClick={() => void submitLead()}
                    className="home-btn home-btn-primary font-body flex w-full min-h-12 items-center justify-center rounded-2xl px-5 py-3 text-base font-medium text-white disabled:opacity-60"
                  >
                    {leadSubmitting ? "Отправляем…" : "Отправить заявку"}
                  </button>
                  <button
                    type="button"
                    onClick={closePhoneForm}
                    className="home-btn home-btn-secondary font-body flex w-full min-h-12 items-center justify-center rounded-2xl border bg-white/92 px-5 py-3 text-base font-medium text-[var(--brand-green)]"
                  >
                    Отмена
                  </button>
                </footer>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

