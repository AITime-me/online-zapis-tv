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
import { isScheduleDebugEnabled } from "@/lib/schedule/debug";
import {
  ScheduleDebugBanner,
  type ScheduleDebugLastAction,
} from "@/components/schedule/schedule-debug-banner";

const scheduleDebugEnabled = isScheduleDebugEnabled();

export function ScheduleMonthView({
  data: initialData,
  userRole,
}: {
  data: ScheduleMonthData;
  userRole: UserRole;
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
  const [debugLastAction, setDebugLastAction] =
    useState<ScheduleDebugLastAction>("idle");
  const canEdit = canManageFullSchedule(userRole);

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
  };

  return (
    <div className="flex flex-col gap-2">
      <ScheduleViewSwitcher
        view="month"
        month={monthData.month}
        date={monthData.studioToday}
      />
      <ScheduleMonthTable
        data={monthData}
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
          onClose={() => setManagerEditorData(null)}
        />
      ) : null}
      {ownerEditorData ? (
        <QuickOwnerEditor
          data={ownerEditorData}
          canEdit={canEdit}
          onClose={() => setOwnerEditorData(null)}
        />
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
