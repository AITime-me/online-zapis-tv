"use client";

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  formatDateKeyLabel,
  formatStudioTimeRange,
} from "@/lib/datetime/date-layer";
import {
  normalizeEditorOptions,
  type EditorOptions,
} from "@/lib/schedule/editor-options";
import type { CellSyncPayload } from "@/lib/schedule/month-data-patch";
import type { QuickDayEditorData } from "@/types/schedule-month";
import { clientDebugLog } from "@/lib/debug/client-debug";
import {
  AppointmentEditorForm,
  NewAppointmentForm,
} from "@/components/schedule/appointment-editor-form";
import { AppointmentCard } from "@/components/schedule/appointment-card";
import {
  FullDayBlockForm,
  NewIntervalBlockForm,
  ScheduleBlockEditorForm,
} from "@/components/schedule/schedule-block-editor-form";
import { EditorCheckboxField, EditorField } from "@/components/schedule/editor-field";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type ClosureFormMode = "none" | "interval" | "fullDay";

type QuickDayEditorProps = {
  data: QuickDayEditorData;
  canEdit: boolean;
  onClose: () => void;
  onCellSynced?: (payload: CellSyncPayload) => void;
  onScheduleChange?: () => void | Promise<void>;
};

const DESKTOP_DRAG_MEDIA = "(min-width: 768px) and (pointer: fine)";
const DRAG_THRESHOLD_PX = 6;
const VIEWPORT_MARGIN_PX = 12;

function clampPanelOffset(
  panel: HTMLElement,
  nextX: number,
  nextY: number,
  current: { x: number; y: number },
): { x: number; y: number } {
  const rect = panel.getBoundingClientRect();
  const naturalLeft = rect.left - current.x;
  const naturalTop = rect.top - current.y;
  const width = rect.width;
  const height = rect.height;
  const minX = VIEWPORT_MARGIN_PX - naturalLeft;
  const maxX = window.innerWidth - VIEWPORT_MARGIN_PX - width - naturalLeft;
  const minY = VIEWPORT_MARGIN_PX - naturalTop;
  const maxY = window.innerHeight - VIEWPORT_MARGIN_PX - height - naturalTop;

  return {
    x: Math.min(Math.max(nextX, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(nextY, minY), Math.max(minY, maxY)),
  };
}

export function QuickDayEditor({
  data: initialData,
  canEdit,
  onClose,
  onCellSynced,
  onScheduleChange,
}: QuickDayEditorProps) {
  const extraWorkStartId = useId();
  const extraWorkEndId = useId();
  const extraWorkOnlineId = useId();
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
    isOnlineBookingEnabled: true,
  });
  const [extraError, setExtraError] = useState<string | null>(null);
  const [panelOffset, setPanelOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [desktopDragEnabled, setDesktopDragEnabled] = useState(false);
  const [overlapConfirmOpen, setOverlapConfirmOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelOffsetRef = useRef(panelOffset);
  const suppressBackdropClickRef = useRef(false);
  const isMountedRef = useRef(true);
  const activeDragTeardownRef = useRef<(() => void) | null>(null);

  panelOffsetRef.current = panelOffset;

  const teardownActiveDrag = useCallback((options?: { moved?: boolean }) => {
    const teardown = activeDragTeardownRef.current;
    activeDragTeardownRef.current = null;
    if (teardown) {
      teardown();
    }
    if (!isMountedRef.current) {
      return;
    }
    setIsDragging(false);
    if (options?.moved) {
      suppressBackdropClickRef.current = true;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      teardownActiveDrag();
    };
  }, [teardownActiveDrag]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia(DESKTOP_DRAG_MEDIA);
    const sync = () => {
      const enabled = media.matches;
      setDesktopDragEnabled(enabled);
      if (!enabled) {
        teardownActiveDrag();
      }
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [teardownActiveDrag]);

  useEffect(() => {
    const onResize = () => {
      if (!isMountedRef.current) {
        return;
      }
      const panel = panelRef.current;
      if (!panel) {
        return;
      }
      setPanelOffset((current) =>
        clampPanelOffset(panel, current.x, current.y, current),
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const canDrag = desktopDragEnabled && !overlapConfirmOpen;

  useEffect(() => {
    if (!canDrag) {
      teardownActiveDrag();
    }
  }, [canDrag, teardownActiveDrag]);

  const handleDragPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canDrag || event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        "button, a, input, select, textarea, label, [role='button']",
      )
    ) {
      return;
    }

    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    // Завершаем предыдущий незавершённый drag, если он остался.
    teardownActiveDrag();

    const pointerId = event.pointerId;
    const captureTarget = event.currentTarget;
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const origin = panelOffsetRef.current;
    let moved = false;
    let cleanedUp = false;

    captureTarget.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId || !isMountedRef.current) {
        return;
      }
      const dx = moveEvent.clientX - startClientX;
      const dy = moveEvent.clientY - startClientY;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return;
      }
      moved = true;
      setIsDragging(true);
      const next = clampPanelOffset(
        panel,
        origin.x + dx,
        origin.y + dy,
        panelOffsetRef.current,
      );
      panelOffsetRef.current = next;
      setPanelOffset(next);
    };

    const finishDrag = () => {
      teardownActiveDrag({ moved });
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      finishDrag();
    };

    const onPointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) {
        return;
      }
      finishDrag();
    };

    const teardown = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      if (captureTarget.hasPointerCapture?.(pointerId)) {
        try {
          captureTarget.releasePointerCapture(pointerId);
        } catch {
          // Элемент мог уже исчезнуть при unmount.
        }
      }
    };

    activeDragTeardownRef.current = teardown;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  };

  const handleBackdropClick = () => {
    if (suppressBackdropClickRef.current) {
      suppressBackdropClickRef.current = false;
      return;
    }
    onClose();
  };

  const resetExtraForm = () => {
    setExtraForm({
      startTime: "08:00",
      endTime: "10:00",
      isOnlineBookingEnabled: true,
    });
    setExtraError(null);
  };

  const closeOtherForms = () => {
    setShowNewAppointment(false);
    setShowNewExtraWork(false);
    setClosureFormMode("none");
    setOverlapConfirmOpen(false);
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

      clientDebugLog("schedule.refreshCell.synced", {
        appointments: cellData.appointments.length,
      });

      onCellSynced?.({
        dateKey: cellData.dateKey,
        masterId: cellData.masterId,
        appointments: cellData.appointments,
        scheduleBlocks: cellData.scheduleBlocks,
        extraWorkWindows: cellData.extraWorkWindows,
      });
    }

    clientDebugLog("schedule.refreshCell.before-change", {
      appointments: payload.appointments?.length ?? 0,
    });

    await onScheduleChange?.();

    clientDebugLog("schedule.refreshCell.after-change");
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
        setOptions(
          normalizeEditorOptions({
            master: payload.master,
            services: payload.services,
            statuses: payload.statuses,
            sources: payload.sources,
          }),
        );
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
      resetExtraForm();
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/15 p-4 pt-16"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="flex max-h-[85vh] w-full max-w-lg flex-col border border-[#dadce0] bg-white shadow-lg"
        style={{ transform: `translate(${panelOffset.x}px, ${panelOffset.y}px)` }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-labelledby="quick-day-editor-title"
      >
        <div
          className={`flex shrink-0 items-start justify-between border-b border-[#dadce0] bg-[#f8f9fa] px-3 py-2 ${
            canDrag ? (isDragging ? "cursor-grabbing" : "cursor-grab") : ""
          }`}
          onPointerDown={handleDragPointerDown}
          data-quick-day-drag-handle="true"
        >
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
            onPointerDown={(event) => event.stopPropagation()}
            className="ml-2 px-1 text-lg leading-none text-zinc-500 hover:text-zinc-900"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
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
                  resetExtraForm();
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
                onOverlapConfirmChange={setOverlapConfirmOpen}
              />
            </div>
          ) : null}

          {showNewExtraWork && canEdit ? (
            <div className="mb-3 border border-[#dadce0] bg-[#f8f9fa] p-2 text-xs">
              <p className="mb-2 font-medium">Новое доп. время</p>
              <div className="grid grid-cols-2 gap-2">
                <EditorField field="startTime" htmlFor={extraWorkStartId}>
                  <input
                    id={extraWorkStartId}
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
                </EditorField>
                <EditorField field="endTime" htmlFor={extraWorkEndId}>
                  <input
                    id={extraWorkEndId}
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
                </EditorField>
              </div>
              <EditorCheckboxField field="onlineBooking" htmlFor={extraWorkOnlineId}>
                <input
                  id={extraWorkOnlineId}
                  type="checkbox"
                  checked={extraForm.isOnlineBookingEnabled}
                  onChange={(event) =>
                    setExtraForm((current) => ({
                      ...current,
                      isOnlineBookingEnabled: event.target.checked,
                    }))
                  }
                />
              </EditorCheckboxField>
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
                        masterName={data.masterPublicName}
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
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
              />
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
