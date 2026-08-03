"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameGiftDto, WheelCatalogConfigDto } from "@/types/game-admin";
import {
  GAME_CATALOG_STATUS_LABELS,
  type GameCatalogStatusDto,
} from "@/types/game-catalog";
import { GAME_PRIZE_TYPE_LABELS } from "@/lib/game/wheel/prize-types";
import type { GamePrizeType } from "@/lib/game/wheel/prize-types";

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const labelClass = "text-xs font-medium text-zinc-700";

type UiStatus =
  | "idle"
  | "saving"
  | "activating"
  | "disabling"
  | "saved"
  | "error";

function prizeTypeLabel(type: GameGiftDto["prizeType"]): string {
  if (!type) {
    return "—";
  }
  return GAME_PRIZE_TYPE_LABELS[type as GamePrizeType] ?? type;
}

function parseCatalogStatus(value: unknown): GameCatalogStatusDto {
  if (
    value === "draft" ||
    value === "active" ||
    value === "disabled" ||
    value === "archived"
  ) {
    return value;
  }
  return "draft";
}

export function WheelFortunePanel({
  gameCatalogId,
  initialGifts,
  initialWheelConfig,
  initialTitle,
  initialSlug,
  initialDescription,
  initialStatus,
}: {
  gameCatalogId: string;
  initialGifts: GameGiftDto[];
  initialWheelConfig: WheelCatalogConfigDto;
  initialTitle: string;
  initialSlug: string;
  initialDescription: string | null;
  initialStatus: GameCatalogStatusDto;
}) {
  const [gifts, setGifts] = useState(initialGifts);
  const [wheelConfig, setWheelConfig] = useState(initialWheelConfig);
  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [catalogStatus, setCatalogStatus] =
    useState<GameCatalogStatusDto>(initialStatus);
  const [status, setStatus] = useState<UiStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [editingGiftId, setEditingGiftId] = useState<string | null>(null);
  const [sectorDraft, setSectorDraft] = useState(0);
  const [activeDraft, setActiveDraft] = useState(true);
  const inFlightRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const successResetTimeoutRef = useRef<number | null>(null);

  const editingGift = useMemo(
    () => gifts.find((gift) => gift.id === editingGiftId) ?? null,
    [editingGiftId, gifts],
  );

  const busy =
    status === "saving" || status === "activating" || status === "disabling";

  const clearSuccessReset = () => {
    if (successResetTimeoutRef.current !== null) {
      window.clearTimeout(successResetTimeoutRef.current);
      successResetTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearSuccessReset();
    };
  }, []);

  const beginRequest = (): number | null => {
    if (inFlightRef.current || busy) {
      return null;
    }
    clearSuccessReset();
    inFlightRef.current = true;
    requestGenerationRef.current += 1;
    return requestGenerationRef.current;
  };

  const endRequest = () => {
    inFlightRef.current = false;
  };

  const markSaved = (generation: number, notice?: string | null) => {
    if (generation !== requestGenerationRef.current) {
      return;
    }
    setMessage(notice ?? null);
    setStatus("saved");
    clearSuccessReset();
    successResetTimeoutRef.current = window.setTimeout(() => {
      successResetTimeoutRef.current = null;
      if (generation !== requestGenerationRef.current) {
        return;
      }
      setStatus((current) => (current === "saved" ? "idle" : current));
    }, 1500);
  };

  const applyGameSnapshot = (game: unknown) => {
    if (!game || typeof game !== "object") {
      return;
    }
    const snapshot = game as {
      status?: unknown;
      title?: unknown;
      slug?: unknown;
      description?: unknown;
    };
    if ("status" in snapshot) {
      setCatalogStatus(parseCatalogStatus(snapshot.status));
    }
    if (typeof snapshot.title === "string") {
      setTitle(snapshot.title);
    }
    if (typeof snapshot.slug === "string") {
      setSlug(snapshot.slug);
    }
    if (
      snapshot.description === null ||
      typeof snapshot.description === "string"
    ) {
      setDescription(snapshot.description ?? "");
    }
  };

  const statusLabel =
    status === "saving"
      ? "Сохраняется…"
      : status === "activating"
        ? "Активируется…"
        : status === "disabling"
          ? "Выключается…"
          : status === "saved"
            ? message ?? "Сохранено"
            : status === "error"
              ? `Ошибка${message ? `: ${message}` : ""}`
              : null;

  const canActivate =
    (catalogStatus === "draft" || catalogStatus === "disabled") &&
    wheelConfig.sectorConfigOk;
  const showActivateButton =
    catalogStatus === "draft" || catalogStatus === "disabled";
  const showDisableButton = catalogStatus === "active";
  const publicPath = `/promo/${encodeURIComponent(slug)}`;

  const refresh = async () => {
    const response = await fetch(
      `/api/admin/games/${encodeURIComponent(gameCatalogId)}/wheel`,
      { cache: "no-store" },
    );
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Не удалось обновить данные");
    }
    setGifts(payload.gifts);
    setWheelConfig(payload.wheelConfig);
    setTitle(payload.title);
    setSlug(payload.slug);
    setDescription(payload.description ?? "");
    setCatalogStatus(parseCatalogStatus(payload.status));
  };

  const saveCatalogMeta = async () => {
    const generation = beginRequest();
    if (generation === null) {
      return;
    }
    setStatus("saving");
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/games/${encodeURIComponent(gameCatalogId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            slug: slug.trim(),
            description: description.trim() || null,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Ошибка сохранения");
      }
      applyGameSnapshot(payload.game);
      try {
        await refresh();
        markSaved(generation);
      } catch {
        markSaved(
          generation,
          "Настройки сохранены, но не удалось обновить данные страницы. Обновите страницу.",
        );
      }
    } catch (error) {
      if (generation === requestGenerationRef.current) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Ошибка сохранения");
      }
    } finally {
      endRequest();
    }
  };

  const patchCatalogStatus = async (
    nextStatus: "active" | "disabled",
    uiStatus: "activating" | "disabling",
  ) => {
    const generation = beginRequest();
    if (generation === null) {
      return;
    }
    setStatus(uiStatus);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/games/${encodeURIComponent(gameCatalogId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.error ??
            (nextStatus === "active"
              ? "Не удалось активировать игру"
              : "Не удалось выключить игру"),
        );
      }
      applyGameSnapshot(payload.game);
      if (payload.game?.status === undefined) {
        setCatalogStatus(nextStatus);
      }
      try {
        await refresh();
        markSaved(generation);
      } catch {
        markSaved(
          generation,
          "Статус изменён, но не удалось обновить данные страницы. Обновите страницу.",
        );
      }
    } catch (error) {
      if (generation === requestGenerationRef.current) {
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : nextStatus === "active"
              ? "Ошибка активации"
              : "Ошибка выключения",
        );
      }
    } finally {
      endRequest();
    }
  };

  const activateGame = async () => {
    if (!canActivate) {
      return;
    }
    await patchCatalogStatus("active", "activating");
  };

  const disableGame = async () => {
    if (!showDisableButton) {
      return;
    }
    const confirmed = window.confirm(
      "Выключить игру? Публичная ссылка станет недоступна для посетителей.",
    );
    if (!confirmed) {
      return;
    }
    await patchCatalogStatus("disabled", "disabling");
  };

  const seedDefaults = async () => {
    const generation = beginRequest();
    if (generation === null) {
      return;
    }
    setStatus("saving");
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/games/${encodeURIComponent(gameCatalogId)}/wheel/seed-prizes`,
        { method: "POST" },
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Не удалось загрузить призы");
      }
      setGifts(payload.gifts);
      setWheelConfig(payload.wheelConfig);
      markSaved(generation);
    } catch (error) {
      if (generation === requestGenerationRef.current) {
        setStatus("error");
        setMessage(
          error instanceof Error ? error.message : "Ошибка загрузки призов",
        );
      }
    } finally {
      endRequest();
    }
  };

  const startEditGift = (gift: GameGiftDto) => {
    setEditingGiftId(gift.id);
    setSectorDraft(gift.probability);
    setActiveDraft(gift.isActive);
  };

  const saveGift = async () => {
    if (!editingGiftId) {
      return;
    }
    const generation = beginRequest();
    if (generation === null) {
      return;
    }
    setStatus("saving");
    setMessage(null);
    try {
      const gift = gifts.find((item) => item.id === editingGiftId);
      if (!gift) {
        throw new Error("Приз не найден");
      }
      const response = await fetch(
        `/api/admin/games/${encodeURIComponent(gameCatalogId)}/gifts/${encodeURIComponent(editingGiftId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: gift.name,
            shortDescription: gift.shortDescription,
            isActive: activeDraft,
            probability: Number(sectorDraft),
            activationMode: gift.activationMode,
            activationConditionText: gift.activationConditionText,
            systemKey: gift.systemKey,
            prizeType: gift.prizeType,
            prizeRules: gift.prizeRules,
            sortOrder: gift.sortOrder,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Ошибка сохранения приза");
      }
      await refresh();
      setEditingGiftId(null);
      markSaved(generation);
    } catch (error) {
      if (generation === requestGenerationRef.current) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Ошибка сохранения");
      }
    } finally {
      endRequest();
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded border border-zinc-200 bg-white p-4">
        <h2 className="text-base font-semibold text-zinc-900">
          Колесо фортуны
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          {catalogStatus === "active"
            ? "Игра активна и доступна по публичной ссылке."
            : `Настройте название, ссылку и призы. Для активации сумма активных секторов должна быть равна ${wheelConfig.expectedSectorCount}.`}
        </p>
        <p className="mt-2 text-sm text-zinc-800">
          Статус:{" "}
          <span className="font-medium">
            {GAME_CATALOG_STATUS_LABELS[catalogStatus]}
          </span>
        </p>
        <p className="mt-2 text-sm text-zinc-700">
          Публичная ссылка:{" "}
          <code className="rounded bg-zinc-100 px-2 py-1 text-xs">{publicPath}</code>
          {catalogStatus === "active" ? (
            <>
              {" "}
              <a
                href={publicPath}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#1a73e8] hover:underline"
              >
                Открыть игру
              </a>
            </>
          ) : (
            <span className="ml-2 text-zinc-500">
              (публично недоступна)
            </span>
          )}
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className={labelClass}>Название</span>
            <input
              className={fieldClass}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Slug</span>
            <input
              className={fieldClass}
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className={labelClass}>Описание</span>
            <textarea
              className={fieldClass}
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void saveCatalogMeta()}
            disabled={busy}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Сохранить настройки
          </button>
          {showActivateButton ? (
            <button
              type="button"
              onClick={() => void activateGame()}
              disabled={busy || !canActivate}
              className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Активировать игру
            </button>
          ) : null}
          {showDisableButton ? (
            <button
              type="button"
              onClick={() => void disableGame()}
              disabled={busy}
              className="rounded border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Выключить игру
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void seedDefaults()}
            disabled={busy}
            className="rounded border border-zinc-300 px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Загрузить призы по умолчанию
          </button>
          {statusLabel ? (
            <span
              className={`text-sm ${
                status === "error" ? "text-red-700" : "text-zinc-600"
              }`}
            >
              {statusLabel}
            </span>
          ) : null}
        </div>
        {showActivateButton && !wheelConfig.sectorConfigOk ? (
          <p className="mt-3 text-sm text-amber-900">
            Активация недоступна: исправьте конфигурацию секторов (сумма активных
            должна быть {wheelConfig.expectedSectorCount}).
          </p>
        ) : null}
        {catalogStatus === "archived" ? (
          <p className="mt-3 text-sm text-zinc-600">
            Архивная игра не активируется из этой панели. Сначала восстановите её
            из архива отдельным процессом.
          </p>
        ) : null}
      </section>

      <section className="rounded border border-zinc-200 bg-white p-4">
        <h2 className="text-base font-semibold text-zinc-900">Конфигурация секторов</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Срок подтверждения записи: {wheelConfig.confirmWindowDays} дн. · Срок
          процедуры: {wheelConfig.procedureWindowDays} дн.
        </p>
        <p
          className={`mt-3 rounded px-3 py-2 text-sm ${
            wheelConfig.sectorConfigOk
              ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {wheelConfig.sectorConfigOk
            ? `Сумма активных секторов: ${wheelConfig.activeSectorSum} / ${wheelConfig.expectedSectorCount}`
            : wheelConfig.sectorConfigError}
        </p>
      </section>

      <section className="rounded border border-zinc-200 bg-white p-4">
        <h2 className="text-base font-semibold text-zinc-900">Призы</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-600">
              <tr>
                <th className="px-3 py-2">Название</th>
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2">Ключ</th>
                <th className="px-3 py-2">Секторы</th>
                <th className="px-3 py-2">Активен</th>
                <th className="px-3 py-2">Условия</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {gifts.map((gift) => (
                <tr key={gift.id} className="border-t border-zinc-100 align-top">
                  <td className="px-3 py-2 font-medium text-zinc-900">{gift.name}</td>
                  <td className="px-3 py-2 text-zinc-700">
                    {prizeTypeLabel(gift.prizeType)}
                  </td>
                  <td className="px-3 py-2">
                    <code className="text-xs text-zinc-700">{gift.systemKey ?? "—"}</code>
                  </td>
                  <td className="px-3 py-2 text-zinc-700">{gift.probability}</td>
                  <td className="px-3 py-2 text-zinc-700">
                    {gift.isActive ? "да" : "нет"}
                  </td>
                  <td className="max-w-xs px-3 py-2 text-xs text-zinc-600">
                    {gift.activationConditionText}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-[#1a73e8] hover:underline disabled:opacity-50"
                      onClick={() => startEditGift(gift)}
                      disabled={busy}
                    >
                      Изменить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editingGift ? (
          <div className="mt-4 rounded border border-zinc-200 bg-zinc-50 p-4">
            <h3 className="text-sm font-semibold text-zinc-900">
              Редактирование: {editingGift.name}
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className={labelClass}>Количество секторов / вес</span>
                <input
                  type="number"
                  min={0}
                  className={fieldClass}
                  value={sectorDraft}
                  onChange={(event) => setSectorDraft(Number(event.target.value))}
                  disabled={busy}
                />
              </label>
              <label className="flex items-center gap-2 pt-6 text-sm text-zinc-800">
                <input
                  type="checkbox"
                  checked={activeDraft}
                  onChange={(event) => setActiveDraft(event.target.checked)}
                  disabled={busy}
                />
                Приз активен
              </label>
            </div>
            <p className="mt-2 text-xs text-zinc-600">
              Тип: {prizeTypeLabel(editingGift.prizeType)}. Критические правила
              хранятся на сервере в prizeRules и snapshots.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void saveGift()}
                disabled={busy}
                className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
              >
                Сохранить приз
              </button>
              <button
                type="button"
                onClick={() => setEditingGiftId(null)}
                disabled={busy}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-60"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
