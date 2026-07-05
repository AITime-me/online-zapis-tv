"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScheduleDayAppointment } from "@/types/schedule";
import {
  addMinutesSafe,
  diffMinutes,
  parseStudioDateTime,
} from "@/lib/datetime/date-layer";
import {
  toScheduleTimeInput,
  type EditorOptions,
} from "@/lib/schedule/editor-options";
import type { ScheduleEditorFieldKey } from "@/lib/schedule/editor-field-labels";
import type { EditorServiceOption } from "@/services/ScheduleEditorOptionsService";
import { EditorCheckboxField, EditorField } from "@/components/schedule/editor-field";
import { getScheduleAppointmentTitle } from "@/lib/schedule/appointment-display";
import { AppointmentPromoBadges } from "@/components/schedule/appointment-promo-badges";

export type { EditorOptions };

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

function formatEditorServicePrice(service: EditorServiceOption): string | null {
  if (service.priceFrom != null && service.priceTo != null) {
    return `${service.priceFrom}–${service.priceTo} ₽`;
  }
  if (service.priceFrom != null) {
    return `от ${service.priceFrom} ₽`;
  }
  return null;
}

function toFormState(appointment: ScheduleDayAppointment): AppointmentFormState {
  return {
    startTime: toScheduleTimeInput(appointment.startsAt, "09:00"),
    endTime: toScheduleTimeInput(appointment.endsAt, "10:00"),
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
  const result = addMinutesSafe(base, minutes);
  return toScheduleTimeInput(result, time);
}

function buildServiceOptions(
  bookable: EditorServiceOption[],
  appointment: ScheduleDayAppointment,
  dateKey: string,
): EditorServiceOption[] {
  if (!appointment.serviceId) {
    return bookable;
  }

  if (bookable.some((service) => service.id === appointment.serviceId)) {
    return bookable;
  }

  const durationMinutes = Math.max(
    diffMinutes(
      parseStudioDateTime(dateKey, toScheduleTimeInput(appointment.startsAt, "09:00")),
      parseStudioDateTime(dateKey, toScheduleTimeInput(appointment.endsAt, "10:00")),
    ),
    1,
  );

  return [
    {
      id: appointment.serviceId,
      publicName: `${appointment.serviceName ?? "Услуга"} (текущая, недоступна для новых записей)`,
      durationMinutes,
      breakAfterMinutes: 0,
      totalBusyMinutes: durationMinutes,
      priceFrom: null,
      priceTo: null,
      unavailable: true,
    },
    ...bookable,
  ];
}

function ServiceMeta({ service }: { service: EditorServiceOption | undefined }) {
  if (!service) {
    return null;
  }

  const priceLabel = formatEditorServicePrice(service);

  return (
    <p className="mt-1 text-[10px] text-zinc-500">
      Длительность: {service.durationMinutes} мин
      {service.breakAfterMinutes > 0
        ? ` · перерыв: ${service.breakAfterMinutes} мин`
        : ""}
      {priceLabel ? ` · ${priceLabel}` : ""}
      {service.unavailable
        ? " · недоступна для новых записей"
        : ""}
    </p>
  );
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
  onSaved: () => void | Promise<void>;
  onCancelled: () => void | Promise<void>;
  onSaveStatus: (status: "idle" | "saving" | "saved" | "error", message?: string) => void;
}) {
  const [form, setForm] = useState<AppointmentFormState>(() =>
    toFormState(appointment),
  );
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef(form);
  formRef.current = form;

  const serviceOptions = useMemo(
    () => buildServiceOptions(options.services, appointment, dateKey),
    [appointment, dateKey, options.services],
  );

  const fieldId = (name: ScheduleEditorFieldKey) =>
    `appointment-${appointment.id}-${name}`;

  useEffect(() => {
    setForm(toFormState(appointment));
  }, [appointment]);

  const selectedService = serviceOptions.find(
    (service) => service.id === form.serviceId,
  );

  const actualMinutes = diffMinutes(
    parseStudioDateTime(dateKey, form.startTime),
    parseStudioDateTime(dateKey, form.endTime),
  );

  const shorterThanStandard =
    selectedService != null &&
    !selectedService.unavailable &&
    actualMinutes < selectedService.durationMinutes;

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
      if (process.env.NODE_ENV === "development") {
        console.log("[schedule] appointment saved", {
          id: appointment.id,
          action: "patch",
        });
      }
      await onSaved();
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

  const applyServiceTiming = (
    state: AppointmentFormState,
    service: EditorServiceOption | undefined,
  ): AppointmentFormState => {
    if (!service || service.unavailable) {
      return state;
    }

    return {
      ...state,
      endTime: addMinutesToTime(
        dateKey,
        state.startTime,
        service.durationMinutes,
      ),
    };
  };

  const updateField = <K extends keyof AppointmentFormState>(
    key: K,
    value: AppointmentFormState[K],
  ) => {
    setForm((current) => {
      let next = { ...current, [key]: value };

      if (key === "serviceId" && typeof value === "string") {
        const service = serviceOptions.find((item) => item.id === value);
        next = applyServiceTiming(next, service);
      }

      if (key === "startTime" && typeof value === "string" && next.serviceId) {
        const service = serviceOptions.find(
          (item) => item.id === next.serviceId,
        );
        if (service && !service.unavailable) {
          next = applyServiceTiming({ ...next, startTime: value }, service);
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
      await onCancelled();
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
        <div className={appointment.isBold ? "font-bold" : ""}>
          {getScheduleAppointmentTitle(appointment.serviceName)}
        </div>
        <div className="tabular-nums text-[10px] text-zinc-500">
          {form.startTime}–{form.endTime}
        </div>
        <AppointmentPromoBadges
          promotions={appointment.appliedPromotions}
          className="mt-0.5"
        />
      </article>
    );
  }

  return (
    <article className="border border-[#e8eaed] p-2 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <EditorField field="startTime" htmlFor={fieldId("startTime")}>
          <input
            id={fieldId("startTime")}
            type="time"
            value={form.startTime}
            onChange={(event) => updateField("startTime", event.target.value)}
            onBlur={handleBlur}
            className="border border-[#dadce0] px-1 py-0.5"
          />
        </EditorField>
        <EditorField field="endTime" htmlFor={fieldId("endTime")}>
          <input
            id={fieldId("endTime")}
            type="time"
            value={form.endTime}
            onChange={(event) => updateField("endTime", event.target.value)}
            onBlur={handleBlur}
            className="border border-[#dadce0] px-1 py-0.5"
          />
        </EditorField>
      </div>

      {shorterThanStandard ? (
        <p className="mt-1 text-[10px] text-amber-800">
          Фактическое время короче стандартной длительности услуги
        </p>
      ) : null}

      <EditorField
        field="service"
        htmlFor={fieldId("service")}
        className="mt-2 flex flex-col gap-0.5"
      >
        <select
          id={fieldId("service")}
          value={form.serviceId}
          onChange={(event) => updateField("serviceId", event.target.value)}
          onBlur={handleBlur}
          className="border border-[#dadce0] px-1 py-0.5"
        >
          <option value="">—</option>
          {serviceOptions.map((service) => (
            <option
              key={service.id}
              value={service.id}
              disabled={service.unavailable && service.id !== form.serviceId}
            >
              {service.publicName}
            </option>
          ))}
        </select>
        <ServiceMeta service={selectedService} />
      </EditorField>

      <EditorField
        field="clientName"
        htmlFor={fieldId("clientName")}
        className="mt-2 flex flex-col gap-0.5"
      >
        <input
          id={fieldId("clientName")}
          value={form.clientName}
          onChange={(event) => updateField("clientName", event.target.value)}
          onBlur={handleBlur}
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </EditorField>

      <EditorField
        field="clientPhone"
        htmlFor={fieldId("clientPhone")}
        className="mt-2 flex flex-col gap-0.5"
      >
        <input
          id={fieldId("clientPhone")}
          value={form.clientPhone}
          onChange={(event) => updateField("clientPhone", event.target.value)}
          onBlur={handleBlur}
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </EditorField>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <EditorField field="status" htmlFor={fieldId("status")}>
          <select
            id={fieldId("status")}
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
        </EditorField>
        <EditorField field="source" htmlFor={fieldId("source")}>
          <select
            id={fieldId("source")}
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
        </EditorField>
      </div>

      <EditorField
        field="comment"
        htmlFor={fieldId("comment")}
        className="mt-2 flex flex-col gap-0.5"
      >
        <textarea
          id={fieldId("comment")}
          value={form.comment}
          onChange={(event) => updateField("comment", event.target.value)}
          onBlur={handleBlur}
          rows={2}
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </EditorField>

      <EditorField
        field="importantNote"
        htmlFor={fieldId("importantNote")}
        className="mt-2 flex flex-col gap-0.5"
      >
        <input
          id={fieldId("importantNote")}
          value={form.importantNote}
          onChange={(event) => updateField("importantNote", event.target.value)}
          onBlur={handleBlur}
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </EditorField>

      <EditorCheckboxField field="isBold" htmlFor={fieldId("isBold")}>
        <input
          id={fieldId("isBold")}
          type="checkbox"
          checked={form.isBold}
          onChange={(event) => updateField("isBold", event.target.checked)}
        />
      </EditorCheckboxField>

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
  onCreated: () => void | Promise<void>;
  onSaveStatus: (status: "idle" | "saving" | "saved" | "error", message?: string) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AppointmentFormState>({
    startTime: options.master.workStart,
    endTime: addMinutesToTime(dateKey, options.master.workStart, 30),
    serviceId: "",
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
    selectedService != null && actualMinutes < selectedService.durationMinutes;

  const fieldId = (name: ScheduleEditorFieldKey) => `new-appointment-${name}`;

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
      if (process.env.NODE_ENV === "development") {
        console.log("[schedule] appointment saved", {
          id: payload.appointment?.id,
          action: "post",
        });
      }
      onSaveStatus("saved");
      await onCreated();
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
        <EditorField field="startTime" htmlFor={fieldId("startTime")}>
          <input
            id={fieldId("startTime")}
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
                    ? addMinutesToTime(dateKey, startTime, service.durationMinutes)
                    : current.endTime,
                };
              });
            }}
            className="border border-[#dadce0] px-1 py-0.5"
          />
        </EditorField>
        <EditorField field="endTime" htmlFor={fieldId("endTime")}>
          <input
            id={fieldId("endTime")}
            type="time"
            value={form.endTime}
            onChange={(event) =>
              setForm((current) => ({ ...current, endTime: event.target.value }))
            }
            className="border border-[#dadce0] px-1 py-0.5"
          />
        </EditorField>
      </div>

      {shorterThanStandard ? (
        <p className="mt-1 text-[10px] text-amber-800">
          Фактическое время короче стандартной длительности услуги
        </p>
      ) : null}

      <EditorField
        field="service"
        htmlFor={fieldId("service")}
        className="mt-2 flex flex-col gap-0.5"
      >
        <select
          id={fieldId("service")}
          value={form.serviceId}
          onChange={(event) => {
            const serviceId = event.target.value;
            const service = options.services.find((item) => item.id === serviceId);
            setForm((current) => ({
              ...current,
              serviceId,
              endTime: service
                ? addMinutesToTime(
                    dateKey,
                    current.startTime,
                    service.durationMinutes,
                  )
                : current.endTime,
            }));
          }}
          className="border border-[#dadce0] px-1 py-0.5"
        >
          <option value="">Выберите услугу</option>
          {options.services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.publicName}
            </option>
          ))}
        </select>
        <ServiceMeta service={selectedService} />
      </EditorField>

      <EditorField
        field="clientName"
        htmlFor={fieldId("clientName")}
        className="mt-2 flex flex-col gap-0.5"
      >
        <input
          id={fieldId("clientName")}
          value={form.clientName}
          onChange={(event) =>
            setForm((current) => ({ ...current, clientName: event.target.value }))
          }
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </EditorField>

      <EditorField
        field="clientPhone"
        htmlFor={fieldId("clientPhone")}
        className="mt-2 flex flex-col gap-0.5"
      >
        <input
          id={fieldId("clientPhone")}
          value={form.clientPhone}
          onChange={(event) =>
            setForm((current) => ({ ...current, clientPhone: event.target.value }))
          }
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </EditorField>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <EditorField field="status" htmlFor={fieldId("status")}>
          <select
            id={fieldId("status")}
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
        </EditorField>
        <EditorField field="source" htmlFor={fieldId("source")}>
          <select
            id={fieldId("source")}
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
        </EditorField>
      </div>

      <EditorField
        field="comment"
        htmlFor={fieldId("comment")}
        className="mt-2 flex flex-col gap-0.5"
      >
        <textarea
          id={fieldId("comment")}
          value={form.comment}
          onChange={(event) =>
            setForm((current) => ({ ...current, comment: event.target.value }))
          }
          rows={2}
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </EditorField>

      <EditorField
        field="importantNote"
        htmlFor={fieldId("importantNote")}
        className="mt-2 flex flex-col gap-0.5"
      >
        <input
          id={fieldId("importantNote")}
          value={form.importantNote}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              importantNote: event.target.value,
            }))
          }
          className="border border-[#dadce0] px-1 py-0.5"
        />
      </EditorField>

      <EditorCheckboxField field="isBold" htmlFor={fieldId("isBold")}>
        <input
          id={fieldId("isBold")}
          type="checkbox"
          checked={form.isBold}
          onChange={(event) =>
            setForm((current) => ({ ...current, isBold: event.target.checked }))
          }
        />
      </EditorCheckboxField>

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
