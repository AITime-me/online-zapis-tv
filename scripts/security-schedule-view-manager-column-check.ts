process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  FORBIDDEN_VIEW_ONLY_APPOINTMENT_KEYS,
  collectForbiddenViewOnlyAppointmentKeys,
} from "../src/lib/schedule/appointment-contract";
import {
  FORBIDDEN_VIEW_ONLY_BOOKING_REQUEST_KEYS,
  collectForbiddenViewOnlyBookingRequestKeys,
  getScheduleBookingRequestShortSourceLabel,
  toMasterScheduleBookingRequest,
  toSummaryScheduleBookingRequest,
  type FullScheduleBookingRequestDto,
} from "../src/lib/schedule/booking-request-schedule";
import {
  SCHEDULE_LOAD_INTERNAL,
  SCHEDULE_LOAD_VIEW_ONLY,
  resolveBookingRequestVisibility,
  resolveIncludeOperationalNotes,
  scheduleLoadOptionsForRole,
} from "../src/lib/schedule/schedule-load-options";
import { SCHEDULE_AUTO_REFRESH_INTERVAL_MS } from "../src/hooks/use-schedule-month-auto-refresh";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function buildFullRequest(): FullScheduleBookingRequestDto {
  return {
    id: "r1",
    createdAt: "2026-07-03T09:15:00.000Z",
    clientName: "Анна Тест",
    clientPhone: "+79001234567",
    comment: "секретный комментарий",
    status: "NEW",
    type: "MANAGER_REQUEST",
    isFromGame: false,
    masterName: "Мастер",
    serviceId: "svc-1",
    serviceNameSnapshot: "Маникюр",
    appointmentId: "appt-1",
    appointmentStartsAt: "2026-07-20T10:00:00.000Z",
    appointmentServiceName: "Массаж",
    appointmentScheduleHref: "/schedule?view=day&date=2026-07-20",
  };
}

function assertViewOnlyLoadOptions(): void {
  assert.equal(SCHEDULE_LOAD_VIEW_ONLY.includeManagerColumn, true);
  assert.equal(SCHEDULE_LOAD_VIEW_ONLY.includeOperationalNotes, true);
  assert.equal(resolveIncludeOperationalNotes(SCHEDULE_LOAD_VIEW_ONLY), true);
  assert.equal(resolveBookingRequestVisibility(SCHEDULE_LOAD_VIEW_ONLY), "summary");
  assert.equal(SCHEDULE_LOAD_VIEW_ONLY.appointmentVisibility, "viewOnly");
  assert.equal(SCHEDULE_LOAD_VIEW_ONLY.stripBlockInternalReason, true);

  assert.equal(SCHEDULE_LOAD_INTERNAL.bookingRequestVisibility, "full");

  const masterOpts = scheduleLoadOptionsForRole("MASTER");
  assert.equal(masterOpts.includeManagerColumn, true);
  assert.equal(resolveIncludeOperationalNotes(masterOpts), false);
  assert.equal(resolveBookingRequestVisibility(masterOpts), "sanitized");

  const ownerOpts = scheduleLoadOptionsForRole("OWNER");
  assert.equal(resolveBookingRequestVisibility(ownerOpts), "full");
  assert.equal(resolveIncludeOperationalNotes(ownerOpts), true);
}

function assertSummaryDtoIsSafe(): void {
  const full = buildFullRequest();
  const summary = toSummaryScheduleBookingRequest(full);
  const forbidden = collectForbiddenViewOnlyBookingRequestKeys(
    summary as unknown as Record<string, unknown>,
  );
  assert.deepEqual(forbidden, []);

  assert.equal(summary.clientName, "Анна Тест");
  assert.equal(summary.serviceNameSnapshot, "Маникюр");
  assert.equal(summary.status, "NEW");
  assert.equal(summary.type, "MANAGER_REQUEST");
  assert.equal(
    getScheduleBookingRequestShortSourceLabel(summary),
    "Онлайн-заявка",
  );

  const serialized = JSON.stringify(summary);
  for (const key of FORBIDDEN_VIEW_ONLY_BOOKING_REQUEST_KEYS) {
    assert.doesNotMatch(serialized, new RegExp(`"${key}"`));
  }
  assert.doesNotMatch(serialized, /\+79001234567|секретный|manageToken|\/schedule\?/);

  const vacationDay = {
    managerNotes: [
      { id: "n1", content: "Отпуск", createdAt: "2026-07-03T00:00:00.000Z" },
      { id: "n2", content: "Выходной", createdAt: "2026-07-04T00:00:00.000Z" },
    ],
    bookingRequests: [summary],
  };
  const dayJson = JSON.stringify(vacationDay);
  assert.match(dayJson, /Отпуск/);
  assert.match(dayJson, /Выходной/);
  assert.match(dayJson, /Онлайн-заявка|MANAGER_REQUEST/);
  assert.match(dayJson, /Анна Тест/);
  assert.match(dayJson, /Маникюр/);
  assert.doesNotMatch(dayJson, /clientPhone|"comment"|manageToken|appointmentScheduleHref/);

  // sanitized still keeps schedule href (internal MASTER) — distinct from summary.
  const sanitized = toMasterScheduleBookingRequest(full);
  assert.equal(sanitized.appointmentScheduleHref, full.appointmentScheduleHref);
  assert.equal("clientPhone" in sanitized, false);
}

function assertReadonlyUiContracts(): void {
  const view = read("src/components/schedule/schedule-readonly-month-view.tsx");
  assert.match(view, /showManagerColumn/);
  assert.doesNotMatch(view, /showManagerColumn=\{false\}/);
  assert.match(view, /readOnly/);
  assert.match(view, /canEditManagerNotes=\{false\}/);
  assert.match(view, /bookingRequestDetailLevel="sanitized"/);
  assert.doesNotMatch(view, /onRequestOpen|onManagerCellOpen|onCellOpen/);
  assert.match(view, /pollingEnabled:\s*true/);

  const page = read("src/app/view/schedule/page.tsx");
  assert.match(page, /isValidScheduleViewToken/);
  assert.match(page, /SCHEDULE_LOAD_VIEW_ONLY/);
  assert.match(page, /notFound\(\)/);

  const api = read("src/app/api/view/schedule/month/route.ts");
  assert.match(api, /isValidScheduleViewToken/);
  assert.match(api, /SCHEDULE_LOAD_VIEW_ONLY/);
  assert.match(api, /status:\s*401/);
}

function assertServiceMapsSummary(): void {
  const service = read("src/services/BookingRequestService.ts");
  assert.match(service, /visibility === "summary"/);
  assert.match(service, /toSummaryScheduleBookingRequest/);
  assert.match(service, /visibility === "sanitized"/);
  assert.match(service, /toMasterScheduleBookingRequest/);

  const month = read("src/services/ScheduleMonthService.ts");
  assert.match(month, /bookingRequestVisibility !== "none"/);
  assert.match(month, /stripBlockInternalReason/);
  assert.match(
    month,
    /internalReason:\s*stripInternalReason \? null : block\.internalReason/,
  );
}

function assertCardsNonInteractiveWithoutOnOpen(): void {
  const card = read("src/components/schedule/schedule-booking-request-card.tsx");
  assert.match(card, /onOpen\?:/);
  assert.match(card, /if \(!onOpen\)/);
  assert.match(card, /schedule-booking-request-card-readonly/);
  assert.match(card, /bg-\[#edf6f1\]/);

  const managerCell = read(
    "src/components/schedule/schedule-month-manager-cell.tsx",
  );
  assert.match(
    managerCell,
    /onOpen=\{\s*onRequestOpen\s*\?\s*\(selected\) => onRequestOpen\(selected\)\s*:\s*undefined\s*\}/,
  );

  const managerColumn = read("src/components/schedule/manager-column.tsx");
  assert.match(managerColumn, /onRequestOpen\s*\?/);

  // Internal month view still wires open handlers.
  const monthView = read("src/components/schedule/schedule-month-view.tsx");
  assert.match(monthView, /onRequestOpen=/);
  assert.match(monthView, /onManagerCellOpen=/);
  assert.match(monthView, /ScheduleBookingRequestDetailModal|SafeDetailModal/);
}

function assertNoEditAffordancesInReadonlyPath(): void {
  const row = read("src/components/schedule/schedule-month-row.tsx");
  assert.match(
    row,
    /readOnly \|\| !canEditManagerNotes\s*\r?\n\s*\? undefined/,
  );

  const table = read("src/components/schedule/schedule-month-table.tsx");
  assert.match(table, /Менеджер \/ задачи/);
}

function assertPollingPreserved(): void {
  assert.equal(SCHEDULE_AUTO_REFRESH_INTERVAL_MS, 30_000);
  const hook = read("src/hooks/use-schedule-month-auto-refresh.ts");
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /"visibility"/);
  assert.match(hook, /setInterval/);
}

function assertViewOnlyAppointmentShape(): void {
  const sample = {
    id: "a1",
    serviceId: null,
    startsAt: "2026-07-03T09:00:00.000Z",
    endsAt: "2026-07-03T10:00:00.000Z",
    clientName: "Клиент",
    serviceName: "Услуга",
    isBold: false,
    isManualTimeOverride: false,
    status: "Подтверждена",
    source: "Онлайн",
    statusCode: "CONFIRMED",
    sourceCode: "ONLINE",
  };
  assert.deepEqual(collectForbiddenViewOnlyAppointmentKeys(sample), []);
  const withPhone = { ...sample, clientPhone: "+70000000000" };
  assert.ok(
    collectForbiddenViewOnlyAppointmentKeys(withPhone).includes("clientPhone"),
  );
  assert.ok(
    (FORBIDDEN_VIEW_ONLY_APPOINTMENT_KEYS as readonly string[]).includes(
      "clientPhone",
    ),
  );
}

function run(): void {
  assertViewOnlyLoadOptions();
  assertSummaryDtoIsSafe();
  assertReadonlyUiContracts();
  assertServiceMapsSummary();
  assertCardsNonInteractiveWithoutOnOpen();
  assertNoEditAffordancesInReadonlyPath();
  assertPollingPreserved();
  assertViewOnlyAppointmentShape();
  console.log("security-schedule-view-manager-column-check: OK");
}

run();
