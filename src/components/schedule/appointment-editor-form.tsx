"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScheduleDayAppointment } from "@/types/schedule";
import { isOperationalScheduleAppointment } from "@/lib/schedule/appointment-contract";
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
import { clientDebugLog } from "@/lib/debug/client-debug";
import type { EditorServiceOption } from "@/services/ScheduleEditorOptionsService";
import { EditorCheckboxField, EditorField } from "@/components/schedule/editor-field";
import { AppointmentRecordSummary } from "@/components/schedule/appointment-detail-summary";
import { AppointmentPromoBadges } from "@/components/schedule/appointment-promo-badges";
import {
  AppointmentMasterNoteBlock,
  AppointmentPromotionLabelBadges,
} from "@/components/schedule/appointment-master-display";
import { isMasterScheduleAppointment } from "@/lib/schedule/appointment-contract";
import { CLIENT_RESCHEDULE_APPOINTMENT_NOTICE } from "@/lib/schedule/client-reschedule-notice";
import {
  ClientSuggestField,
  describeClientLinkUi,
  type ClientSuggestItem,
} from "@/components/schedule/client-suggest-field";
import { isUsableClientPhone } from "@/lib/phone/usable-client-phone";
import type { AppointmentClientLinkResult } from "@/types/appointment-client-link";

export type { EditorOptions };

function clientLinkStatusMessage(
  clientLink: AppointmentClientLinkResult | undefined,
): string | null {
  if (!clientLink) {
    return null;
  }
  switch (clientLink.status) {
    case "created":
      return "Клиент создан и связан с записью";
    case "linked":
    case "already_linked":
      return "Клиент связан с записью";
    case "duplicate":
      return "Найдено несколько клиентов с этим телефоном — выберите вручную";
    case "skipped_technical_phone":
    case "skipped_invalid_phone":
      return "Создание клиента пропущено: телефон непригоден";
    case "error":
      return "Не удалось привязать клиента — можно повторить";
    default:
      return null;
  }
}

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
  const operational = isOperationalScheduleAppointment(appointment);
  return {
    startTime: toScheduleTimeInput(appointment.startsAt, "09:00"),
    endTime: toScheduleTimeInput(appointment.endsAt, "10:00"),
    serviceId: appointment.serviceId ?? "",
    clientName: appointment.clientName,
    clientPhone: operational ? appointment.clientPhone : "",
    status: appointment.statusCode,
    source: appointment.sourceCode,
    comment: operational ? appointment.comment ?? "" : "",
    importantNote: operational ? appointment.importantNote ?? "" : "",
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
  masterName,
  onSaved,
  onCancelled,
  onSaveStatus,
}: {
  appointment: ScheduleDayAppointment;
  dateKey: string;
  masterId: string;
  options: EditorOptions;
  canEdit: boolean;
  masterName?: string | null;
  onSaved: () => void | Promise<void>;
  onCancelled: () => void | Promise<void>;
  onSaveStatus: (status: "idle" | "saving" | "saved" | "error", message?: string) => void;
}) {
  const [form, setForm] = useState<AppointmentFormState>(() =>
    toFormState(appointment),
  );
  const [error, setError] = useState<string | null>(null);
  const [showOverlapConfirm, setShowOverlapConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(() =>
    isOperationalScheduleAppointment(appointment)
      ? appointment.clientId
      : null,
  );
  const [clientLinkDirty, setClientLinkDirty] = useState(false);
  const [linkBanner, setLinkBanner] = useState<string | null>(null);
  const [isLinkActionPending, setIsLinkActionPending] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<
    Array<{ id: string; fullName: string; phone: string | null }>
  >([]);
  const selectedClientIdRef = useRef(selectedClientId);
  const clientLinkDirtyRef = useRef(clientLinkDirty);
  const linkActionGenerationRef = useRef(0);
  const linkActionInFlightRef = useRef(false);
  // Debounced save читает актуальный clientId до commit effect.
  // eslint-disable-next-line react-hooks/refs -- intentional sync for async save
  selectedClientIdRef.current = selectedClientId;
  // eslint-disable-next-line react-hooks/refs -- intentional sync for async save
  clientLinkDirtyRef.current = clientLinkDirty;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCancellingRef = useRef(false);
  const cancelledRef = useRef(false);
  const saveAbortRef = useRef<AbortController | null>(null);
  const showOverlapConfirmRef = useRef(false);
  const formRef = useRef(form);
  // Debounced/blur save читает актуальные значения до commit effect.
  // eslint-disable-next-line react-hooks/refs -- intentional sync for async save
  formRef.current = form;
  // eslint-disable-next-line react-hooks/refs -- intentional sync for async save
  showOverlapConfirmRef.current = showOverlapConfirm;

  const clearPendingSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    saveAbortRef.current?.abort();
    saveAbortRef.current = null;
  }, []);

  const serviceOptions = useMemo(
    () => buildServiceOptions(options.services, appointment, dateKey),
    [appointment, dateKey, options.services],
  );

  const fieldId = (name: ScheduleEditorFieldKey) =>
    `appointment-${appointment.id}-${name}`;

  useEffect(() => {
    // Синхронизация локальной формы после refresh с сервера (onSaved).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled editor reset from refreshed appointment prop
    setForm(toFormState(appointment));
    setShowOverlapConfirm(false);
    setSelectedClientId(
      isOperationalScheduleAppointment(appointment)
        ? appointment.clientId
        : null,
    );
    setClientLinkDirty(false);
    setDuplicateCandidates([]);
  }, [appointment]);

  useEffect(() => {
    return () => {
      clearPendingSave();
    };
  }, [clearPendingSave]);

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
    actualMinutes <
      (selectedService.totalBusyMinutes ??
        selectedService.durationMinutes + (selectedService.breakAfterMinutes ?? 0));

  const save = useCallback(
    async (allowAppointmentOverlap = false) => {
      if (
        !canEdit ||
        isCancellingRef.current ||
        cancelledRef.current ||
        linkActionInFlightRef.current
      ) {
        return;
      }

      // Пока открыт confirm по overlap — только повторный submit с флагом.
      if (showOverlapConfirmRef.current && !allowAppointmentOverlap) {
        return;
      }

      const generationAtStart = linkActionGenerationRef.current;
      clearPendingSave();
      const abortController = new AbortController();
      saveAbortRef.current = abortController;

      onSaveStatus("saving");
      setError(null);

      try {
        const payloadBody: Record<string, unknown> = {
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
        };
        if (allowAppointmentOverlap) {
          payloadBody.allowAppointmentOverlap = true;
        }
        if (clientLinkDirtyRef.current) {
          payloadBody.clientId = selectedClientIdRef.current;
        }

        const response = await fetch(`/api/appointments/${appointment.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: abortController.signal,
          body: JSON.stringify(payloadBody),
        });

        if (
          abortController.signal.aborted ||
          isCancellingRef.current ||
          cancelledRef.current ||
          generationAtStart !== linkActionGenerationRef.current ||
          linkActionInFlightRef.current
        ) {
          return;
        }

        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          code?: string;
          conflictType?: string;
          clientLink?: AppointmentClientLinkResult;
        };

        if (!response.ok) {
          if (
            response.status === 409 &&
            payload.code === "APPOINTMENT_OVERLAP" &&
            !allowAppointmentOverlap
          ) {
            setShowOverlapConfirm(true);
            onSaveStatus("idle");
            return;
          }

          setShowOverlapConfirm(false);
          throw new Error(payload.error ?? "Ошибка сохранения");
        }

        if (
          isCancellingRef.current ||
          cancelledRef.current ||
          generationAtStart !== linkActionGenerationRef.current
        ) {
          return;
        }

        setShowOverlapConfirm(false);
        setClientLinkDirty(false);
        const linkMessage = clientLinkStatusMessage(payload.clientLink);
        setLinkBanner(linkMessage);
        if (payload.clientLink?.status === "duplicate") {
          setDuplicateCandidates(payload.clientLink.candidates);
        } else {
          setDuplicateCandidates([]);
        }
        onSaveStatus("saved", linkMessage ?? undefined);
        clientDebugLog("schedule.appointment.saved", { action: "patch" });
        await onSaved();
      } catch (saveError) {
        if (
          abortController.signal.aborted ||
          isCancellingRef.current ||
          cancelledRef.current ||
          generationAtStart !== linkActionGenerationRef.current ||
          (saveError instanceof DOMException && saveError.name === "AbortError") ||
          (saveError instanceof Error && saveError.name === "AbortError")
        ) {
          return;
        }
        const message =
          saveError instanceof Error ? saveError.message : "Ошибка сохранения";
        setError(message);
        onSaveStatus("error", message);
      } finally {
        if (saveAbortRef.current === abortController) {
          saveAbortRef.current = null;
        }
      }
    },
    [
      appointment.id,
      canEdit,
      clearPendingSave,
      dateKey,
      masterId,
      onSaved,
      onSaveStatus,
    ],
  );

  const scheduleSave = useCallback(() => {
    if (
      !canEdit ||
      isCancellingRef.current ||
      cancelledRef.current ||
      showOverlapConfirmRef.current ||
      linkActionInFlightRef.current
    ) {
      return;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (
        isCancellingRef.current ||
        cancelledRef.current ||
        showOverlapConfirmRef.current ||
        linkActionInFlightRef.current
      ) {
        return;
      }
      void save(false);
    }, 500);
  }, [canEdit, save]);

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
        service.totalBusyMinutes ??
          service.durationMinutes + (service.breakAfterMinutes ?? 0),
      ),
    };
  };

  const updateField = <K extends keyof AppointmentFormState>(
    key: K,
    value: AppointmentFormState[K],
  ) => {
    if (isCancellingRef.current || cancelledRef.current) {
      return;
    }

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
    if (
      isCancellingRef.current ||
      cancelledRef.current ||
      showOverlapConfirmRef.current ||
      linkActionInFlightRef.current
    ) {
      return;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    void save(false);
  };

  const dismissOverlapConfirm = () => {
    setShowOverlapConfirm(false);
    onSaveStatus("idle");
  };

  const handleConfirmOverlapSave = () => {
    void save(true);
  };

  const persistClientLinkAction = useCallback(
    async (action: {
      clientId: string | null;
      clientName?: string;
      clientPhone?: string | null;
    }) => {
      if (
        !canEdit ||
        isCancellingRef.current ||
        cancelledRef.current ||
        linkActionInFlightRef.current
      ) {
        return;
      }

      // Явный link PATCH: не ждём blur/debounce и abort'им stale autosave.
      // Source of truth (selectedClientId/form/banner) меняем только после response.ok.
      clearPendingSave();
      linkActionGenerationRef.current += 1;
      const generation = linkActionGenerationRef.current;
      linkActionInFlightRef.current = true;
      setIsLinkActionPending(true);

      const nextName = action.clientName;
      const nextPhone = action.clientPhone;

      const abortController = new AbortController();
      saveAbortRef.current = abortController;
      onSaveStatus("saving");
      setError(null);

      try {
        const payloadBody: Record<string, unknown> = {
          clientId: action.clientId,
        };
        if (nextName !== undefined) {
          payloadBody.clientName = nextName;
        }
        if (nextPhone !== undefined && nextPhone != null) {
          payloadBody.clientPhone = nextPhone;
        }

        const response = await fetch(`/api/appointments/${appointment.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: abortController.signal,
          body: JSON.stringify(payloadBody),
        });

        if (
          abortController.signal.aborted ||
          generation !== linkActionGenerationRef.current ||
          isCancellingRef.current ||
          cancelledRef.current
        ) {
          return;
        }

        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          clientLink?: AppointmentClientLinkResult;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Ошибка сохранения связи");
        }

        setSelectedClientId(action.clientId);
        selectedClientIdRef.current = action.clientId;
        setClientLinkDirty(false);
        clientLinkDirtyRef.current = false;
        if (nextName !== undefined || nextPhone !== undefined) {
          setForm((current) => ({
            ...current,
            ...(nextName !== undefined ? { clientName: nextName } : {}),
            ...(nextPhone !== undefined && nextPhone != null
              ? { clientPhone: nextPhone }
              : {}),
          }));
        }

        const linkMessage =
          action.clientId === null
            ? "Клиент не связан"
            : (clientLinkStatusMessage(payload.clientLink) ??
              "Клиент связан с записью");
        setLinkBanner(linkMessage);
        if (payload.clientLink?.status === "duplicate") {
          setDuplicateCandidates(payload.clientLink.candidates);
        } else {
          setDuplicateCandidates([]);
        }
        onSaveStatus("saved", linkMessage);
        clientDebugLog("schedule.appointment.saved", {
          action: "persistClientLinkAction",
        });

        try {
          await onSaved();
        } catch {
          // PATCH уже успешен — ошибка refresh не маскируется как ошибка связи.
          setError("Связь сохранена, но не удалось обновить список");
          onSaveStatus("saved", "Связь сохранена, список не обновлён");
        }
      } catch (linkError) {
        if (
          abortController.signal.aborted ||
          generation !== linkActionGenerationRef.current ||
          (linkError instanceof DOMException && linkError.name === "AbortError") ||
          (linkError instanceof Error && linkError.name === "AbortError")
        ) {
          return;
        }
        // При ошибке PATCH исходные selectedClientId/form/banner не менялись.
        const message =
          linkError instanceof Error
            ? linkError.message
            : "Ошибка сохранения связи";
        setError(message);
        onSaveStatus("error", message);
      } finally {
        if (generation === linkActionGenerationRef.current) {
          linkActionInFlightRef.current = false;
          setIsLinkActionPending(false);
        }
        if (saveAbortRef.current === abortController) {
          saveAbortRef.current = null;
        }
      }
    },
    [appointment.id, canEdit, clearPendingSave, onSaved, onSaveStatus],
  );

  const applyPickedClient = (client: ClientSuggestItem) => {
    void persistClientLinkAction({
      clientId: client.id,
      clientName: client.fullName,
      clientPhone: client.phone,
    });
  };

  const clearClientLink = () => {
    void persistClientLinkAction({ clientId: null });
  };

  const handleRetryClientLink = async () => {
    if (!canEdit || linkActionInFlightRef.current) {
      return;
    }
    clearPendingSave();
    linkActionGenerationRef.current += 1;
    linkActionInFlightRef.current = true;
    setIsLinkActionPending(true);
    onSaveStatus("saving");
    setError(null);
    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryClientLink: true }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        clientLink?: AppointmentClientLinkResult;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Ошибка привязки");
      }
      const linkMessage = clientLinkStatusMessage(payload.clientLink);
      setLinkBanner(linkMessage);
      if (payload.clientLink?.status === "duplicate") {
        setDuplicateCandidates(payload.clientLink.candidates);
      } else {
        setDuplicateCandidates([]);
      }
      if (
        payload.clientLink?.status === "created" ||
        payload.clientLink?.status === "linked" ||
        payload.clientLink?.status === "already_linked"
      ) {
        setSelectedClientId(payload.clientLink.clientId);
      }
      onSaveStatus("saved", linkMessage ?? undefined);
      await onSaved();
    } catch (retryError) {
      const message =
        retryError instanceof Error ? retryError.message : "Ошибка привязки";
      setError(message);
      onSaveStatus("error", message);
    } finally {
      linkActionInFlightRef.current = false;
      setIsLinkActionPending(false);
    }
  };

  // selectedClientId — source of truth после init; не подставлять props.clientId после null.
  const clientLinkLabel = describeClientLinkUi({
    statusCode: form.status,
    clientId: selectedClientId,
    clientPhone: form.clientPhone,
    isUsablePhone: isUsableClientPhone(form.clientPhone),
  });

  const handleCancel = async () => {
    if (
      !canEdit ||
      isCancellingRef.current ||
      cancelledRef.current ||
      !confirm("Отменить запись?")
    ) {
      return;
    }

    isCancellingRef.current = true;
    setIsCancelling(true);
    clearPendingSave();
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
      cancelledRef.current = true;
      onSaveStatus("saved");
      await onCancelled();
    } catch (cancelError) {
      isCancellingRef.current = false;
      setIsCancelling(false);
      const message =
        cancelError instanceof Error ? cancelError.message : "Ошибка отмены";
      setError(message);
      onSaveStatus("error", message);
    }
  };

  if (!canEdit) {
    return (
      <article className="border border-[#e8eaed] px-2 py-2 text-xs">
        <AppointmentRecordSummary
          appointment={appointment}
          masterName={masterName}
          dateKey={dateKey}
        />
        {appointment.statusCode === "RESCHEDULED" ? (
          <div className="mt-2 rounded bg-amber-50 px-1.5 py-1 text-[10px] font-semibold leading-snug text-amber-900">
            {CLIENT_RESCHEDULE_APPOINTMENT_NOTICE}
          </div>
        ) : null}
        <div className="mt-2 tabular-nums text-[10px] text-zinc-500">
          {form.startTime}–{form.endTime}
        </div>
        <AppointmentPromoBadges
          promotions={
            isOperationalScheduleAppointment(appointment)
              ? appointment.appliedPromotions
              : []
          }
          className="mt-1"
        />
        {isOperationalScheduleAppointment(appointment) && appointment.importantNote ? (
          <div className="mt-1">
            <AppointmentMasterNoteBlock note={appointment.importantNote} />
          </div>
        ) : null}
        {isMasterScheduleAppointment(appointment) ? (
          <>
            <AppointmentPromotionLabelBadges
              labels={appointment.promotionLabels}
              className="mt-1"
            />
            {appointment.masterNote ? (
              <div className="mt-1">
                <AppointmentMasterNoteBlock note={appointment.masterNote} />
              </div>
            ) : null}
          </>
        ) : null}
      </article>
    );
  }

  return (
    <article className="border border-[#e8eaed] p-2 text-xs">
      <div className="mb-2 rounded border border-[#eceff1] bg-[#f8f9fa] px-2 py-1.5">
        <AppointmentRecordSummary
          appointment={appointment}
          masterName={masterName}
          dateKey={dateKey}
        />
        {appointment.statusCode === "RESCHEDULED" ? (
          <div className="mt-1.5 rounded bg-amber-50 px-1.5 py-1 text-[10px] font-semibold leading-snug text-amber-900">
            {CLIENT_RESCHEDULE_APPOINTMENT_NOTICE}
          </div>
        ) : null}
      </div>
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
        <ClientSuggestField
          mode="name"
          inputId={fieldId("clientName")}
          value={form.clientName}
          disabled={!canEdit || isLinkActionPending}
          onValueChange={(value) => {
            setForm((current) => ({ ...current, clientName: value }));
            if (selectedClientId) {
              setSelectedClientId(null);
              setClientLinkDirty(true);
              setLinkBanner("Клиент не связан");
            }
            scheduleSave();
          }}
          onBlur={handleBlur}
          onPick={applyPickedClient}
        />
      </EditorField>

      <EditorField
        field="clientPhone"
        htmlFor={fieldId("clientPhone")}
        className="mt-2 flex flex-col gap-0.5"
      >
        <ClientSuggestField
          mode="phone"
          inputId={fieldId("clientPhone")}
          value={form.clientPhone}
          disabled={!canEdit || isLinkActionPending}
          onValueChange={(value) => {
            setForm((current) => ({ ...current, clientPhone: value }));
            if (selectedClientId) {
              setSelectedClientId(null);
              setClientLinkDirty(true);
              setLinkBanner("Клиент не связан");
            }
            scheduleSave();
          }}
          onBlur={handleBlur}
          onPick={applyPickedClient}
        />
      </EditorField>

      {canEdit ? (
        <div className="mt-2 rounded border border-[#e8eaed] bg-[#f8f9fa] px-2 py-1.5 text-[10px] text-zinc-700">
          <p className="font-medium">
            {isLinkActionPending
              ? "Сохраняем связь…"
              : (linkBanner ?? clientLinkLabel)}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {selectedClientId ? (
              <button
                type="button"
                className="underline disabled:opacity-50"
                disabled={isLinkActionPending}
                onClick={clearClientLink}
              >
                Снять связь
              </button>
            ) : null}
            {form.status === "COMPLETED" && !selectedClientId ? (
              <button
                type="button"
                className="underline disabled:opacity-50"
                disabled={isLinkActionPending}
                onClick={() => void handleRetryClientLink()}
              >
                Повторить привязку
              </button>
            ) : null}
          </div>
          {duplicateCandidates.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {duplicateCandidates.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    className="text-left underline disabled:opacity-50"
                    disabled={isLinkActionPending}
                    onClick={() =>
                      applyPickedClient({
                        id: candidate.id,
                        fullName: candidate.fullName,
                        phone: candidate.phone,
                        status: "ACTIVE",
                      })
                    }
                  >
                    {candidate.fullName}
                    {candidate.phone ? ` · ${candidate.phone}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

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

      {isOperationalScheduleAppointment(appointment) &&
      appointment.appliedPromotions.length > 0 ? (
        <div className="mt-2 rounded border border-emerald-100 bg-emerald-50/40 px-2 py-1.5">
          <p className="text-[10px] font-medium text-emerald-900">
            Системные акции и подарки
          </p>
          <AppointmentPromoBadges
            promotions={appointment.appliedPromotions}
            className="mt-1"
          />
        </div>
      ) : null}

      <EditorField
        field="comment"
        htmlFor={fieldId("comment")}
        className="mt-2 flex flex-col gap-0.5"
      >
        <p className="text-[10px] text-zinc-500">
          Видят только менеджер и владелец. Не используйте для операционных указаний мастеру.
        </p>
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
        <p className="text-[10px] text-zinc-500">
          Эту информацию увидит мастер. Не указывайте телефон, email и другие лишние
          персональные данные.
        </p>
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

      {showOverlapConfirm ? (
        <div
          className="mt-2 border border-amber-300 bg-amber-50 p-2"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`appointment-${appointment.id}-overlap-confirm-title`}
          aria-describedby={`appointment-${appointment.id}-overlap-confirm-desc`}
        >
          <p
            id={`appointment-${appointment.id}-overlap-confirm-title`}
            className="font-medium text-amber-950"
          >
            Предупреждение
          </p>
          <p
            id={`appointment-${appointment.id}-overlap-confirm-desc`}
            className="mt-1 text-[10px] text-amber-900"
          >
            На это время у мастера уже есть запись
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={dismissOverlapConfirm}
              className="border border-[#dadce0] bg-white px-2 py-1 text-[10px]"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleConfirmOverlapSave}
              className="bg-[#1a73e8] px-2 py-1 text-[10px] text-white"
            >
              Сохранить всё равно
            </button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void handleCancel()}
        disabled={isCancelling || showOverlapConfirm}
        className="mt-2 text-[10px] text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isCancelling ? "Отмена…" : "Отменить запись"}
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
  onOverlapConfirmChange,
}: {
  dateKey: string;
  masterId: string;
  options: EditorOptions;
  onCreated: () => void | Promise<void>;
  onSaveStatus: (status: "idle" | "saving" | "saved" | "error", message?: string) => void;
  onCancel: () => void;
  onOverlapConfirmChange?: (open: boolean) => void;
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
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOverlapConfirm, setShowOverlapConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const overlapCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const overlapConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const overlapDialogRef = useRef<HTMLDivElement | null>(null);

  // eslint-disable-next-line react-hooks/refs -- submitCreate guards against double submit
  isSubmittingRef.current = isSubmitting;

  useEffect(() => {
    onOverlapConfirmChange?.(showOverlapConfirm);
    return () => {
      onOverlapConfirmChange?.(false);
    };
  }, [onOverlapConfirmChange, showOverlapConfirm]);

  const selectedService = options.services.find(
    (service) => service.id === form.serviceId,
  );

  const actualMinutes = diffMinutes(
    parseStudioDateTime(dateKey, form.startTime),
    parseStudioDateTime(dateKey, form.endTime),
  );

  const shorterThanStandard =
    selectedService != null &&
    actualMinutes <
      (selectedService.totalBusyMinutes ??
        selectedService.durationMinutes + (selectedService.breakAfterMinutes ?? 0));

  const fieldId = (name: ScheduleEditorFieldKey) => `new-appointment-${name}`;

  const restoreFocusToSubmit = useCallback(() => {
    queueMicrotask(() => {
      submitButtonRef.current?.focus();
    });
  }, []);

  const dismissOverlapConfirm = useCallback(() => {
    if (isSubmittingRef.current) {
      return;
    }
    setShowOverlapConfirm(false);
    restoreFocusToSubmit();
  }, [restoreFocusToSubmit]);

  useEffect(() => {
    if (!showOverlapConfirm) {
      return;
    }

    overlapCancelButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Не прерываем уже идущий повторный submit — иначе возможны гонки UI.
        if (isSubmittingRef.current) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        dismissOverlapConfirm();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const cancelBtn = overlapCancelButtonRef.current;
      const confirmBtn = overlapConfirmButtonRef.current;
      const dialog = overlapDialogRef.current;
      if (!cancelBtn || !confirmBtn || !dialog) {
        return;
      }

      const focusables = [cancelBtn, confirmBtn].filter(
        (button) => !button.disabled,
      );
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }

      const active = document.activeElement;
      const activeInsideDialog = active instanceof Node && dialog.contains(active);

      if (focusables.length === 1) {
        event.preventDefault();
        focusables[0].focus();
        return;
      }

      if (!activeInsideDialog) {
        event.preventDefault();
        (event.shiftKey ? confirmBtn : cancelBtn).focus();
        return;
      }

      if (event.shiftKey) {
        if (active === cancelBtn) {
          event.preventDefault();
          confirmBtn.focus();
        }
      } else if (active === confirmBtn) {
        event.preventDefault();
        cancelBtn.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [dismissOverlapConfirm, showOverlapConfirm]);

  const submitCreate = async (allowAppointmentOverlap: boolean) => {
    if (isSubmittingRef.current) {
      return;
    }

    setIsSubmitting(true);
    isSubmittingRef.current = true;
    onSaveStatus("saving");
    setError(null);

    try {
      const payloadBody: Record<string, unknown> = {
        masterId,
        dateKey,
        ...form,
        serviceId: form.serviceId || null,
        comment: form.comment || null,
        importantNote: form.importantNote || null,
      };
      if (selectedClientId) {
        payloadBody.clientId = selectedClientId;
      }
      if (allowAppointmentOverlap) {
        payloadBody.allowAppointmentOverlap = true;
      }

      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadBody),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        conflictType?: string;
        clientLink?: AppointmentClientLinkResult;
      };

      if (!response.ok) {
        if (
          response.status === 409 &&
          payload.code === "APPOINTMENT_OVERLAP" &&
          !allowAppointmentOverlap
        ) {
          setShowOverlapConfirm(true);
          onSaveStatus("idle");
          return;
        }

        setShowOverlapConfirm(false);
        throw new Error(payload.error ?? "Ошибка создания");
      }

      setShowOverlapConfirm(false);
      clientDebugLog("schedule.appointment.saved", { action: "post" });
      onSaveStatus("saved", clientLinkStatusMessage(payload.clientLink) ?? undefined);
      await onCreated();
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : "Ошибка создания";
      setError(message);
      onSaveStatus("error", message);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleCreate = () => {
    void submitCreate(false);
  };

  const handleConfirmOverlapCreate = () => {
    void submitCreate(true);
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
                    ? addMinutesToTime(
                        dateKey,
                        startTime,
                        service.totalBusyMinutes ??
                          service.durationMinutes + (service.breakAfterMinutes ?? 0),
                      )
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
                    service.totalBusyMinutes ??
                      service.durationMinutes + (service.breakAfterMinutes ?? 0),
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
        <ClientSuggestField
          mode="name"
          inputId={fieldId("clientName")}
          value={form.clientName}
          onValueChange={(value) => {
            setForm((current) => ({ ...current, clientName: value }));
            setSelectedClientId(null);
          }}
          onPick={(client) => {
            setForm((current) => ({
              ...current,
              clientName: client.fullName,
              clientPhone: client.phone ?? current.clientPhone,
            }));
            setSelectedClientId(client.id);
          }}
        />
      </EditorField>

      <EditorField
        field="clientPhone"
        htmlFor={fieldId("clientPhone")}
        className="mt-2 flex flex-col gap-0.5"
      >
        <ClientSuggestField
          mode="phone"
          inputId={fieldId("clientPhone")}
          value={form.clientPhone}
          onValueChange={(value) => {
            setForm((current) => ({ ...current, clientPhone: value }));
            setSelectedClientId(null);
          }}
          onPick={(client) => {
            setForm((current) => ({
              ...current,
              clientName: client.fullName,
              clientPhone: client.phone ?? current.clientPhone,
            }));
            setSelectedClientId(client.id);
          }}
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
        <p className="text-[10px] text-zinc-500">
          Видят только менеджер и владелец. Не используйте для операционных указаний мастеру.
        </p>
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
        <p className="text-[10px] text-zinc-500">
          Эту информацию увидит мастер. Не указывайте телефон, email и другие лишние
          персональные данные.
        </p>
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

      {showOverlapConfirm ? (
        <div
          ref={overlapDialogRef}
          className="mt-2 border border-amber-300 bg-amber-50 p-2"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="new-appointment-overlap-confirm-title"
          aria-describedby="new-appointment-overlap-confirm-desc"
        >
          <p
            id="new-appointment-overlap-confirm-title"
            className="font-medium text-amber-950"
          >
            Предупреждение
          </p>
          <p
            id="new-appointment-overlap-confirm-desc"
            className="mt-1 text-[10px] text-amber-900"
          >
            На это время у мастера уже есть запись
          </p>
          <div className="mt-2 flex gap-2">
            <button
              ref={overlapCancelButtonRef}
              type="button"
              onClick={dismissOverlapConfirm}
              disabled={isSubmitting}
              className="border border-[#dadce0] bg-white px-2 py-1 text-[10px] disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              ref={overlapConfirmButtonRef}
              type="button"
              onClick={handleConfirmOverlapCreate}
              disabled={isSubmitting}
              className="bg-[#1a73e8] px-2 py-1 text-[10px] text-white disabled:opacity-50"
            >
              {isSubmitting ? "Создание…" : "Создать всё равно"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex gap-2">
        <button
          ref={submitButtonRef}
          type="button"
          onClick={handleCreate}
          disabled={isSubmitting || showOverlapConfirm}
          tabIndex={showOverlapConfirm ? -1 : undefined}
          className="bg-[#1a73e8] px-2 py-1 text-[10px] text-white disabled:opacity-50"
        >
          {isSubmitting ? "Создание…" : "Добавить"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting || showOverlapConfirm}
          tabIndex={showOverlapConfirm ? -1 : undefined}
          className="border border-[#dadce0] px-2 py-1 text-[10px] disabled:opacity-50"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
