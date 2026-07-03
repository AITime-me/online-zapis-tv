"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MasterAdminRow } from "@/types/master-admin";
import { MasterForm } from "@/components/admin/master-form";
import { MastersTable } from "@/components/admin/masters-table";

type SaveStatus = "idle" | "saving" | "saved" | "error";

function replaceMaster(
  masters: MasterAdminRow[],
  updated: MasterAdminRow,
): MasterAdminRow[] {
  return masters.map((item) => (item.id === updated.id ? updated : item));
}

export function MastersPanel({
  initialMasters,
}: {
  initialMasters: MasterAdminRow[];
}) {
  const router = useRouter();
  const [masters, setMasters] = useState(initialMasters);
  const [editingMaster, setEditingMaster] = useState<MasterAdminRow | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const activeMasters = useMemo(
    () => masters.filter((master) => master.isActive),
    [masters],
  );
  const archivedMasters = useMemo(
    () => masters.filter((master) => !master.isActive),
    [masters],
  );

  useEffect(() => {
    setMasters(initialMasters);
  }, [initialMasters]);

  const refreshMasters = useCallback(async () => {
    const response = await fetch("/api/masters?includeInactive=true", {
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Не удалось обновить список");
    }
    setMasters(payload.masters);
    router.refresh();
  }, [router]);

  const handleSaveStatus = (status: SaveStatus, message?: string) => {
    setSaveStatus(status);
    setSaveMessage(message ?? null);
    if (status === "saved") {
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  };

  const openEditForm = (master: MasterAdminRow) => {
    setShowCreateForm(false);
    setEditingMaster(master);
  };

  const handleToggleActive = async (master: MasterAdminRow) => {
    handleSaveStatus("saving");
    try {
      const response = await fetch(`/api/masters/${master.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !master.isActive }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !payload.master) {
        throw new Error(payload.error ?? "Ошибка сохранения");
      }
      setMasters((current) => replaceMaster(current, payload.master));
      if (editingMaster?.id === master.id) {
        setEditingMaster(payload.master);
      }
      handleSaveStatus("saved");
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Ошибка сохранения";
      handleSaveStatus("error", message);
    }
  };

  const handleMove = async (master: MasterAdminRow, direction: "up" | "down") => {
    const index = activeMasters.findIndex((item) => item.id === master.id);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= activeMasters.length) {
      return;
    }

    const reordered = [...activeMasters];
    [reordered[index], reordered[swapIndex]] = [
      reordered[swapIndex],
      reordered[index],
    ];

    const items = reordered.map((item, itemIndex) => ({
      id: item.id,
      sortOrder: itemIndex + 1,
    }));

    handleSaveStatus("saving");
    try {
      const response = await fetch("/api/masters/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !payload.masters) {
        throw new Error(payload.error ?? "Ошибка сортировки");
      }
      setMasters(payload.masters);
      handleSaveStatus("saved");
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Ошибка сортировки";
      handleSaveStatus("error", message);
    }
  };

  const statusLabel =
    saveStatus === "saving"
      ? "Сохраняю..."
      : saveStatus === "saved"
        ? "Сохранено"
        : saveStatus === "error"
          ? `Ошибка${saveMessage ? `: ${saveMessage}` : ""}`
          : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded border border-[#dadce0] bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => {
            setEditingMaster(null);
            setShowCreateForm(true);
          }}
          className="rounded bg-[#1a73e8] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1557b0]"
        >
          + Мастер
        </button>
        {statusLabel ? (
          <p
            className={`text-xs ${
              saveStatus === "error"
                ? "text-red-600"
                : saveStatus === "saved"
                  ? "text-green-700"
                  : "text-zinc-500"
            }`}
          >
            {statusLabel}
          </p>
        ) : null}
      </div>

      {showCreateForm ? (
        <MasterForm
          onSaved={async () => {
            setShowCreateForm(false);
            await refreshMasters();
          }}
          onCancel={() => setShowCreateForm(false)}
          onSaveStatus={handleSaveStatus}
        />
      ) : null}

      {editingMaster ? (
        <MasterForm
          master={editingMaster}
          onSaved={async () => {
            setEditingMaster(null);
            await refreshMasters();
          }}
          onCancel={() => setEditingMaster(null)}
          onSaveStatus={handleSaveStatus}
        />
      ) : null}

      <MastersTable
        title="Активные мастера"
        masters={activeMasters}
        emptyMessage="Активных мастеров пока нет"
        onEdit={openEditForm}
        onToggleActive={(master) => void handleToggleActive(master)}
        onMove={(master, direction) => void handleMove(master, direction)}
      />

      {archivedMasters.length > 0 ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowArchive((current) => !current)}
            className="self-start rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            {showArchive
              ? "Скрыть архив"
              : `Показать архив (${archivedMasters.length})`}
          </button>

          {showArchive ? (
            <MastersTable
              title="Архив мастеров"
              masters={archivedMasters}
              emptyMessage="В архиве нет мастеров"
              showStatusColumn={false}
              showMoveButtons={false}
              onEdit={openEditForm}
              onToggleActive={(master) => void handleToggleActive(master)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
