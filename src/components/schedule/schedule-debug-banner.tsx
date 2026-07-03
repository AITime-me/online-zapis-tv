"use client";

import { isScheduleDebugEnabled } from "@/lib/schedule/debug";
import type { ScheduleRefreshSource } from "@/hooks/use-schedule-month-auto-refresh";

export type ScheduleDebugLastAction =
  | "idle"
  | "patch started"
  | "patch success"
  | "refresh started"
  | "refresh success"
  | "refresh error";

export type ScheduleDebugState = {
  month: string;
  scheduleRevision: number;
  updatedAt: string | null;
  appointmentCount: number;
  lastAction: ScheduleDebugLastAction;
  lastSource: ScheduleRefreshSource | null;
  lastError: string | null;
};

export function ScheduleDebugBanner({ state }: { state: ScheduleDebugState }) {
  if (!isScheduleDebugEnabled()) {
    return null;
  }

  return (
    <div
      data-testid="schedule-debug-banner"
      className="fixed bottom-2 right-2 z-[60] max-w-sm rounded border border-amber-400 bg-amber-50 px-3 py-2 font-mono text-[10px] text-amber-950 shadow-md"
    >
      <div className="mb-1 font-semibold uppercase tracking-wide">
        Schedule debug
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <dt>month</dt>
        <dd data-testid="schedule-debug-month">{state.month}</dd>
        <dt>revision</dt>
        <dd data-testid="schedule-debug-revision">{state.scheduleRevision}</dd>
        <dt>lastRefreshAt</dt>
        <dd data-testid="schedule-debug-updated-at">
          {state.updatedAt ?? "—"}
        </dd>
        <dt>count</dt>
        <dd data-testid="schedule-debug-count">{state.appointmentCount}</dd>
        <dt>source</dt>
        <dd data-testid="schedule-debug-source">{state.lastSource ?? "—"}</dd>
        <dt>lastAction</dt>
        <dd data-testid="schedule-debug-last-action">{state.lastAction}</dd>
        {state.lastError ? (
          <>
            <dt>lastError</dt>
            <dd
              data-testid="schedule-debug-last-error"
              className="text-red-700"
            >
              {state.lastError}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
