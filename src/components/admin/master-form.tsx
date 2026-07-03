"use client";

import { useEffect, useState } from "react";
import type { MasterAdminRow, MasterWriteInput } from "@/types/master-admin";

type FormState = {
  internalName: string;
  publicName: string;
  clientDescription: string;
  workStart: string;
  workEnd: string;
  slotMinutes: string;
  breakAfterMinutes: string;
  sortOrder: string;
  isActive: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
};

function toFormState(master?: MasterAdminRow): FormState {
  return {
    internalName: master?.internalName ?? "",
    publicName: master?.publicName ?? "",
    clientDescription: master?.clientDescription ?? "",
    workStart: master?.workStart ?? "09:00",
    workEnd: master?.workEnd ?? "18:00",
    slotMinutes: String(master?.slotMinutes ?? 30),
    breakAfterMinutes: String(master?.breakAfterMinutes ?? 0),
    sortOrder: String(master?.sortOrder ?? ""),
    isActive: master?.isActive ?? true,
    isPublic: master?.isPublic ?? true,
    isOnlineBookingEnabled: master?.isOnlineBookingEnabled ?? true,
  };
}

function toPayload(form: FormState): MasterWriteInput {
  return {
    internalName: form.internalName,
    publicName: form.publicName,
    clientDescription: form.clientDescription || null,
    workStart: form.workStart,
    workEnd: form.workEnd,
    slotMinutes: Number(form.slotMinutes),
    breakAfterMinutes: Number(form.breakAfterMinutes),
    sortOrder: form.sortOrder ? Number(form.sortOrder) : undefined,
    isActive: form.isActive,
    isPublic: form.isPublic,
    isOnlineBookingEnabled: form.isOnlineBookingEnabled,
  };
}

export function MasterForm({
  master,
  onSaved,
  onCancel,
  onSaveStatus,
}: {
  master?: MasterAdminRow;
  onSaved: () => void;
  onCancel: () => void;
  onSaveStatus: (
    status: "idle" | "saving" | "saved" | "error",
    message?: string,
  ) => void;
}) {
  const [form, setForm] = useState<FormState>(() => toFormState(master));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(toFormState(master));
  }, [master]);

  const handleSubmit = async () => {
    onSaveStatus("saving");
    setError(null);

    try {
      const response = await fetch(
        master ? `/api/masters/${master.id}` : "/api/masters",
        {
          method: master ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(form)),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Ошибка сохранения");
      }
      onSaveStatus("saved");
      onSaved();
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Ошибка сохранения";
      setError(message);
      onSaveStatus("error", message);
    }
  };

  return (
    <div className="rounded border border-zinc-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold">
        {master ? "Редактировать мастера" : "Новый мастер"}
      </h3>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-600">Внутреннее имя</span>
          <input
            value={form.internalName}
            onChange={(event) =>
              setForm((current) => ({ ...current, internalName: event.target.value }))
            }
            className="border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-600">Публичное имя</span>
          <input
            value={form.publicName}
            onChange={(event) =>
              setForm((current) => ({ ...current, publicName: event.target.value }))
            }
            className="border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs md:col-span-2">
          <span className="text-zinc-600">Описание для клиента</span>
          <textarea
            value={form.clientDescription}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                clientDescription: event.target.value,
              }))
            }
            rows={2}
            className="border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-600">Начало работы</span>
          <input
            type="time"
            value={form.workStart}
            onChange={(event) =>
              setForm((current) => ({ ...current, workStart: event.target.value }))
            }
            className="border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-600">Окончание работы</span>
          <input
            type="time"
            value={form.workEnd}
            onChange={(event) =>
              setForm((current) => ({ ...current, workEnd: event.target.value }))
            }
            className="border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-600">Слот, мин</span>
          <input
            type="number"
            min={1}
            value={form.slotMinutes}
            onChange={(event) =>
              setForm((current) => ({ ...current, slotMinutes: event.target.value }))
            }
            className="border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-600">Перерыв после, мин</span>
          <input
            type="number"
            min={0}
            value={form.breakAfterMinutes}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                breakAfterMinutes: event.target.value,
              }))
            }
            className="border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-600">Порядок колонки</span>
          <input
            type="number"
            min={0}
            value={form.sortOrder}
            onChange={(event) =>
              setForm((current) => ({ ...current, sortOrder: event.target.value }))
            }
            className="border border-zinc-300 px-2 py-1"
            placeholder="Авто"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) =>
              setForm((current) => ({ ...current, isActive: event.target.checked }))
            }
          />
          Активен
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.isPublic}
            onChange={(event) =>
              setForm((current) => ({ ...current, isPublic: event.target.checked }))
            }
          />
          Публичный
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.isOnlineBookingEnabled}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                isOnlineBookingEnabled: event.target.checked,
              }))
            }
          />
          Онлайн-запись
        </label>
      </div>

      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          className="bg-[#1a73e8] px-3 py-1.5 text-xs text-white"
        >
          Сохранить
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border border-zinc-300 px-3 py-1.5 text-xs"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
