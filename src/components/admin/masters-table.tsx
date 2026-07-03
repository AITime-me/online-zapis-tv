"use client";

import type { MasterAdminRow } from "@/types/master-admin";

export function MastersTable({
  masters,
  onEdit,
  onToggleActive,
  onMove,
}: {
  masters: MasterAdminRow[];
  onEdit: (master: MasterAdminRow) => void;
  onToggleActive: (master: MasterAdminRow) => void;
  onMove: (master: MasterAdminRow, direction: "up" | "down") => void;
}) {
  return (
    <div className="overflow-x-auto rounded border border-zinc-200">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead className="bg-zinc-50">
          <tr className="border-b border-zinc-200">
            <th className="px-3 py-2">Внутреннее имя</th>
            <th className="px-3 py-2">Публичное имя</th>
            <th className="px-3 py-2">Описание</th>
            <th className="px-3 py-2">Статус</th>
            <th className="px-3 py-2">Публичный</th>
            <th className="px-3 py-2">Онлайн</th>
            <th className="px-3 py-2">Порядок</th>
            <th className="px-3 py-2">User</th>
            <th className="px-3 py-2">Действия</th>
          </tr>
        </thead>
        <tbody>
          {masters.map((master, index) => (
            <tr key={master.id} className="border-b border-zinc-100">
              <td className="px-3 py-2 font-medium">{master.internalName}</td>
              <td className="px-3 py-2">{master.publicName}</td>
              <td className="max-w-[220px] truncate px-3 py-2 text-zinc-600">
                {master.clientDescription || "—"}
              </td>
              <td className="px-3 py-2">
                {master.isActive ? (
                  <span className="rounded bg-green-50 px-2 py-0.5 text-green-700">
                    Активен
                  </span>
                ) : (
                  <span className="rounded bg-zinc-200 px-2 py-0.5 text-zinc-700">
                    Неактивен
                  </span>
                )}
              </td>
              <td className="px-3 py-2">{master.isPublic ? "Да" : "Нет"}</td>
              <td className="px-3 py-2">
                {master.isOnlineBookingEnabled ? "Да" : "Нет"}
              </td>
              <td className="px-3 py-2 tabular-nums">{master.sortOrder}</td>
              <td className="px-3 py-2 text-zinc-600">
                {master.user?.email ?? "—"}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onEdit(master)}
                    className="text-[#1a73e8] hover:underline"
                  >
                    Редактировать
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleActive(master)}
                    className="text-zinc-700 hover:underline"
                  >
                    {master.isActive ? "Деактивировать" : "Активировать"}
                  </button>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => onMove(master, "up")}
                    className="text-zinc-700 hover:underline disabled:text-zinc-300"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === masters.length - 1}
                    onClick={() => onMove(master, "down")}
                    className="text-zinc-700 hover:underline disabled:text-zinc-300"
                  >
                    ↓
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
