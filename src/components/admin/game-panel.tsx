"use client";

import { useEffect, useMemo, useState } from "react";
import type { GameConfigDto, GameGiftDto } from "@/types/game-admin";

type SaveStatus = "idle" | "saving" | "saved" | "error";

function joinLines(values: string[]): string {
  return values.join("\n");
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const labelClass = "text-xs font-medium text-zinc-700";

export function GamePanel({
  gameCatalogId,
  initialConfig,
  initialGifts,
}: {
  gameCatalogId: string;
  initialConfig: GameConfigDto;
  initialGifts: GameGiftDto[];
}) {
  const [config, setConfig] = useState<GameConfigDto>(initialConfig);
  const [gifts, setGifts] = useState<GameGiftDto[]>(initialGifts);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [editingGiftId, setEditingGiftId] = useState<string | null>(null);
  const [giftDraft, setGiftDraft] = useState<Partial<GameGiftDto> & { name?: string; shortDescription?: string }>(
    {},
  );

  useEffect(() => {
    setConfig(initialConfig);
  }, [initialConfig]);

  useEffect(() => {
    setGifts(initialGifts);
  }, [initialGifts]);

  const editingGift = useMemo(
    () => gifts.find((g) => g.id === editingGiftId) ?? null,
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
      `/api/admin/game/data?catalogId=${encodeURIComponent(gameCatalogId)}`,
      { cache: "no-store" },
    );
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Не удалось обновить данные");
    }
    setConfig(payload.config);
    setGifts(payload.gifts);
  };

  const saveConfig = async () => {
    setStatus("saving");
    setMessage(null);
    try {
      const response = await fetch("/api/admin/game/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isActive: config.isActive,
          title: config.title,
          description: config.description,
          image: config.image,
          resultHeaderText: config.resultHeaderText,
          directionLabelText: config.directionLabelText,
          giftLabelText: config.giftLabelText,
          ctaButtonText: config.ctaButtonText,
          ctaButtonLink: config.ctaButtonLink,
          managerMessageHeader: config.managerMessageHeader,
          managerMessageFooter: config.managerMessageFooter,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !payload.config) {
        throw new Error(payload.error ?? "Ошибка сохранения");
      }
      setConfig(payload.config);
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка сохранения";
      setStatus("error");
      setMessage(text);
    }
  };

  const startCreateGift = () => {
    setEditingGiftId("new");
    setGiftDraft({
      isActive: true,
      probability: 0,
      requiredPremiumLevel: 0,
      allowedGameDirections: [],
      allowedResultTypes: [],
      priority: "standard",
      cardStyle: "default",
      name: "",
      shortDescription: "",
      image: null,
    });
  };

  const startEditGift = (gift: GameGiftDto) => {
    setEditingGiftId(gift.id);
    setGiftDraft({ ...gift });
  };

  const cancelGiftEdit = () => {
    setEditingGiftId(null);
    setGiftDraft({});
  };

  const saveGift = async () => {
    setStatus("saving");
    setMessage(null);
    try {
      const isNew = editingGiftId === "new";
      const url = isNew
        ? `/api/admin/games/${encodeURIComponent(gameCatalogId)}/gifts`
        : `/api/admin/games/${encodeURIComponent(gameCatalogId)}/gifts/${encodeURIComponent(String(editingGiftId))}`;
      const method = isNew ? "POST" : "PATCH";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(giftDraft.name ?? "").trim(),
          shortDescription: String(giftDraft.shortDescription ?? "").trim(),
          image: giftDraft.image ?? null,
          isActive: giftDraft.isActive ?? true,
          probability: Number(giftDraft.probability ?? 0),
          priority: String(giftDraft.priority ?? "standard"),
          cardStyle: String(giftDraft.cardStyle ?? "default"),
          requiredPremiumLevel: Number(giftDraft.requiredPremiumLevel ?? 0),
          allowedGameDirections: Array.isArray(giftDraft.allowedGameDirections)
            ? giftDraft.allowedGameDirections
            : [],
          allowedResultTypes: Array.isArray(giftDraft.allowedResultTypes)
            ? giftDraft.allowedResultTypes
            : [],
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !payload.gift) {
        throw new Error(payload.error ?? "Ошибка сохранения подарка");
      }
      await refresh();
      setEditingGiftId(null);
      setGiftDraft({});
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка сохранения";
      setStatus("error");
      setMessage(text);
    }
  };

  const deleteGift = async (id: string) => {
    setStatus("saving");
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/games/${encodeURIComponent(gameCatalogId)}/gifts/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Не удалось удалить подарок");
      }
      await refresh();
      setEditingGiftId(null);
      setGiftDraft({});
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка удаления";
      setStatus("error");
      setMessage(text);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded border border-[#dadce0] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Настройки игры</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Включение, тексты результата и шаблон сообщения менеджеру.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {statusLabel ? (
              <span
                className={`text-xs ${
                  status === "error"
                    ? "text-red-600"
                    : status === "saved"
                      ? "text-green-700"
                      : "text-zinc-500"
                }`}
              >
                {statusLabel}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void saveConfig()}
              className="rounded bg-[#1a73e8] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1557b0]"
            >
              Сохранить
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-zinc-700 md:col-span-2">
            <input
              type="checkbox"
              checked={config.isActive}
              onChange={(event) =>
                setConfig((current) => ({ ...current, isActive: event.target.checked }))
              }
            />
            Игра активна
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Название</span>
            <input
              className={fieldClass}
              value={config.title}
              onChange={(event) =>
                setConfig((current) => ({ ...current, title: event.target.value }))
              }
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Изображение (URL)</span>
            <input
              className={fieldClass}
              value={config.image ?? ""}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  image: event.target.value.trim() ? event.target.value : null,
                }))
              }
            />
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className={labelClass}>Описание</span>
            <textarea
              className={`${fieldClass} min-h-20`}
              value={config.description}
              onChange={(event) =>
                setConfig((current) => ({ ...current, description: event.target.value }))
              }
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Заголовок результата</span>
            <input
              className={fieldClass}
              value={config.resultHeaderText}
              onChange={(event) =>
                setConfig((current) => ({ ...current, resultHeaderText: event.target.value }))
              }
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Метка направления</span>
            <input
              className={fieldClass}
              value={config.directionLabelText}
              onChange={(event) =>
                setConfig((current) => ({ ...current, directionLabelText: event.target.value }))
              }
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Метка подарка</span>
            <input
              className={fieldClass}
              value={config.giftLabelText}
              onChange={(event) =>
                setConfig((current) => ({ ...current, giftLabelText: event.target.value }))
              }
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Текст CTA</span>
            <input
              className={fieldClass}
              value={config.ctaButtonText}
              onChange={(event) =>
                setConfig((current) => ({ ...current, ctaButtonText: event.target.value }))
              }
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Ссылка кнопки</span>
            <input
              className={fieldClass}
              value={config.ctaButtonLink}
              onChange={(event) =>
                setConfig((current) => ({ ...current, ctaButtonLink: event.target.value }))
              }
              placeholder="/promo/procedure-gift"
            />
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className={labelClass}>Шаблон сообщения менеджеру (шапка)</span>
            <textarea
              className={`${fieldClass} min-h-28 font-mono text-xs`}
              value={config.managerMessageHeader}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  managerMessageHeader: event.target.value,
                }))
              }
            />
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className={labelClass}>Шаблон сообщения менеджеру (подвал)</span>
            <textarea
              className={`${fieldClass} min-h-20 font-mono text-xs`}
              value={config.managerMessageFooter}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  managerMessageFooter: event.target.value,
                }))
              }
            />
          </label>
        </div>
      </section>

      <section className="rounded border border-[#dadce0] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Подарки</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Доступность зависит от результата игры и requiredPremiumLevel.
            </p>
          </div>
          <button
            type="button"
            onClick={startCreateGift}
            className="rounded bg-[#1a73e8] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1557b0]"
          >
            + Подарок
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded border border-[#e8eaed]">
          <table className="min-w-full text-sm">
            <thead className="border-b border-[#dadce0] bg-[#f8f9fa] text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Название</th>
                <th className="px-3 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 font-medium">Probability</th>
                <th className="px-3 py-2 font-medium">Required premium</th>
                <th className="px-3 py-2 font-medium">Правила</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8eaed]">
              {gifts.map((gift) => (
                <tr key={gift.id}>
                  <td className="px-3 py-2 font-medium text-zinc-900">
                    {gift.name}
                    <div className="mt-1 text-xs font-normal text-zinc-500">
                      {gift.shortDescription}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {gift.isActive ? (
                      <span className="rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800">
                        Активен
                      </span>
                    ) : (
                      <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                        Выключен
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{gift.probability}</td>
                  <td className="px-3 py-2">{gift.requiredPremiumLevel}</td>
                  <td className="px-3 py-2 text-xs text-zinc-600">
                    <div>
                      directions:{" "}
                      {gift.allowedGameDirections.length
                        ? gift.allowedGameDirections.join(", ")
                        : "все"}
                    </div>
                    <div>
                      resultTypes:{" "}
                      {gift.allowedResultTypes.length
                        ? gift.allowedResultTypes.join(", ")
                        : "все"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => startEditGift(gift)}
                      className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                    >
                      Изменить
                    </button>
                  </td>
                </tr>
              ))}
              {gifts.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-zinc-500" colSpan={6}>
                    Подарков пока нет.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {editingGiftId ? (
          <div className="mt-4 rounded border border-[#dadce0] bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  {editingGiftId === "new" ? "Новый подарок" : "Редактирование подарка"}
                </h3>
                {editingGift ? (
                  <p className="mt-1 text-xs text-zinc-500">{editingGift.id}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {editingGift && editingGiftId !== "new" ? (
                  <button
                    type="button"
                    onClick={() => void deleteGift(editingGift.id)}
                    className="rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                  >
                    Удалить
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={cancelGiftEdit}
                  className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => void saveGift()}
                  className="rounded bg-[#1a73e8] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1557b0]"
                >
                  Сохранить
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-zinc-700 md:col-span-2">
                <input
                  type="checkbox"
                  checked={giftDraft.isActive ?? true}
                  onChange={(event) =>
                    setGiftDraft((current) => ({ ...current, isActive: event.target.checked }))
                  }
                />
                Активен
              </label>

              <label className="flex flex-col gap-1">
                <span className={labelClass}>Название</span>
                <input
                  className={fieldClass}
                  value={String(giftDraft.name ?? "")}
                  onChange={(event) =>
                    setGiftDraft((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className={labelClass}>Изображение (URL)</span>
                <input
                  className={fieldClass}
                  value={String(giftDraft.image ?? "")}
                  onChange={(event) =>
                    setGiftDraft((current) => ({
                      ...current,
                      image: event.target.value.trim() ? event.target.value : null,
                    }))
                  }
                />
              </label>

              <label className="flex flex-col gap-1 md:col-span-2">
                <span className={labelClass}>Короткое описание</span>
                <textarea
                  className={`${fieldClass} min-h-24`}
                  value={String(giftDraft.shortDescription ?? "")}
                  onChange={(event) =>
                    setGiftDraft((current) => ({
                      ...current,
                      shortDescription: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className={labelClass}>Probability</span>
                <input
                  type="number"
                  min={0}
                  className={fieldClass}
                  value={String(giftDraft.probability ?? 0)}
                  onChange={(event) =>
                    setGiftDraft((current) => ({
                      ...current,
                      probability: Number(event.target.value),
                    }))
                  }
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className={labelClass}>Required premium level</span>
                <input
                  type="number"
                  min={0}
                  className={fieldClass}
                  value={String(giftDraft.requiredPremiumLevel ?? 0)}
                  onChange={(event) =>
                    setGiftDraft((current) => ({
                      ...current,
                      requiredPremiumLevel: Number(event.target.value),
                    }))
                  }
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className={labelClass}>Priority</span>
                <input
                  className={fieldClass}
                  value={String(giftDraft.priority ?? "standard")}
                  onChange={(event) =>
                    setGiftDraft((current) => ({ ...current, priority: event.target.value }))
                  }
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className={labelClass}>Card style</span>
                <input
                  className={fieldClass}
                  value={String(giftDraft.cardStyle ?? "default")}
                  onChange={(event) =>
                    setGiftDraft((current) => ({ ...current, cardStyle: event.target.value }))
                  }
                />
              </label>

              <label className="flex flex-col gap-1 md:col-span-2">
                <span className={labelClass}>allowedGameDirections (по одной на строку; пусто = все)</span>
                <textarea
                  className={`${fieldClass} min-h-20 font-mono text-xs`}
                  value={joinLines(
                    Array.isArray(giftDraft.allowedGameDirections)
                      ? giftDraft.allowedGameDirections
                      : [],
                  )}
                  onChange={(event) =>
                    setGiftDraft((current) => ({
                      ...current,
                      allowedGameDirections: splitLines(event.target.value),
                    }))
                  }
                />
              </label>

              <label className="flex flex-col gap-1 md:col-span-2">
                <span className={labelClass}>allowedResultTypes (по одной на строку; пусто = все)</span>
                <textarea
                  className={`${fieldClass} min-h-20 font-mono text-xs`}
                  value={joinLines(
                    Array.isArray(giftDraft.allowedResultTypes) ? giftDraft.allowedResultTypes : [],
                  )}
                  onChange={(event) =>
                    setGiftDraft((current) => ({
                      ...current,
                      allowedResultTypes: splitLines(event.target.value),
                    }))
                  }
                />
              </label>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

