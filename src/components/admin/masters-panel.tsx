"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { MasterAdminRow } from "@/types/master-admin";
import { MasterForm } from "@/components/admin/master-form";
import { MastersTable } from "@/components/admin/masters-table";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function MastersPanel({
  initialMasters,
}: {
  initialMasters: MasterAdminRow[];
}) {
  const router = useRouter();
  const [masters, setMasters] = useState(initialMasters);
  const [editingMaster, setEditingMaster] = useState<MasterAdminRow | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const refreshMasters = useCallback(async () => {
    const response = await fetch("/api/masters?includeInactive=true");
    const payload = await response.json();
    if (response.ok && payload.ok) {
      setMasters(payload.masters);
    }
    router.refresh();
  }, [router]);

  const handleSaveStatus = (status: SaveStatus, message?: string) => {
    setSaveStatus(status);
    setSaveMessage(message ?? null);
    if (status === "saved") {
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
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
      if (!response.ok) {
        throw new Error(payload.error ?? "Ошибка сохранения");
      }
      handleSaveStatus("saved");
      await refreshMasters();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Ошибка сохранения";
      handleSaveStatus("error", message);
    }
  };

  const handleMove = async (master: MasterAdminRow, direction: "up" | "down") => {
    const index = masters.findIndex((item) => item.id === master.id);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= masters.length) {
      return;
    }

    const reordered = [...masters];
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
      if (!response.ok) {
        throw new Error(payload.error ?? "Ошибка сортировки");
      }
      handleSaveStatus("saved");
      setMasters(payload.masters);
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
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            setEditingMaster(null);
            setShowCreateForm(true);
          }}
          className="bg-[#1a73e8] px-3 py-1.5 text-xs text-white"
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
        masters={masters}
        onEdit={(master) => {
          setShowCreateForm(false);
          setEditingMaster(master);
        }}
        onToggleActive={(master) => void handleToggleActive(master)}
        onMove={(master, direction) => void handleMove(master, direction)}
      />
    </div>
  );
}
