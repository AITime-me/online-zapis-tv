"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScheduleDayAppointment } from "@/types/schedule";
import {
  diffMinutes,
  formatStudioTimeInput,
  parseStudioDateTime,
} from "@/lib/datetime/date-key";

export type EditorServiceOption = {
  id: string;
  publicName: string;
  durationMinutes: number;
  breakAfterMinutes: number;
  totalBusyMinutes: number;
};

export type EditorOptions = {
  master: { workStart: string; workEnd: string };
  services: EditorServiceOption[];
  statuses: { value: string; label: string }[];
  sources: { value: string; label: string }[];
};

type AppointmentFormState = {
  startTime: string;
  endTime: string;
  serviceId: string;
  clientName: string;
  clientPhone: string;
  status: string;
  source: string;
  comment: string;
  importantNote: string;
  isBold: boolean;
};

function toFormState(appointment: ScheduleDayAppointment): AppointmentFormState {
  return {
    startTime: formatStudioTimeInput(appointment.startsAt),
    endTime: formatStudioTimeInput(appointment.endsAt),
    serviceId: appointment.serviceId ?? "",
    clientName: appointment.clientName,
    clientPhone: appointment.clientPhone,
    status: appointment.statusCode,
    source: appointment.sourceCode,
    comment: appointment.comment ?? "",
    importantNote: appointment.importantNote ?? "",
    isBold: appointment.isBold,
  };
}

function addMinutesToTime(dateKey: string, time: string, minutes: number): string {
  const base = parseStudioDateTime(dateKey, time);
  const result = new Date(base.getTime() + minutes * 60_000);
  return formatStudioTimeInput(result);
}

export function AppointmentEditorForm({
  appointment,
  dateKey,
  masterId,
  options,
  canEdit,
  onSaved,
  onCancelled,
  onSaveStatus,
}: {
  appointment: ScheduleDayAppointment;
  dateKey: string;
  masterId: string;
  options: EditorOptions;
  canEdit: boolean;
  onSaved: () => void;
  onCancelled: () => void;
  onSaveStatus: (status: "idle" | "saving" | "saved" | "error", message?: string) => void;
}) {
  const [form, setForm] = useState<AppointmentFormState>(() =>
    toFormState(appointment),
  );
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => {
    setForm(toFormState(appointment));
  }, [appointment]);

  const selectedService = options.services.find(
    (service) => service.id === form.serviceId,
  );

  const actualMinutes = diffMinutes(
    parseStudioDateTime(dateKey, form.startTime),
    parseStudioDateTime(dateKey, form.endTime),
  );

  const shorterThanStandard =
    selectedService != null && actualMinutes < selectedService.totalBusyMinutes;

  const save = useCallback(async () => {
    if (!canEdit) {
      return;
    }

    onSaveStatus("saving");
    setError(null);

    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masterId,
          dateKey,
          startTime: formRef.current.startTime,
          endTime: formRef.current.endTime,
          serviceId: formRef.current.serviceId || null,
          clientName: formRef.current.clientName,
          clientPhone: formRef.current.clientPhone,
          status: formRef.current.status,
          source: formRef.current.source,
          comment: formRef.current.comment || null,
          importantNote: formRef.current.importantNote || null,
          isBold: formRef.current.isBold,
        }),
      });

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
  }, [
    appointment.id,
    canEdit,
    dateKey,
    masterId,
    onSaved,
    onSaveStatus,
  ]);

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      void save();
    }, 500);
  }, [save]);

  const updateField = <K extends keyof AppointmentFormState>(
    key: K,
    value: AppointmentFormState[K],
  ) => {
    setForm((current) => {
      const next = { ...current, [key]: value };

      if (key === "serviceId" && typeof value === "string") {
        const service = options.services.find((item) => item.id === value);
        if (service) {
          next.endTime = addMinutesToTime(
            dateKey,
            next.startTime,
            service.totalBusyMinutes,
          );
        }
      }

      if (key === "startTime" && typeof value === "string" && next.serviceId) {
        const service = options.services.find(
          (item) => item.id === next.serviceId,
        );
        if (service) {
          next.endTime = addMinutesToTime(
            dateKey,
            value,
            service.totalBusyMinutes,
          );
        }
      }

      return next;
    });
    scheduleSave();
  };

  const handleBlur = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    void save();
  };

  const handleCancel = async () => {
    if (!canEdit || !confirm("Отменить запись?")) {
      return;
    }

    onSaveStatus("saving");
    setError(null);

    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Ошибка отмены");
      }
      onSaveStatus("saved");
      onCancelled();
    } catch (cancelError) {
      const message =
        cancelError instanceof Error ? cancelError.message : "Ошибка отмены";
      setError(message);
      onSaveStatus("error", message);
    }
  };

  if (!canEdit) {
    return (
      <article className="border border-[#e8eaed] px-2 py-1 text-xs">
        <div className="tabular-nums text-[10px] text-zinc-500">
          {form.startTime}–{form.endTime}
        </div>
        <div className={appointment.isBold ? "font-bold" : ""}>
          {appointment.clientName}
          {appointment.serviceName ? ` · ${appointment.serviceName}` : ""}
        </div>
      </article>
    );
  }

  return (
    <article className="border border-[#e8eaed] p-2 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-zinc-500">Начало</span>
          <input
            type="time"
            value={form.startTime}
            onChange={(event) => updateField("startTime", event.target.value)}
            onBlur={handleBlur}
            className="border border-[#dadce0] px-1 py-0.5"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-zinc-500">Окончание</span>
          <input
            type="time"
            value={form.endTime}
            onChange={(event) => updateField("endTime", event.target.value)}
            onBlur={handleBlur}
            className="border border-[#dadce0] px-1 py-0.5"
          />
        </label>
      </div>

      {shorterThanStandard ? (
        <p className="mt-1 text-[10px] text-amber-800">
          Фактическое время короче стандартного для этой услуги
        </p>
      ) : null}

      <label className="mt-2 flex flex-col gap-0.5">
        <span className="text-[10px] text-zinc-500">Услуга</span>
        <select
          value={form.serviceId}
          onChange={(event) => updateField("serviceId", event.target.value)}
          onBlur={handleBlur}
          className="border border-[#dadce0] px-1 py-0.5"
        >
          <option value="">—</option>
          {options.services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.publicName}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-2 flex flex-col gap-0.5">
        <span className="text-[10px] text-zinc-500">Клиент</span>
        <input
          value={form.clientName}
          onChange={(event) => updateField("clientName", event.target.value)}
          onBlur={handleBlur}
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </label>

      <label className="mt-2 flex flex-col gap-0.5">
        <span className="text-[10px] text-zinc-500">Телефон</span>
        <input
          value={form.clientPhone}
          onChange={(event) => updateField("clientPhone", event.target.value)}
          onBlur={handleBlur}
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </label>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-zinc-500">Статус</span>
          <select
            value={form.status}
            onChange={(event) => updateField("status", event.target.value)}
            onBlur={handleBlur}
            className="border border-[#dadce0] px-1 py-0.5"
          >
            {options.statuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-zinc-500">Источник</span>
          <select
            value={form.source}
            onChange={(event) => updateField("source", event.target.value)}
            onBlur={handleBlur}
            className="border border-[#dadce0] px-1 py-0.5"
          >
            {options.sources.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-2 flex flex-col gap-0.5">
        <span className="text-[10px] text-zinc-500">Комментарий</span>
        <textarea
          value={form.comment}
          onChange={(event) => updateField("comment", event.target.value)}
          onBlur={handleBlur}
          rows={2}
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </label>

      <label className="mt-2 flex flex-col gap-0.5">
        <span className="text-[10px] text-zinc-500">Важная пометка</span>
        <input
          value={form.importantNote}
          onChange={(event) => updateField("importantNote", event.target.value)}
          onBlur={handleBlur}
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </label>

      <label className="mt-2 flex items-center gap-2 text-[10px]">
        <input
          type="checkbox"
          checked={form.isBold}
          onChange={(event) => updateField("isBold", event.target.checked)}
        />
        Жирное выделение
      </label>

      {error ? <p className="mt-2 text-[10px] text-red-600">{error}</p> : null}

      <button
        type="button"
        onClick={() => void handleCancel()}
        className="mt-2 text-[10px] text-red-600 hover:underline"
      >
        Отменить запись
      </button>
    </article>
  );
}

export function NewAppointmentForm({
  dateKey,
  masterId,
  options,
  onCreated,
  onSaveStatus,
  onCancel,
}: {
  dateKey: string;
  masterId: string;
  options: EditorOptions;
  onCreated: () => void;
  onSaveStatus: (status: "idle" | "saving" | "saved" | "error", message?: string) => void;
  onCancel: () => void;
}) {
  const defaultService = options.services[0];
  const [form, setForm] = useState<AppointmentFormState>({
    startTime: options.master.workStart,
    endTime: defaultService
      ? addMinutesToTime(dateKey, options.master.workStart, defaultService.totalBusyMinutes)
      : "10:00",
    serviceId: defaultService?.id ?? "",
    clientName: "",
    clientPhone: "+70000000000",
    status: "SCHEDULED",
    source: "INTERNAL",
    comment: "",
    importantNote: "",
    isBold: false,
  });
  const [error, setError] = useState<string | null>(null);

  const selectedService = options.services.find(
    (service) => service.id === form.serviceId,
  );
  const actualMinutes = diffMinutes(
    parseStudioDateTime(dateKey, form.startTime),
    parseStudioDateTime(dateKey, form.endTime),
  );
  const shorterThanStandard =
    selectedService != null && actualMinutes < selectedService.totalBusyMinutes;

  const handleCreate = async () => {
    onSaveStatus("saving");
    setError(null);

    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masterId,
          dateKey,
          ...form,
          serviceId: form.serviceId || null,
          comment: form.comment || null,
          importantNote: form.importantNote || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Ошибка создания");
      }
      onSaveStatus("saved");
      onCreated();
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : "Ошибка создания";
      setError(message);
      onSaveStatus("error", message);
    }
  };

  return (
    <div className="border border-[#dadce0] bg-[#f8f9fa] p-2 text-xs">
      <p className="mb-2 font-medium">Новая запись</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-zinc-500">Начало</span>
          <input
            type="time"
            value={form.startTime}
            onChange={(event) => {
              const startTime = event.target.value;
              setForm((current) => {
                const service = options.services.find(
                  (item) => item.id === current.serviceId,
                );
                return {
                  ...current,
                  startTime,
                  endTime: service
                    ? addMinutesToTime(dateKey, startTime, service.totalBusyMinutes)
                    : current.endTime,
                };
              });
            }}
            className="border border-[#dadce0] px-1 py-0.5"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-zinc-500">Окончание</span>
          <input
            type="time"
            value={form.endTime}
            onChange={(event) =>
              setForm((current) => ({ ...current, endTime: event.target.value }))
            }
            className="border border-[#dadce0] px-1 py-0.5"
          />
        </label>
      </div>

      {shorterThanStandard ? (
        <p className="mt-1 text-[10px] text-amber-800">
          Фактическое время короче стандартного для этой услуги
        </p>
      ) : null}

      <label className="mt-2 flex flex-col gap-0.5">
        <span className="text-[10px] text-zinc-500">Услуга</span>
        <select
          value={form.serviceId}
          onChange={(event) => {
            const serviceId = event.target.value;
            const service = options.services.find((item) => item.id === serviceId);
            setForm((current) => ({
              ...current,
              serviceId,
              endTime: service
                ? addMinutesToTime(dateKey, current.startTime, service.totalBusyMinutes)
                : current.endTime,
            }));
          }}
          className="border border-[#dadce0] px-1 py-0.5"
        >
          <option value="">—</option>
          {options.services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.publicName}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-2 flex flex-col gap-0.5">
        <span className="text-[10px] text-zinc-500">Клиент</span>
        <input
          value={form.clientName}
          onChange={(event) =>
            setForm((current) => ({ ...current, clientName: event.target.value }))
          }
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </label>

      <label className="mt-2 flex flex-col gap-0.5">
        <span className="text-[10px] text-zinc-500">Телефон</span>
        <input
          value={form.clientPhone}
          onChange={(event) =>
            setForm((current) => ({ ...current, clientPhone: event.target.value }))
          }
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </label>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-zinc-500">Статус</span>
          <select
            value={form.status}
            onChange={(event) =>
              setForm((current) => ({ ...current, status: event.target.value }))
            }
            className="border border-[#dadce0] px-1 py-0.5"
          >
            {options.statuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-zinc-500">Источник</span>
          <select
            value={form.source}
            onChange={(event) =>
              setForm((current) => ({ ...current, source: event.target.value }))
            }
            className="border border-[#dadce0] px-1 py-0.5"
          >
            {options.sources.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-2 flex flex-col gap-0.5">
        <span className="text-[10px] text-zinc-500">Комментарий</span>
        <textarea
          value={form.comment}
          onChange={(event) =>
            setForm((current) => ({ ...current, comment: event.target.value }))
          }
          rows={2}
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </label>

      <label className="mt-2 flex flex-col gap-0.5">
        <span className="text-[10px] text-zinc-500">Важная пометка</span>
        <input
          value={form.importantNote}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              importantNote: event.target.value,
            }))
          }
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </label>

      <label className="mt-2 flex items-center gap-2 text-[10px]">
        <input
          type="checkbox"
          checked={form.isBold}
          onChange={(event) =>
            setForm((current) => ({ ...current, isBold: event.target.checked }))
          }
        />
        Жирное выделение
      </label>

      {error ? <p className="mt-2 text-[10px] text-red-600">{error}</p> : null}

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void handleCreate()}
          className="bg-[#1a73e8] px-2 py-1 text-[10px] text-white"
        >
          Добавить
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border border-[#dadce0] px-2 py-1 text-[10px]"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
