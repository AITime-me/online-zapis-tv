"use client";

import { useEffect, useState } from "react";
import type { MasterAdminRow, MasterWriteInput } from "@/types/master-admin";

type FormState = {
  internalName: string;
  publicName: string;
  clientDescription: string;
  usesDefaultWorkHours: boolean;
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
  const usesDefaults = master?.usesDefaultWorkHours ?? !master;

  return {
    internalName: master?.internalName ?? "",
    publicName: master?.publicName ?? "",
    clientDescription: master?.clientDescription ?? "",
    usesDefaultWorkHours: usesDefaults,
    workStart: usesDefaults ? "" : (master?.workStart ?? ""),
    workEnd: usesDefaults ? "" : (master?.workEnd ?? ""),
    slotMinutes: usesDefaults ? "" : String(master?.slotMinutes ?? ""),
    breakAfterMinutes: usesDefaults ? "" : String(master?.breakAfterMinutes ?? ""),
    sortOrder: String(master?.sortOrder ?? ""),
    isActive: master?.isActive ?? true,
    isPublic: master?.isPublic ?? true,
    isOnlineBookingEnabled: master?.isOnlineBookingEnabled ?? true,
  };
}

function toPayload(form: FormState): MasterWriteInput {
  const usesDefaults = form.usesDefaultWorkHours;

  return {
    internalName: form.internalName,
    publicName: form.publicName,
    clientDescription: form.clientDescription || null,
    workStart: usesDefaults ? null : form.workStart,
    workEnd: usesDefaults ? null : form.workEnd,
    slotMinutes: usesDefaults
      ? null
      : form.slotMinutes
        ? Number(form.slotMinutes)
        : null,
    breakAfterMinutes: usesDefaults
      ? null
      : form.breakAfterMinutes
        ? Number(form.breakAfterMinutes)
        : null,
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
      if (!response.ok || !payload.ok) {
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
    <div className="rounded border border-[#dadce0] bg-white p-4 shadow-sm">
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
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-600">Публичное имя</span>
          <input
            value={form.publicName}
            onChange={(event) =>
              setForm((current) => ({ ...current, publicName: event.target.value }))
            }
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
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
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-xs md:col-span-2">
          <input
            type="checkbox"
            checked={form.usesDefaultWorkHours}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                usesDefaultWorkHours: event.target.checked,
                workStart: event.target.checked ? "" : current.workStart,
                workEnd: event.target.checked ? "" : current.workEnd,
                slotMinutes: event.target.checked ? "" : current.slotMinutes,
                breakAfterMinutes: event.target.checked
                  ? ""
                  : current.breakAfterMinutes,
              }))
            }
          />
          Использовать стандартные часы работы
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-600">Начало работы</span>
          <input
            type="time"
            value={form.workStart}
            disabled={form.usesDefaultWorkHours}
            onChange={(event) =>
              setForm((current) => ({ ...current, workStart: event.target.value }))
            }
            className="rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100"
            placeholder="По умолчанию"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-600">Окончание работы</span>
          <input
            type="time"
            value={form.workEnd}
            disabled={form.usesDefaultWorkHours}
            onChange={(event) =>
              setForm((current) => ({ ...current, workEnd: event.target.value }))
            }
            className="rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100"
            placeholder="По умолчанию"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-600">Слот, мин</span>
          <input
            type="number"
            min={1}
            value={form.slotMinutes}
            disabled={form.usesDefaultWorkHours}
            onChange={(event) =>
              setForm((current) => ({ ...current, slotMinutes: event.target.value }))
            }
            className="rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100"
            placeholder="30"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-600">Перерыв после, мин</span>
          <input
            type="number"
            min={0}
            value={form.breakAfterMinutes}
            disabled={form.usesDefaultWorkHours}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                breakAfterMinutes: event.target.value,
              }))
            }
            className="rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100"
            placeholder="15"
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
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
            placeholder="Авто"
          />
        </label>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
        Если время не указано: будни 09:00–20:00, выходные 10:00–20:00, слот 30
        мин, перерыв после записи 15 мин.
      </p>

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

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        Если «Онлайн-запись» выключена, мастер будет виден клиенту, но запись
        будет доступна только через менеджера.
      </p>

      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          className="rounded bg-[#1a73e8] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1557b0]"
        >
          Сохранить
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
