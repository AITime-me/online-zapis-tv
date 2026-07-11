"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clientDebugLog } from "@/lib/debug/client-debug";
import { countMonthAppointments } from "@/lib/schedule/month-data-patch";
import { normalizeMonthKey, toIsoString } from "@/lib/datetime/date-layer";
import type { ScheduleMonthData } from "@/types/schedule-month";

export const SCHEDULE_AUTO_REFRESH_INTERVAL_MS = 30_000;

export type ScheduleRefreshSource =
  | "manual"
  | "after-save"
  | "polling"
  | "visibility";

type UseScheduleMonthAutoRefreshOptions = {
  initialData: ScheduleMonthData;
  fetchMonth: (month: string) => Promise<ScheduleMonthData | null>;
  pollingEnabled?: boolean;
  intervalMs?: number;
  debugLog?: boolean;
};

type RefreshResult = {
  ok: boolean;
  error?: string;
};

export function useScheduleMonthAutoRefresh({
  initialData,
  fetchMonth,
  pollingEnabled = true,
  intervalMs = SCHEDULE_AUTO_REFRESH_INTERVAL_MS,
  debugLog = false,
}: UseScheduleMonthAutoRefreshOptions) {
  const [monthData, setMonthData] = useState(initialData);
  const [scheduleRevision, setScheduleRevision] = useState(0);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<ScheduleRefreshSource | null>(
    null,
  );
  const [lastError, setLastError] = useState<string | null>(null);

  const monthKeyRef = useRef(initialData.month);
  monthKeyRef.current = monthData.month;

  const fetchMonthRef = useRef(fetchMonth);
  fetchMonthRef.current = fetchMonth;

  const appointmentCount = useMemo(
    () => countMonthAppointments(monthData),
    [monthData],
  );

  useEffect(() => {
    setMonthData(initialData);
    monthKeyRef.current = initialData.month;
    setScheduleRevision(0);
    setLastRefreshAt(null);
    setLastSource(null);
    setLastError(null);
  }, [initialData.month]);

  const refreshSchedule = useCallback(
    async (source: ScheduleRefreshSource = "manual"): Promise<RefreshResult> => {
      const month = normalizeMonthKey(monthKeyRef.current || initialData.month);

      if (month !== monthKeyRef.current) {
        monthKeyRef.current = month;
      }

      if (debugLog) {
        clientDebugLog("schedule.refresh.start", { source, month });
      }

      try {
        const data = await fetchMonthRef.current(month);
        if (!data) {
          const errorMessage = "Failed to load schedule month data";
          setLastError(errorMessage);
          if (debugLog) {
            clientDebugLog("schedule.refresh.error", { source });
          }
          return { ok: false, error: errorMessage };
        }

        setMonthData(data);
        monthKeyRef.current = normalizeMonthKey(data.month || month);
        setScheduleRevision((revision) => revision + 1);
        const updatedAt = toIsoString();
        setLastRefreshAt(updatedAt);
        setLastSource(source);
        setLastError(null);

        if (debugLog) {
          clientDebugLog("schedule.refresh.success", {
            source,
            month: data.month,
            count: countMonthAppointments(data),
          });
        }

        return { ok: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown refresh error";
        setLastError(errorMessage);
        if (debugLog) {
          clientDebugLog("schedule.refresh.exception", { source });
        }
        return { ok: false, error: errorMessage };
      }
    },
    [debugLog, initialData.month],
  );

  useEffect(() => {
    if (!pollingEnabled) {
      return;
    }
    void refreshSchedule("polling");
  }, [pollingEnabled, refreshSchedule]);

  useEffect(() => {
    if (!pollingEnabled) {
      return;
    }

    const timerId = window.setInterval(() => {
      void refreshSchedule("polling");
    }, intervalMs);

    return () => window.clearInterval(timerId);
  }, [pollingEnabled, intervalMs, refreshSchedule]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshSchedule("visibility");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [refreshSchedule]);

  return {
    monthData,
    setMonthData,
    scheduleRevision,
    setScheduleRevision,
    refreshSchedule,
    lastRefreshAt,
    lastSource,
    lastError,
    appointmentCount,
  };
}

export async function fetchInternalScheduleMonth(
  month: string,
): Promise<ScheduleMonthData | null> {
  const response = await fetch(
    `/api/schedule/month?month=${encodeURIComponent(month)}`,
    { cache: "no-store" },
  );
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    return null;
  }

  return {
    month: payload.month,
    studioToday: payload.studioToday,
    masters: payload.masters,
    days: payload.days,
  };
}

export async function fetchViewScheduleMonth(
  month: string,
  token: string,
): Promise<ScheduleMonthData | null> {
  const response = await fetch(
    `/api/view/schedule/month?token=${encodeURIComponent(token)}&month=${encodeURIComponent(month)}`,
    { cache: "no-store" },
  );
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    return null;
  }

  return {
    month: payload.month,
    studioToday: payload.studioToday,
    masters: payload.masters,
    days: payload.days,
  };
}
