"use client";

import Link from "next/link";
import { useState } from "react";
import type { GameCatalogDto } from "@/types/game-catalog";
import {
  GAME_CATALOG_STATUS_LABELS,
  GAME_CATALOG_TYPE_LABELS,
} from "@/types/game-catalog";

export function GamesCatalogPanel({
  initialGames,
}: {
  initialGames: GameCatalogDto[];
}) {
  const [games, setGames] = useState(initialGames);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyLink = async (game: GameCatalogDto) => {
    try {
      await navigator.clipboard.writeText(game.publicUrl);
      setCopiedId(game.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      window.prompt("Скопируйте ссылку:", game.publicUrl);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-600">
          Каталог игр студии. Текущая игра «Поймай своё время» сохраняет
          существующую механику и настройки.
        </p>
        <Link
          href="/admin/games/new"
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Добавить игру
        </Link>
      </div>

      <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-600">
            <tr>
              <th className="px-3 py-2">Название</th>
              <th className="px-3 py-2">Тип</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2">Публичная ссылка</th>
              <th className="px-3 py-2">Действия</th>
            </tr>
          </thead>
          <tbody>
            {games.map((game) => (
              <tr key={game.id} className="border-t border-zinc-100">
                <td className="px-3 py-3 font-medium text-zinc-900">{game.title}</td>
                <td className="px-3 py-3 text-zinc-700">
                  {GAME_CATALOG_TYPE_LABELS[game.type]}
                </td>
                <td className="px-3 py-3 text-zinc-700">
                  {GAME_CATALOG_STATUS_LABELS[game.status]}
                </td>
                <td className="px-3 py-3">
                  <code className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-800">
                    {game.publicPath}
                  </code>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/admin/games/${game.id}`}
                      className="text-[#1a73e8] hover:underline"
                    >
                      Открыть
                    </Link>
                    <Link
                      href={`/admin/games/${game.id}`}
                      className="text-[#1a73e8] hover:underline"
                    >
                      Редактировать
                    </Link>
                    <button
                      type="button"
                      onClick={() => void copyLink(game)}
                      className="text-[#1a73e8] hover:underline"
                    >
                      {copiedId === game.id ? "Скопировано" : "Скопировать ссылку"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={async () => {
          const response = await fetch("/api/admin/games", { cache: "no-store" });
          const payload = (await response.json()) as {
            ok?: boolean;
            games?: GameCatalogDto[];
          };
          if (payload.games) {
            setGames(payload.games);
          }
        }}
        className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50"
      >
        Обновить список
      </button>
    </div>
  );
}
