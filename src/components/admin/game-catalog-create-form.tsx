"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import { normalizeGameSlug } from "@/lib/games/catalog-contract";
import {
  GAME_CATALOG_STATUS_LABELS,
  GAME_CATALOG_TYPE_LABELS,
  getGameCatalogActivationBlockReason,
  type GameCatalogStatusDto,
  type GameCatalogTypeDto,
} from "@/types/game-catalog";

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const labelClass = "text-xs font-medium text-zinc-700";

export function GameCatalogCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<GameCatalogTypeDto>("wheel_of_fortune");
  const [status, setStatus] = useState<GameCatalogStatusDto>("draft");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const blockReason = getGameCatalogActivationBlockReason(type);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          slug: normalizeGameSlug(slug),
          type,
          status,
          description: description || null,
        }),
      });
      const payload = await readApiJsonResponse<{
        ok?: boolean;
        game?: { id: string };
        error?: string;
      }>(response);

      if (!response.ok || !payload.ok || !payload.game) {
        throw new Error(payload.error ?? "Не удалось создать игру");
      }

      router.push(`/admin/games/${payload.game.id}`);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Не удалось создать игру",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4 rounded border border-zinc-200 bg-white p-4">
      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Название</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={fieldClass}
          required
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Slug (для URL /promo/slug)</span>
        <input
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          className={fieldClass}
          placeholder="poimay-svoe-vremya"
          required
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Тип игры</span>
        <select
          value={type}
          onChange={(event) => {
            const nextType = event.target.value as GameCatalogTypeDto;
            setType(nextType);
            if (nextType === "wheel_of_fortune" && status === "active") {
              setStatus("draft");
            }
          }}
          className={fieldClass}
        >
          {Object.entries(GAME_CATALOG_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Статус</span>
        <select
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as GameCatalogStatusDto)
          }
          className={fieldClass}
        >
          {Object.entries(GAME_CATALOG_STATUS_LABELS).map(([value, label]) => (
            <option
              key={value}
              value={value}
              disabled={type === "wheel_of_fortune" && value === "active"}
            >
              {label}
            </option>
          ))}
        </select>
      </label>

      {blockReason ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {blockReason}
        </p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Описание</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          className={fieldClass}
        />
      </label>

      <button
        type="submit"
        disabled={saving}
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
      >
        {saving ? "Создаю…" : "Создать игру"}
      </button>
    </form>
  );
}
