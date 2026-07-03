"use client";

import { useState } from "react";
import type { UserRole } from "@prisma/client";
import { canManageFullSchedule } from "@/lib/auth/permissions";
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

export function ScheduleMonthView({
  data,
  userRole,
}: {
  data: ScheduleMonthData;
  userRole: UserRole;
}) {
  const [editorData, setEditorData] = useState<QuickDayEditorData | null>(null);
  const [managerEditorData, setManagerEditorData] =
    useState<QuickManagerEditorData | null>(null);
  const [ownerEditorData, setOwnerEditorData] =
    useState<QuickOwnerEditorData | null>(null);
  const canEdit = canManageFullSchedule(userRole);

  const closeAllEditors = () => {
    setEditorData(null);
    setManagerEditorData(null);
    setOwnerEditorData(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <ScheduleViewSwitcher view="month" month={data.month} date={data.studioToday} />
      <ScheduleMonthTable
        data={data}
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
    </div>
  );
}
