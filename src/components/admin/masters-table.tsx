"use client";

import type { MasterAdminRow } from "@/types/master-admin";

const actionButtonClass =
  "rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50";

const primaryActionClass =
  "rounded border border-[#1a73e8] bg-white px-2 py-1 text-xs font-medium text-[#1a73e8] hover:bg-[#e8f0fe]";

const dangerActionClass =
  "rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-red-50 hover:text-red-700";

type MastersTableProps = {
  masters: MasterAdminRow[];
  title?: string;
  emptyMessage?: string;
  showStatusColumn?: boolean;
  showMoveButtons?: boolean;
  onEdit: (master: MasterAdminRow) => void;
  onToggleActive?: (master: MasterAdminRow) => void;
  onMove?: (master: MasterAdminRow, direction: "up" | "down") => void;
};

export function MastersTable({
  masters,
  title,
  emptyMessage = "Мастеров пока нет",
  showStatusColumn = true,
  showMoveButtons = true,
  onEdit,
  onToggleActive,
  onMove,
}: MastersTableProps) {
  if (masters.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {title ? (
          <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        ) : null}
        <div className="rounded border border-[#dadce0] bg-white px-4 py-8 text-center text-sm text-zinc-500">
          {emptyMessage}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {title ? (
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      ) : null}
      <div className="overflow-x-auto rounded border border-[#dadce0] bg-white">
        <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
          <thead className="bg-[#eef0f3]">
            <tr>
              <th className="border-b border-[#dadce0] px-3 py-2 font-semibold text-zinc-800">
                Внутреннее имя
              </th>
              <th className="border-b border-[#dadce0] px-3 py-2 font-semibold text-zinc-800">
                Публичное имя
              </th>
              <th className="border-b border-[#dadce0] px-3 py-2 font-semibold text-zinc-800">
                Описание
              </th>
              {showStatusColumn ? (
                <th className="border-b border-[#dadce0] px-3 py-2 font-semibold text-zinc-800">
                  Статус
                </th>
              ) : null}
              <th className="border-b border-[#dadce0] px-3 py-2 font-semibold text-zinc-800">
                Публичный
              </th>
              <th className="border-b border-[#dadce0] px-3 py-2 font-semibold text-zinc-800">
                Онлайн
              </th>
              <th className="border-b border-[#dadce0] px-3 py-2 font-semibold text-zinc-800">
                Порядок
              </th>
              <th className="border-b border-[#dadce0] px-3 py-2 font-semibold text-zinc-800">
                User
              </th>
              <th className="border-b border-[#dadce0] px-3 py-2 font-semibold text-zinc-800">
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
            {masters.map((master, index) => (
              <tr
                key={master.id}
                className={index % 2 === 1 ? "bg-[#f7f8f9]" : "bg-white"}
              >
                <td className="border-b border-[#dadce0] px-3 py-2 font-medium text-zinc-900">
                  {master.internalName}
                </td>
                <td className="border-b border-[#dadce0] px-3 py-2 text-zinc-800">
                  {master.publicName}
                </td>
                <td className="max-w-[220px] truncate border-b border-[#dadce0] px-3 py-2 text-zinc-600">
                  {master.clientDescription || "—"}
                </td>
                {showStatusColumn ? (
                  <td className="border-b border-[#dadce0] px-3 py-2">
                    {master.isActive ? (
                      <span className="rounded bg-green-50 px-2 py-0.5 font-medium text-green-700">
                        Активен
                      </span>
                    ) : (
                      <span className="rounded bg-zinc-200 px-2 py-0.5 font-medium text-zinc-700">
                        Неактивен
                      </span>
                    )}
                  </td>
                ) : null}
                <td className="border-b border-[#dadce0] px-3 py-2 text-zinc-800">
                  {master.isPublic ? "Да" : "Нет"}
                </td>
                <td className="border-b border-[#dadce0] px-3 py-2 text-zinc-800">
                  {master.isOnlineBookingEnabled ? "Да" : "Нет"}
                </td>
                <td className="border-b border-[#dadce0] px-3 py-2 tabular-nums text-zinc-800">
                  {master.sortOrder}
                </td>
                <td className="border-b border-[#dadce0] px-3 py-2 text-zinc-600">
                  {master.user?.email ?? "—"}
                </td>
                <td className="border-b border-[#dadce0] px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => onEdit(master)}
                      className={primaryActionClass}
                    >
                      Редактировать
                    </button>
                    {onToggleActive ? (
                      <button
                        type="button"
                        onClick={() => onToggleActive(master)}
                        className={
                          master.isActive ? dangerActionClass : actionButtonClass
                        }
                      >
                        {master.isActive ? "В архив" : "Активировать"}
                      </button>
                    ) : null}
                    {showMoveButtons && onMove ? (
                      <>
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => onMove(master, "up")}
                          className={actionButtonClass}
                          aria-label="Выше"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={index === masters.length - 1}
                          onClick={() => onMove(master, "down")}
                          className={actionButtonClass}
                          aria-label="Ниже"
                        >
                          ↓
                        </button>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
