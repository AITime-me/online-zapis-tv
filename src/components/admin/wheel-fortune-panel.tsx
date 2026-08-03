"use client";

import { useMemo, useState } from "react";
import type { GameGiftDto, WheelCatalogConfigDto } from "@/types/game-admin";
import { GAME_PRIZE_TYPE_LABELS } from "@/lib/game/wheel/prize-types";
import type { GamePrizeType } from "@/lib/game/wheel/prize-types";

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const labelClass = "text-xs font-medium text-zinc-700";

function prizeTypeLabel(type: GameGiftDto["prizeType"]): string {
  if (!type) {
    return "—";
  }
  return GAME_PRIZE_TYPE_LABELS[type as GamePrizeType] ?? type;
}

export function WheelFortunePanel({
  gameCatalogId,
  initialGifts,
  initialWheelConfig,
  initialTitle,
  initialSlug,
  initialDescription,
}: {
  gameCatalogId: string;
  initialGifts: GameGiftDto[];
  initialWheelConfig: WheelCatalogConfigDto;
  initialTitle: string;
  initialSlug: string;
  initialDescription: string | null;
}) {
  const [gifts, setGifts] = useState(initialGifts);
  const [wheelConfig, setWheelConfig] = useState(initialWheelConfig);
  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [editingGiftId, setEditingGiftId] = useState<string | null>(null);
  const [sectorDraft, setSectorDraft] = useState(0);
  const [activeDraft, setActiveDraft] = useState(true);

  const editingGift = useMemo(
    () => gifts.find((gift) => gift.id === editingGiftId) ?? null,
    [editingGiftId, gifts],
  );

  const statusLabel =
    status === "saving"
      ? "Сохраняю..."
      : status === "saved"
        ? "Сохранено"
        : status === "error"
          ? `Ошибка${message ? `: ${message}` : ""}`
          : null;

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
  };

  const saveCatalogMeta = async () => {
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
            status: "draft",
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Ошибка сохранения");
      }
      await refresh();
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Ошибка сохранения");
    }
  };

  const seedDefaults = async () => {
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
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Ошибка загрузки призов");
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
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Ошибка сохранения");
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded border border-zinc-200 bg-white p-4">
        <h2 className="text-base font-semibold text-zinc-900">
          Черновик «Колесо фортуны»
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Публичная активация на этом этапе недоступна. Настройте название, slug и
          призы (сумма активных секторов = {wheelConfig.expectedSectorCount}).
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className={labelClass}>Название</span>
            <input
              className={fieldClass}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Slug</span>
            <input
              className={fieldClass}
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className={labelClass}>Описание</span>
            <textarea
              className={fieldClass}
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void saveCatalogMeta()}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Сохранить черновик
          </button>
          <button
            type="button"
            onClick={() => void seedDefaults()}
            className="rounded border border-zinc-300 px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50"
          >
            Загрузить призы по умолчанию
          </button>
          {statusLabel ? (
            <span className="text-sm text-zinc-600">{statusLabel}</span>
          ) : null}
        </div>
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
                      className="text-[#1a73e8] hover:underline"
                      onClick={() => startEditGift(gift)}
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
                />
              </label>
              <label className="flex items-center gap-2 pt-6 text-sm text-zinc-800">
                <input
                  type="checkbox"
                  checked={activeDraft}
                  onChange={(event) => setActiveDraft(event.target.checked)}
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
                className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white"
              >
                Сохранить приз
              </button>
              <button
                type="button"
                onClick={() => setEditingGiftId(null)}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
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
