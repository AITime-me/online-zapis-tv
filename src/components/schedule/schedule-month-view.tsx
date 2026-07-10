"use client";

import { useCallback, useState } from "react";
import type { UserRole } from "@prisma/client";
import { canManageFullSchedule } from "@/lib/auth/permissions";
import {
  cellPayloadToMonthItems,
  patchMonthDataCell,
  type CellSyncPayload,
} from "@/lib/schedule/month-data-patch";
import {
  fetchInternalScheduleMonth,
  useScheduleMonthAutoRefresh,
} from "@/hooks/use-schedule-month-auto-refresh";
import type {
  ScheduleMonthData,
  QuickDayEditorData,
  QuickManagerEditorData,
  QuickOwnerEditorData,
} from "@/types/schedule-month";
import { ScheduleViewSwitcher } from "@/components/schedule/schedule-view-switcher";
import { ScheduleMonthTable } from "@/components/schedule/schedule-month-table";
import { QuickDayEditor } from "@/components/schedule/quick-day-editor";
import { QuickManagerEditor } from "@/components/schedule/quick-manager-editor";
import { QuickOwnerEditor } from "@/components/schedule/quick-owner-editor";
import {
  ScheduleBookingRequestDetailModal,
  ScheduleBookingRequestSafeDetailModal,
} from "@/components/schedule/schedule-booking-request-card";
import type { ScheduleDayBookingRequest } from "@/types/schedule";
import { isScheduleDebugEnabled } from "@/lib/schedule/debug";
import {
  ScheduleDebugBanner,
  type ScheduleDebugLastAction,
} from "@/components/schedule/schedule-debug-banner";

const scheduleDebugEnabled = isScheduleDebugEnabled();

export function ScheduleMonthView({
  data: initialData,
  userRole,
  canViewFullBookingRequestDetails = true,
}: {
  data: ScheduleMonthData;
  userRole: UserRole;
  canViewFullBookingRequestDetails?: boolean;
}) {
  const {
    monthData,
    setMonthData,
    scheduleRevision,
    setScheduleRevision,
    refreshSchedule,
    lastRefreshAt,
    lastSource,
    lastError,
    appointmentCount,
  } = useScheduleMonthAutoRefresh({
    initialData,
    fetchMonth: fetchInternalScheduleMonth,
    pollingEnabled: true,
    debugLog: scheduleDebugEnabled,
  });

  const [editorData, setEditorData] = useState<QuickDayEditorData | null>(null);
  const [managerEditorData, setManagerEditorData] =
    useState<QuickManagerEditorData | null>(null);
  const [ownerEditorData, setOwnerEditorData] =
    useState<QuickOwnerEditorData | null>(null);
  const [selectedRequest, setSelectedRequest] =
    useState<ScheduleDayBookingRequest | null>(null);
  const [debugLastAction, setDebugLastAction] =
    useState<ScheduleDebugLastAction>("idle");
  const canEdit = canManageFullSchedule(userRole);
  const bookingRequestDetailLevel = canViewFullBookingRequestDetails
    ? "full"
    : "sanitized";

  const syncCellToMonth = useCallback(
    (payload: CellSyncPayload) => {
      setDebugLastAction("patch started");

      const items = cellPayloadToMonthItems(payload);
      setMonthData((current) =>
        patchMonthDataCell(
          current,
          payload.dateKey,
          payload.masterId,
          items,
        ),
      );
      setScheduleRevision((revision) => revision + 1);
      setDebugLastAction("patch success");
    },
    [setMonthData, setScheduleRevision],
  );

  const refreshAfterSave = useCallback(async () => {
    setDebugLastAction("refresh started");
    const result = await refreshSchedule("after-save");
    setDebugLastAction(result.ok ? "refresh success" : "refresh error");
  }, [refreshSchedule]);

  const closeAllEditors = () => {
    setEditorData(null);
    setManagerEditorData(null);
    setOwnerEditorData(null);
    setSelectedRequest(null);
  };

  const handleRequestStatusUpdated = (updated: ScheduleDayBookingRequest) => {
    if (updated.status === "CLOSED") {
      setMonthData((current) => ({
        ...current,
        days: current.days.map((day) => ({
          ...day,
          bookingRequests: day.bookingRequests.filter(
            (request) => request.id !== updated.id,
          ),
        })),
      }));
      setSelectedRequest(null);
      void refreshSchedule("after-save");
      return;
    }

    setMonthData((current) => ({
      ...current,
      days: current.days.map((day) => ({
        ...day,
        bookingRequests: day.bookingRequests.map((request) =>
          request.id === updated.id
            ? { ...request, status: updated.status }
            : request,
        ),
      })),
    }));
    setSelectedRequest(updated);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ScheduleViewSwitcher
        view="month"
        month={monthData.month}
        date={monthData.studioToday}
      />
      <ScheduleMonthTable
        data={monthData}
        canEditManagerNotes={canEdit}
        bookingRequestDetailLevel={bookingRequestDetailLevel}
        onCellOpen={(cellData) => {
          closeAllEditors();
          setEditorData(cellData);
        }}
        onManagerCellOpen={(managerData) => {
          closeAllEditors();
          setManagerEditorData(managerData);
        }}
        onOwnerCellOpen={(ownerData) => {
          closeAllEditors();
          setOwnerEditorData(ownerData);
        }}
        onRequestOpen={(request) => {
          closeAllEditors();
          setSelectedRequest(request);
        }}
      />
      {editorData ? (
        <QuickDayEditor
          data={editorData}
          canEdit={canEdit}
          onClose={() => setEditorData(null)}
          onCellSynced={syncCellToMonth}
          onScheduleChange={refreshAfterSave}
        />
      ) : null}
      {managerEditorData ? (
        <QuickManagerEditor
          data={managerEditorData}
          canEdit={canEdit}
          bookingRequestDetailLevel={bookingRequestDetailLevel}
          onClose={() => setManagerEditorData(null)}
          onRequestOpen={(request) => {
            setManagerEditorData(null);
            setSelectedRequest(request);
          }}
        />
      ) : null}
      {ownerEditorData ? (
        <QuickOwnerEditor
          data={ownerEditorData}
          canEdit={canEdit}
          onClose={() => setOwnerEditorData(null)}
        />
      ) : null}
      {selectedRequest ? (
        canViewFullBookingRequestDetails ? (
          <ScheduleBookingRequestDetailModal
            request={selectedRequest}
            canEditStatus={canEdit}
            onClose={() => setSelectedRequest(null)}
            onStatusUpdated={handleRequestStatusUpdated}
          />
        ) : (
          <ScheduleBookingRequestSafeDetailModal
            request={selectedRequest}
            onClose={() => setSelectedRequest(null)}
          />
        )
      ) : null}
      <ScheduleDebugBanner
        state={{
          month: monthData.month,
          scheduleRevision,
          updatedAt: lastRefreshAt,
          appointmentCount,
          lastAction: debugLastAction,
          lastSource,
          lastError,
        }}
      />
    </div>
  );
}
