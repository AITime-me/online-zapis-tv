import assert from "node:assert/strict";

import { JSDOM } from "jsdom";
import React from "react";
import { createRoot } from "react-dom/client";

import type { ScheduleDayBookingRequest } from "../src/types/schedule";
import type { ScheduleMonthData } from "../src/types/schedule-month";
import type { ScheduleDayData } from "../src/types/schedule";
import type { UserRole } from "@prisma/client";

import { ScheduleMonthView } from "../src/components/schedule/schedule-month-view";
import { ScheduleDayView } from "../src/components/schedule/schedule-day-view";
import { ScheduleReadonlyMonthView } from "../src/components/schedule/schedule-readonly-month-view";

const dateKey1 = "2026-07-03";
const dateKey2 = "2026-07-04";
const monthKey = "2026-07";
const studioToday = dateKey1;

const masterA = "master-a";
const masterB = "master-b";

const noteWithHtml = "VIP (мастер А) <b>NOT_HTML</b>";
const noteB = "VIP (мастер Б)";

let monthPayloadForFetch: unknown = null;

function makeMasterAppointment({
  id,
  masterId,
  startsAt,
  endsAt,
  masterNote,
}: {
  id: string;
  masterId: string;
  startsAt: string;
  endsAt: string;
  masterNote: string | null;
}) {
  // MASTER DTO must NOT include operational keys like clientPhone/email/comment/importantNote.
  return {
    kind: "appointment",
    id,
    masterId,
    serviceId: null,
    startsAt,
    endsAt,
    clientName: "Клиент",
    serviceName: "Услуга",
    isBold: false,
    isManualTimeOverride: false,
    status: "CONFIRMED",
    source: "INTERNAL",
    statusCode: "CONFIRMED",
    sourceCode: "INTERNAL",
    promotionLabels: [],
    masterNote,
  };
}

function makeViewOnlyAppointment({
  id,
  masterId,
  startsAt,
  endsAt,
  masterNote,
}: {
  id: string;
  masterId: string;
  startsAt: string;
  endsAt: string;
  masterNote: string | null;
}) {
  // Token view-only DTO: masterNote only — no promotionLabels / contacts.
  return {
    kind: "appointment",
    id,
    masterId,
    serviceId: null,
    startsAt,
    endsAt,
    clientName: "Клиент",
    serviceName: "Услуга",
    isBold: false,
    isManualTimeOverride: false,
    status: "CONFIRMED",
    source: "INTERNAL",
    statusCode: "CONFIRMED",
    sourceCode: "INTERNAL",
    masterNote,
  };
}

function makeScheduleBlock({
  id,
  isFullDay,
  startsAt,
  endsAt,
  blockTypeLabel,
}: {
  id: string;
  isFullDay: boolean;
  startsAt?: string;
  endsAt?: string;
  blockTypeLabel: string;
}) {
  return {
    kind: "block",
    id,
    isFullDay,
    startsAt: isFullDay ? "" : (startsAt ?? ""),
    endsAt: isFullDay ? "" : (endsAt ?? ""),
    blockType: "PERSONAL",
    blockTypeLabel,
    internalReason: null,
  };
}

function makeExtraWork({
  id,
  startsAt,
  endsAt,
}: {
  id: string;
  startsAt: string;
  endsAt: string;
}) {
  return {
    kind: "extraWork",
    id,
    startsAt,
    endsAt,
    isOnlineBookingEnabled: false,
  };
}

function makeBookingRequestSummary({
  id,
  createdAt,
}: {
  id: string;
  createdAt: string;
}): ScheduleDayBookingRequest {
  return {
    id,
    createdAt,
    clientName: "Клиент",
    status: "NEW",
    type: "MANAGER_REQUEST",
    isFromGame: false,
    serviceNameSnapshot: "Услуга",
    appointmentServiceName: null,
  };
}

function createViewOnlyMonthData(): ScheduleMonthData {
  return {
    month: monthKey,
    studioToday,
    masters: [
      { id: masterA, internalName: "Мастер A", publicName: "MA" },
      { id: masterB, internalName: "Мастер B", publicName: "MB" },
    ],
    days: [
      {
        dateKey: dateKey1,
        managerNotes: [],
        ownerNotes: [],
        bookingRequests: [
          makeBookingRequestSummary({
            id: "req-view",
            createdAt: "2026-07-03T08:00:00.000Z",
          }),
        ],
        masterCells: {
          [masterA]: [
            makeViewOnlyAppointment({
              id: "view-appt-a",
              masterId: masterA,
              startsAt: "2026-07-03T09:00:00.000Z",
              endsAt: "2026-07-03T10:00:00.000Z",
              masterNote: noteWithHtml,
            }),
            makeViewOnlyAppointment({
              id: "view-appt-empty",
              masterId: masterA,
              startsAt: "2026-07-03T11:00:00.000Z",
              endsAt: "2026-07-03T11:30:00.000Z",
              masterNote: "   ",
            }),
          ],
          [masterB]: [
            makeViewOnlyAppointment({
              id: "view-appt-b",
              masterId: masterB,
              startsAt: "2026-07-03T15:30:00.000Z",
              endsAt: "2026-07-03T16:30:00.000Z",
              masterNote: noteB,
            }),
          ],
        },
      },
    ],
  };
}

function createMonthData(): ScheduleMonthData {
  return {
    month: monthKey,
    studioToday,
    masters: [
      { id: masterA, internalName: "Мастер A", publicName: "MA" },
      { id: masterB, internalName: "Мастер B", publicName: "MB" },
    ],
    days: [
      {
        dateKey: dateKey1,
        managerNotes: [],
        ownerNotes: [],
        bookingRequests: [makeBookingRequestSummary({ id: "req-1", createdAt: "2026-07-03T08:00:00.000Z" })],
        masterCells: {
          [masterA]: [
            makeMasterAppointment({
              id: "appt-a",
              masterId: masterA,
              startsAt: "2026-07-03T09:00:00.000Z",
              endsAt: "2026-07-03T10:00:00.000Z",
              masterNote: noteWithHtml,
            }),
            makeMasterAppointment({
              id: "appt-a-null",
              masterId: masterA,
              startsAt: "2026-07-03T11:00:00.000Z",
              endsAt: "2026-07-03T11:30:00.000Z",
              masterNote: null,
            }),
            makeScheduleBlock({
              id: "block-dayoff",
              isFullDay: true,
              blockTypeLabel: "Выходной",
            }),
            makeScheduleBlock({
              id: "block-personal",
              isFullDay: false,
              startsAt: "2026-07-03T17:00:00.000Z",
              endsAt: "2026-07-03T18:00:00.000Z",
              blockTypeLabel: "Личное время",
            }),
            makeExtraWork({
              id: "extra-1",
              startsAt: "2026-07-03T19:00:00.000Z",
              endsAt: "2026-07-03T19:30:00.000Z",
            }),
          ],
          [masterB]: [
            makeMasterAppointment({
              id: "appt-b",
              masterId: masterB,
              startsAt: "2026-07-03T15:30:00.000Z",
              endsAt: "2026-07-03T16:30:00.000Z",
              masterNote: noteB,
            }),
          ],
        },
      },
      {
        dateKey: dateKey2,
        managerNotes: [],
        ownerNotes: [],
        bookingRequests: [],
        masterCells: {},
      },
    ],
  };
}

function createDayData(): ScheduleDayData {
  return {
    date: dateKey1,
    managerNotes: [],
    bookingRequests: [
      makeBookingRequestSummary({ id: "req-2", createdAt: "2026-07-03T09:00:00.000Z" }),
    ],
    masters: [
      {
        id: masterA,
        internalName: "Мастер A",
        publicName: "MA",
        appointments: [
          makeMasterAppointment({
            id: "day-appt-a",
            masterId: masterA,
            startsAt: "2026-07-03T09:00:00.000Z",
            endsAt: "2026-07-03T10:00:00.000Z",
            masterNote: noteWithHtml,
          }),
          makeMasterAppointment({
            id: "day-appt-a-null",
            masterId: masterA,
            startsAt: "2026-07-03T11:00:00.000Z",
            endsAt: "2026-07-03T11:30:00.000Z",
            masterNote: null,
          }),
        ],
        scheduleBlocks: [
          {
            id: "day-block-off",
            startsAt: "",
            endsAt: "",
            blockType: "DAY_OFF",
            blockTypeLabel: "Выходной",
            internalReason: null,
            isFullDay: true,
          },
          {
            id: "day-block-personal",
            startsAt: "2026-07-03T17:00:00.000Z",
            endsAt: "2026-07-03T18:00:00.000Z",
            blockType: "PERSONAL",
            blockTypeLabel: "Личное время",
            internalReason: null,
            isFullDay: false,
          },
        ],
        extraWorkWindows: [
          {
            id: "day-extra-1",
            startsAt: "2026-07-03T19:00:00.000Z",
            endsAt: "2026-07-03T19:30:00.000Z",
            isOnlineBookingEnabled: false,
          },
        ],
      },
      {
        id: masterB,
        internalName: "Мастер B",
        publicName: "MB",
        appointments: [
          makeMasterAppointment({
            id: "day-appt-b",
            masterId: masterB,
            startsAt: "2026-07-03T15:30:00.000Z",
            endsAt: "2026-07-03T16:30:00.000Z",
            masterNote: noteB,
          }),
        ],
        scheduleBlocks: [],
        extraWorkWindows: [],
      },
    ],
  };
}

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });

  const g = globalThis as unknown as Record<string, unknown>;
  g["window"] = dom.window;
  g["document"] = dom.window.document;
  g["navigator"] = dom.window.navigator;
  g["HTMLElement"] = dom.window.HTMLElement;
  g["Node"] = dom.window.Node;
  g["Event"] = dom.window.Event;
  g["KeyboardEvent"] = dom.window.KeyboardEvent;
  g["MouseEvent"] = dom.window.MouseEvent;
  g["PointerEvent"] = dom.window.PointerEvent;
  g["self"] = dom.window;
  // Next.js client helpers expect these globals in browser-like env.
  type IdleDeadline = {
    didTimeout: boolean;
    timeRemaining: () => number;
  };
  type RequestIdleCallback = (cb: (deadline: IdleDeadline) => void) => number;
  type CancelIdleCallback = (id: number) => void;

  if (!g["requestIdleCallback"]) {
    const ric: RequestIdleCallback = (cb) =>
      setTimeout(
        () => cb({ didTimeout: false, timeRemaining: () => 50 }),
        0,
      ) as unknown as number;
    const cic: CancelIdleCallback = (id) => clearTimeout(id as unknown as NodeJS.Timeout);
    g["requestIdleCallback"] = ric;
    g["cancelIdleCallback"] = cic;
  }

  // Stub fetch endpoints used by ScheduleMonthView/QuickDayEditor.
  g["fetch"] = async (input: unknown) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : (input as { url?: string }).url ?? "";
    const url = new URL(rawUrl, "http://localhost");

    if (url.pathname === "/api/schedule/month") {
      const payload = monthPayloadForFetch as
        | { month: string; studioToday: string; masters: unknown[]; days: unknown[] }
        | null;
      if (!payload) {
        return new Response(JSON.stringify({ ok: false }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, ...payload }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/view/schedule/month") {
      const payload = monthPayloadForFetch as
        | { month: string; studioToday: string; masters: unknown[]; days: unknown[] }
        | null;
      if (!payload) {
        return new Response(JSON.stringify({ ok: false }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, ...payload }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/schedule/editor-options") {
      return new Response(
        JSON.stringify({
          ok: true,
          master: { workStart: "09:00", workEnd: "18:00" },
          services: [
            {
              id: "service-1",
              publicName: "Услуга",
              durationMinutes: 60,
              breakAfterMinutes: 0,
              totalBusyMinutes: 60,
              priceFrom: null,
              priceTo: null,
            },
          ],
          statuses: [{ value: "CONFIRMED" }],
          sources: [{ value: "INTERNAL" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  // Prevent auto-refresh loops from triggering async work.
  dom.window.setInterval = () => 0;
  dom.window.clearInterval = () => {};
  g["setInterval"] = () => 0;
  g["clearInterval"] = () => {};

  g["confirm"] = () => true;
}

async function waitTick() {
  await new Promise((r) => setTimeout(r, 0));
}

async function run(): Promise<void> {
  setupDom();

  const monthData = createMonthData();
  const dayData = createDayData();
  monthPayloadForFetch = monthData;

  // Positive control: OWNER and MANAGER can open a cell editor.
  for (const role of ["OWNER", "MANAGER"] as const) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(
      <ScheduleMonthView
        data={monthData}
        userRole={role}
        canViewFullBookingRequestDetails={false}
      />,
    );
    await waitTick();
    await waitTick();

    const cell = container.querySelector(
      `[data-testid="schedule-cell-${dateKey1}-${masterA}"]`,
    ) as HTMLTableCellElement | null;
    assert.ok(cell, `Cell for role ${role} must exist`);
    assert.ok(cell!.hasAttribute("role"), `Cell for ${role} must be interactive`);
    assert.ok(
      cell!.className.includes("cursor-pointer"),
      `Cell for ${role} must show cursor-pointer`,
    );

    cell!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitTick();
    await waitTick();

    assert.ok(
      container.querySelector('[role="dialog"]'),
      `QuickDayEditor dialog should appear for ${role}`,
    );

    const closeBtn = container.querySelector('button[aria-label="Закрыть"]');
    assert.ok(closeBtn, `Close button should exist for ${role}`);
    closeBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitTick();
    await waitTick();

    assert.equal(
      container.querySelectorAll('[role="dialog"]').length,
      0,
      `Dialog should close for ${role}`,
    );
  }

  // Render month view (MASTER must be fully non-interactive).
  const monthContainer = document.createElement("div");
  document.body.appendChild(monthContainer);
  const monthRoot = createRoot(monthContainer);
  monthRoot.render(
    <ScheduleMonthView
      data={monthData}
      userRole={"MASTER" as UserRole}
      canViewFullBookingRequestDetails={false}
    />,
  );
  await waitTick();
  await waitTick();

  const masterACell = monthContainer.querySelector(
    `[data-testid="schedule-cell-${dateKey1}-${masterA}"]`,
  ) as HTMLTableCellElement | null;
  assert.ok(masterACell, "Master A cell must exist");

  assert.ok(!masterACell!.hasAttribute("role"), "Read-only cells must not have role=button");
  assert.ok(
    !masterACell!.className.includes("cursor-pointer"),
    "Read-only cells must not show cursor-pointer",
  );

  // MasterNote block must be rendered inline (not in modal).
  assert.ok(
    masterACell!.textContent?.includes("Пометка для мастера:"),
    "MasterNote label should be directly rendered inside the cell",
  );
  assert.ok(
    masterACell!.textContent?.includes("<b>NOT_HTML</b>"),
    "HTML-like note must be rendered as plain text",
  );
  assert.equal(
    masterACell!.querySelectorAll(".border-amber-200").length,
    1,
    "Empty/whitespace masterNote must not create extra yellow blocks",
  );
  assert.equal(
    masterACell!.querySelectorAll("b").length,
    0,
    "HTML-like masterNote must not create nested <b> elements",
  );

  // Clicking / key activation should not open any dialog/editor.
  masterACell!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  masterACell!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  masterACell!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  masterACell!.dispatchEvent(
    new KeyboardEvent("keydown", { key: " ", bubbles: true }),
  );

  assert.equal(
    document.querySelectorAll('[role="dialog"]').length,
    0,
    "MASTER must not open any dialog from month cells",
  );

  // Booking request card should be readonly (MASTER cannot open request details).
  const readonlyRequest = document.querySelector(
    '[data-testid="schedule-booking-request-card-readonly"]',
  );
  assert.ok(readonlyRequest, "MASTER must see booking request card in readonly mode");
  readonlyRequest!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  assert.equal(
    document.querySelectorAll('[role="dialog"]').length,
    0,
    "MASTER must not open request detail dialog",
  );

  // Empty cell must remain non-interactive.
  const emptyCell = monthContainer.querySelector(
    `[data-testid="schedule-cell-${dateKey2}-${masterB}"]`,
  ) as HTMLTableCellElement | null;
  assert.ok(emptyCell, "Empty cell must exist");
  assert.ok(!emptyCell!.hasAttribute("role"), "Empty cells must not be interactive");
  assert.ok(!emptyCell!.className.includes("cursor-pointer"), "Empty cells must not show cursor-pointer");

  emptyCell!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  emptyCell!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  emptyCell!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  emptyCell!.dispatchEvent(
    new KeyboardEvent("keydown", { key: " ", bubbles: true }),
  );
  assert.equal(
    document.querySelectorAll('[role="dialog"]').length,
    0,
    "MASTER must not open dialogs from empty month cell",
  );

  const dayOffNode = Array.from(masterACell!.querySelectorAll("*")).find((el) =>
    (el.textContent ?? "").includes("Выходной"),
  );
  assert.ok(dayOffNode, "Block 'Выходной' should be present");
  dayOffNode!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  const personalTimeNode = Array.from(masterACell!.querySelectorAll("*")).find((el) =>
    (el.textContent ?? "").includes("Личное время"),
  );
  assert.ok(personalTimeNode, "Block 'Личное время' should be present");
  personalTimeNode!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  assert.equal(
    document.querySelectorAll('[role="dialog"]').length,
    0,
    "MASTER must not open dialogs from blocks/personal time",
  );

  // Render day view (MASTER must not open booking request details).
  const dayContainer = document.createElement("div");
  document.body.appendChild(dayContainer);
  const dayRoot = createRoot(dayContainer);
  dayRoot.render(
    <ScheduleDayView
      data={dayData}
      studioToday={studioToday}
      canEditRequests={false}
      canEditManagerNotes={false}
      canViewFullBookingRequestDetails={false}
    />,
  );
  await waitTick();
  await waitTick();

  const readonlyDayRequest = dayContainer.querySelector(
    '[data-testid="schedule-booking-request-card-readonly"]',
  );
  assert.ok(readonlyDayRequest, "MASTER must see day booking request card in readonly mode");
  readonlyDayRequest!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  readonlyDayRequest!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );

  assert.equal(
    document.querySelectorAll('[role="dialog"]').length,
    0,
    "MASTER must not open dialogs from day view booking requests",
  );

  const dayAppointmentNode = Array.from(dayContainer.querySelectorAll("*")).find((el) =>
    (el.textContent ?? "").includes("VIP (мастер А) <b>NOT_HTML</b>"),
  );
  assert.ok(dayAppointmentNode, "Master appointment with masterNote should be present");
  dayAppointmentNode!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  const dayOffInDayNode = Array.from(dayContainer.querySelectorAll("*")).find((el) =>
    (el.textContent ?? "").includes("Выходной"),
  );
  assert.ok(dayOffInDayNode, "Day-off block should be present");
  dayOffInDayNode!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  assert.equal(
    document.querySelectorAll('[role="dialog"]').length,
    0,
    "MASTER must not open dialogs from day appointments/blocks",
  );

  // Token-protected /view/schedule readonly month must show masterNote inline.
  const viewOnlyData = createViewOnlyMonthData();
  monthPayloadForFetch = viewOnlyData;
  const viewContainer = document.createElement("div");
  document.body.appendChild(viewContainer);
  const viewRoot = createRoot(viewContainer);
  viewRoot.render(
    <ScheduleReadonlyMonthView data={viewOnlyData} token="test-view-token" />,
  );
  await waitTick();
  await waitTick();

  assert.ok(
    viewContainer.querySelector('[data-testid="schedule-readonly-month-view"]'),
    "Readonly month view must mount",
  );
  assert.ok(
    viewContainer.textContent?.includes("Пометка для мастера:"),
    "Token view-only schedule must render masterNote label",
  );
  assert.ok(
    viewContainer.textContent?.includes("<b>NOT_HTML</b>"),
    "Token view-only masterNote must render as plain text",
  );
  assert.ok(
    viewContainer.textContent?.includes(noteB),
    "Token view-only schedule must show another master's masterNote",
  );
  assert.equal(
    viewContainer.querySelectorAll(".border-amber-200").length,
    2,
    "Whitespace-only masterNote must not create a yellow block on /view/schedule",
  );
  assert.equal(
    viewContainer.querySelectorAll('[role="dialog"]').length,
    0,
    "Token view-only schedule must not open editors",
  );

  console.log("schedule-master-note-ui-check: passed");
}

void run();

