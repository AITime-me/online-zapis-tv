"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatDateKeyLabel,
  formatStudioTimeRange,
} from "@/lib/datetime/date-key";
import type { CellSyncPayload } from "@/lib/schedule/month-data-patch";
import type { QuickDayEditorData } from "@/types/schedule-month";
import {
  AppointmentEditorForm,
  NewAppointmentForm,
  type EditorOptions,
} from "@/components/schedule/appointment-editor-form";
import {
  FullDayBlockForm,
  NewIntervalBlockForm,
  ScheduleBlockEditorForm,
} from "@/components/schedule/schedule-block-editor-form";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type ClosureFormMode = "none" | "interval" | "fullDay";

export function QuickDayEditor({
  data: initialData,
  canEdit,
  onClose,
  onCellSynced,
  onScheduleChange,
}: {
  data: QuickDayEditorData;
  canEdit: boolean;
  onClose: () => void;
  onCellSynced?: (payload: CellSyncPayload) => void;
  onScheduleChange?: () => void | Promise<void>;
}) {
  const [data, setData] = useState(initialData);
  const [options, setOptions] = useState<EditorOptions | null>(null);
  const [showNewAppointment, setShowNewAppointment] = useState(false);
  const [showNewExtraWork, setShowNewExtraWork] = useState(false);
  const [closureFormMode, setClosureFormMode] = useState<ClosureFormMode>("none");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [extraForm, setExtraForm] = useState({
    startTime: "08:00",
    endTime: "10:00",
    isOnlineBookingEnabled: false,
  });
  const [extraError, setExtraError] = useState<string | null>(null);

  const closeOtherForms = () => {
    setShowNewAppointment(false);
    setShowNewExtraWork(false);
    setClosureFormMode("none");
  };

  const openIntervalForm = () => {
    setShowNewAppointment(false);
    setShowNewExtraWork(false);
    setClosureFormMode("interval");
  };

  const openFullDayForm = () => {
    setShowNewAppointment(false);
    setShowNewExtraWork(false);
    setClosureFormMode("fullDay");
  };

  const fullDayBlocks = data.scheduleBlocks.filter((block) => block.isFullDay);
  const intervalBlocks = data.scheduleBlocks.filter((block) => !block.isFullDay);

  const refreshCell = useCallback(async () => {
    const response = await fetch(
      `/api/schedule/cell?masterId=${data.masterId}&date=${data.dateKey}`,
      { cache: "no-store" },
    );
    const payload = await response.json();
    if (response.ok && payload.ok) {
      const cellData = {
        dateKey: payload.dateKey,
        masterId: payload.masterId,
        masterInternalName: payload.masterInternalName,
        masterPublicName: payload.masterPublicName,
        appointments: payload.appointments,
        scheduleBlocks: payload.scheduleBlocks,
        extraWorkWindows: payload.extraWorkWindows,
      };
      setData(cellData);

      if (process.env.NODE_ENV === "development") {
        console.log("[schedule] refreshCell:onCellSynced", {
          dateKey: cellData.dateKey,
          masterId: cellData.masterId,
          appointments: cellData.appointments.length,
        });
      }

      onCellSynced?.({
        dateKey: cellData.dateKey,
        masterId: cellData.masterId,
        appointments: cellData.appointments,
        scheduleBlocks: cellData.scheduleBlocks,
        extraWorkWindows: cellData.extraWorkWindows,
      });
    }

    if (process.env.NODE_ENV === "development") {
      console.log("[schedule] refreshCell:before onScheduleChange", {
        dateKey: data.dateKey,
        masterId: data.masterId,
        appointments: payload.appointments?.length,
      });
    }

    await onScheduleChange?.();

    if (process.env.NODE_ENV === "development") {
      console.log("[schedule] refreshCell:after onScheduleChange");
    }
  }, [data.dateKey, data.masterId, onCellSynced, onScheduleChange]);

  useEffect(() => {
    if (!canEdit) {
      return;
    }

    void (async () => {
      const response = await fetch(
        `/api/schedule/editor-options?masterId=${data.masterId}&dateKey=${data.dateKey}`,
      );
      const payload = await response.json();
      if (response.ok && payload.ok) {
        setOptions({
          master: payload.master,
          services: payload.services,
          statuses: payload.statuses,
          sources: payload.sources,
        });
      }
    })();
  }, [canEdit, data.dateKey, data.masterId]);

  const handleSaveStatus = (
    status: SaveStatus,
    message?: string,
  ) => {
    setSaveStatus(status);
    setSaveMessage(message ?? null);
    if (status === "saved") {
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  };

  const handleCreateExtraWork = async () => {
    setExtraError(null);
    handleSaveStatus("saving");

    try {
      const response = await fetch("/api/extra-work-windows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masterId: data.masterId,
          dateKey: data.dateKey,
          startTime: extraForm.startTime,
          endTime: extraForm.endTime,
          isOnlineBookingEnabled: extraForm.isOnlineBookingEnabled,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Ошибка сохранения");
      }
      setShowNewExtraWork(false);
      handleSaveStatus("saved");
      await refreshCell();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Ошибка сохранения";
      setExtraError(message);
      handleSaveStatus("error", message);
    }
  };

  const handleDeleteExtraWork = async (id: string) => {
    if (!confirm("Удалить дополнительное рабочее время?")) {
      return;
    }

    handleSaveStatus("saving");
    try {
      const response = await fetch(`/api/extra-work-windows/${id}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Ошибка удаления");
      }
      handleSaveStatus("saved");
      await refreshCell();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Ошибка удаления";
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
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-16"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto border border-[#dadce0] bg-white shadow-lg"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-labelledby="quick-day-editor-title"
      >
        <div className="flex items-start justify-between border-b border-[#dadce0] bg-[#f8f9fa] px-3 py-2">
          <div>
            <h2
              id="quick-day-editor-title"
              className="text-sm font-semibold text-zinc-900"
            >
              Быстрый редактор дня
            </h2>
            <p className="text-xs text-zinc-600">
              {formatDateKeyLabel(data.dateKey)} · {data.masterInternalName}
              <span className="text-zinc-400"> ({data.masterPublicName})</span>
            </p>
            {statusLabel ? (
              <p
                className={`mt-0.5 text-[10px] ${
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
          <button
            type="button"
            onClick={onClose}
            className="ml-2 px-1 text-lg leading-none text-zinc-500 hover:text-zinc-900"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="p-3">
          {canEdit ? (
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  closeOtherForms();
                  setShowNewAppointment(true);
                }}
                className="border border-[#dadce0] bg-white px-2 py-1 text-[10px] hover:bg-[#f1f3f4]"
              >
                + Запись
              </button>
              <button
                type="button"
                onClick={() => {
                  closeOtherForms();
                  setShowNewExtraWork(true);
                }}
                className="border border-[#dadce0] bg-white px-2 py-1 text-[10px] hover:bg-[#f1f3f4]"
              >
                + Доп. время
              </button>
            </div>
          ) : null}

          {showNewAppointment && options ? (
            <div className="mb-3">
              <NewAppointmentForm
                dateKey={data.dateKey}
                masterId={data.masterId}
                options={options}
                onCreated={async () => {
                  setShowNewAppointment(false);
                  await refreshCell();
                }}
                onSaveStatus={handleSaveStatus}
                onCancel={() => setShowNewAppointment(false)}
              />
            </div>
          ) : null}

          {showNewExtraWork && canEdit ? (
            <div className="mb-3 border border-[#dadce0] bg-[#f8f9fa] p-2 text-xs">
              <p className="mb-2 font-medium">Новое доп. время</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-zinc-500">Начало</span>
                  <input
                    type="time"
                    value={extraForm.startTime}
                    onChange={(event) =>
                      setExtraForm((current) => ({
                        ...current,
                        startTime: event.target.value,
                      }))
                    }
                    className="border border-[#dadce0] px-1 py-0.5"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-zinc-500">Окончание</span>
                  <input
                    type="time"
                    value={extraForm.endTime}
                    onChange={(event) =>
                      setExtraForm((current) => ({
                        ...current,
                        endTime: event.target.value,
                      }))
                    }
                    className="border border-[#dadce0] px-1 py-0.5"
                  />
                </label>
              </div>
              <label className="mt-2 flex items-center gap-2 text-[10px]">
                <input
                  type="checkbox"
                  checked={extraForm.isOnlineBookingEnabled}
                  onChange={(event) =>
                    setExtraForm((current) => ({
                      ...current,
                      isOnlineBookingEnabled: event.target.checked,
                    }))
                  }
                />
                Доступно онлайн
              </label>
              {extraError ? (
                <p className="mt-2 text-[10px] text-red-600">{extraError}</p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleCreateExtraWork()}
                  className="bg-[#1a73e8] px-2 py-1 text-[10px] text-white"
                >
                  Добавить
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewExtraWork(false)}
                  className="border border-[#dadce0] px-2 py-1 text-[10px]"
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            {data.extraWorkWindows.length > 0 ? (
              <section>
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#1a73e8]">
                  Доп. рабочее время
                </h3>
                <div className="flex flex-col gap-1">
                  {data.extraWorkWindows.map((window) => (
                    <div
                      key={window.id}
                      className="flex items-center justify-between bg-[#e8f0fe] px-2 py-1 text-xs text-[#1a73e8]"
                    >
                      <span>
                        + {formatStudioTimeRange(window.startsAt, window.endsAt)}
                        {window.isOnlineBookingEnabled ? " · онлайн" : ""}
                      </span>
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => void handleDeleteExtraWork(window.id)}
                          className="text-[10px] text-red-600 hover:underline"
                        >
                          Удалить
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Записи
              </h3>
              {data.appointments.length === 0 ? (
                <p className="text-[10px] text-zinc-400">Нет записей</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.appointments.map((appointment) =>
                    options ? (
                      <AppointmentEditorForm
                        key={appointment.id}
                        appointment={appointment}
                        dateKey={data.dateKey}
                        masterId={data.masterId}
                        options={options}
                        canEdit={canEdit}
                        onSaved={async () => {
                          await refreshCell();
                        }}
                        onCancelled={async () => {
                          await refreshCell();
                        }}
                        onSaveStatus={handleSaveStatus}
                      />
                    ) : (
                      <article
                        key={appointment.id}
                        className="border border-[#e8eaed] px-2 py-1 text-xs"
                      >
                        {formatStudioTimeRange(
                          appointment.startsAt,
                          appointment.endsAt,
                        )}{" "}
                        {appointment.clientName}
                      </article>
                    ),
                  )}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Закрытия
              </h3>

              {canEdit ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={openIntervalForm}
                    className={`border px-2 py-0.5 text-[10px] ${
                      closureFormMode === "interval"
                        ? "border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]"
                        : "border-[#dadce0] bg-white hover:bg-[#f1f3f4]"
                    }`}
                  >
                    + Интервал
                  </button>
                  <button
                    type="button"
                    onClick={openFullDayForm}
                    className={`border px-2 py-0.5 text-[10px] ${
                      closureFormMode === "fullDay"
                        ? "border-zinc-600 bg-[#eceff1] text-zinc-800"
                        : "border-[#dadce0] bg-white hover:bg-[#f1f3f4]"
                    }`}
                  >
                    Закрыть день полностью
                  </button>
                </div>
              ) : null}

              {closureFormMode === "interval" && canEdit ? (
                <div className="mb-2">
                  <NewIntervalBlockForm
                    dateKey={data.dateKey}
                    masterId={data.masterId}
                    onCreated={async () => {
                      setClosureFormMode("none");
                      await refreshCell();
                    }}
                    onCancel={() => setClosureFormMode("none")}
                    onSaveStatus={handleSaveStatus}
                  />
                </div>
              ) : null}

              {closureFormMode === "fullDay" && canEdit ? (
                <div className="mb-2">
                  <FullDayBlockForm
                    dateKey={data.dateKey}
                    masterId={data.masterId}
                    onCreated={async () => {
                      setClosureFormMode("none");
                      await refreshCell();
                    }}
                    onCancel={() => setClosureFormMode("none")}
                    onSaveStatus={handleSaveStatus}
                  />
                </div>
              ) : null}

              {fullDayBlocks.length === 0 && intervalBlocks.length === 0 ? (
                <p className="text-[10px] text-zinc-400">Нет закрытий</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {fullDayBlocks.map((block) => (
                    <ScheduleBlockEditorForm
                      key={block.id}
                      block={block}
                      dateKey={data.dateKey}
                      masterId={data.masterId}
                      canEdit={canEdit}
                      onSaved={() => void refreshCell()}
                      onDeleted={() => void refreshCell()}
                      onSaveStatus={handleSaveStatus}
                    />
                  ))}
                  {intervalBlocks.map((block) => (
                    <ScheduleBlockEditorForm
                      key={block.id}
                      block={block}
                      dateKey={data.dateKey}
                      masterId={data.masterId}
                      canEdit={canEdit}
                      onSaved={() => void refreshCell()}
                      onDeleted={() => void refreshCell()}
                      onSaveStatus={handleSaveStatus}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
