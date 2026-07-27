import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  collectForbiddenPublicBookingRequestKeys,
  toPublicBookingRequestCreateResponse,
} from "../src/lib/booking-requests/public-booking-request-contract";
import {
  assertMasterAppointmentShape,
  assertRestrictedAppointmentShape,
  collectForbiddenMasterAppointmentKeys,
  collectForbiddenViewOnlyAppointmentKeys,
  FORBIDDEN_MASTER_APPOINTMENT_KEYS,
  isMasterScheduleAppointment,
  isOperationalScheduleAppointment,
} from "../src/lib/schedule/appointment-contract";
import {
  MASTER_NOTE_MAX_LENGTH,
  MASTER_NOTE_VALIDATION_ERROR,
  normalizeMasterNote,
  validateMasterNote,
} from "../src/lib/schedule/master-note-validation";
import { buildPromotionLabels } from "../src/lib/schedule/promotion-labels";
import { scheduleLoadOptionsForRole } from "../src/lib/schedule/schedule-load-options";
import {
  buildHealthErrorResponse,
  buildHealthSuccessResponse,
} from "../src/lib/health/health-response";
import {
  canManageFullSchedule,
  OPERATIONAL_ADMIN_ROLES,
} from "../src/lib/auth/permissions";
import { formatMonthCellLine } from "../src/components/schedule/schedule-month-cell-content";
import { ScheduleMonthCell } from "../src/components/schedule/schedule-month-cell";
import { AppointmentMasterNoteBlock } from "../src/components/schedule/appointment-master-display";
import type { ScheduleMonthCellItem } from "../src/types/schedule-month";

const ROOT = process.cwd();
const WRITE_SCHEDULE_ROLES = OPERATIONAL_ADMIN_ROLES;

function masterAppointmentItem(
  overrides: Partial<Extract<ScheduleMonthCellItem, { kind: "appointment" }>> & {
    masterNote?: string | null;
  } = {},
): Extract<ScheduleMonthCellItem, { kind: "appointment" }> {
  return {
    kind: "appointment",
    id: overrides.id ?? "appt-1",
    serviceId: overrides.serviceId ?? "service-1",
    startsAt: overrides.startsAt ?? "2026-07-27T09:00:00.000Z",
    endsAt: overrides.endsAt ?? "2026-07-27T10:00:00.000Z",
    clientName: overrides.clientName ?? "Клиент",
    serviceName: overrides.serviceName ?? "Стрижка",
    isBold: overrides.isBold ?? false,
    isManualTimeOverride: overrides.isManualTimeOverride ?? false,
    status: overrides.status ?? "Подтверждена",
    source: overrides.source ?? "Онлайн",
    statusCode: overrides.statusCode ?? "CONFIRMED",
    sourceCode: overrides.sourceCode ?? "ONLINE",
    promotionLabels: overrides.promotionLabels ?? [],
    masterNote:
      overrides.masterNote === undefined ? "VIP (тест)" : overrides.masterNote,
  };
}

function operationalAppointmentItem(
  importantNote: string | null,
): Extract<ScheduleMonthCellItem, { kind: "appointment" }> {
  return {
    kind: "appointment",
    id: "appt-op",
    serviceId: "service-1",
    startsAt: "2026-07-27T09:00:00.000Z",
    endsAt: "2026-07-27T10:00:00.000Z",
    clientName: "Клиент",
    serviceName: "Стрижка",
    isBold: false,
    isManualTimeOverride: false,
    status: "Подтверждена",
    source: "Онлайн",
    statusCode: "CONFIRMED",
    sourceCode: "ONLINE",
    clientPhone: "+79001234567",
    comment: "внутр",
    importantNote,
    appliedPromotions: [],
    clientId: null,
  };
}

function runMapperTests(): void {
  const promotionLabels = buildPromotionLabels([
    { type: "DISCOUNT", label: "−30% на первое посещение", value: 30 },
    { type: "GIFT_SERVICE", label: "уход для рук", value: null },
  ]);

  assert.equal(promotionLabels.length, 2);
  assert.match(promotionLabels[0], /Акция:/);
  assert.match(promotionLabels[1], /Подарок:/);

  const master = masterAppointmentItem({
    masterNote: "Индивидуальная скидка 15% от студии",
    promotionLabels,
  });

  assert.equal(collectForbiddenMasterAppointmentKeys(master).length, 0);
  assertMasterAppointmentShape(master);
  assert.equal(isMasterScheduleAppointment(master), true);
  assert.equal(isOperationalScheduleAppointment(master), false);

  const viewOnly = {
    id: master.id,
    serviceId: master.serviceId,
    startsAt: master.startsAt,
    endsAt: master.endsAt,
    clientName: master.clientName,
    serviceName: master.serviceName,
    isBold: master.isBold,
    isManualTimeOverride: master.isManualTimeOverride,
    status: master.status,
    source: master.source,
    statusCode: master.statusCode,
    sourceCode: master.sourceCode,
  };

  assert.equal(collectForbiddenViewOnlyAppointmentKeys(viewOnly).length, 0);
  assertRestrictedAppointmentShape(viewOnly);
  assert.equal(isMasterScheduleAppointment(viewOnly), false);
}

function runMasterNoteTeamVisibilityRuntimeTests(): void {
  // 1–2 OWNER/MANAGER operational notes in month cell line
  const ownerLine = formatMonthCellLine(
    operationalAppointmentItem("Пометка OWNER"),
  );
  assert.equal(ownerLine.hasMasterNote, true);
  assert.equal(ownerLine.masterNote, "Пометка OWNER");

  const managerLine = formatMonthCellLine(
    operationalAppointmentItem("Пометка MANAGER"),
  );
  assert.equal(managerLine.hasMasterNote, true);
  assert.equal(managerLine.masterNote, "Пометка MANAGER");

  // 3–6 MASTER sees masterNote for own and other masters' appointments equally
  const ownNote = "VIP свой мастер";
  const otherNote = "VIP чужой мастер";
  const ownLine = formatMonthCellLine(
    masterAppointmentItem({ id: "own", masterNote: ownNote }),
  );
  const otherLine = formatMonthCellLine(
    masterAppointmentItem({ id: "other", masterNote: otherNote }),
  );
  assert.equal(ownLine.masterNote, ownNote);
  assert.equal(otherLine.masterNote, otherNote);

  const masterAPayload = [
    masterAppointmentItem({ id: "a1", masterNote: ownNote }),
    masterAppointmentItem({ id: "b1", masterNote: otherNote }),
  ].map((item) => formatMonthCellLine(item).masterNote);
  const masterBPayload = [
    masterAppointmentItem({ id: "a1", masterNote: ownNote }),
    masterAppointmentItem({ id: "b1", masterNote: otherNote }),
  ].map((item) => formatMonthCellLine(item).masterNote);
  assert.deepEqual(masterAPayload, masterBPayload);
  assert.deepEqual(masterAPayload, [ownNote, otherNote]);

  assert.equal(scheduleLoadOptionsForRole("MASTER").appointmentVisibility, "master");
  assert.equal(
    scheduleLoadOptionsForRole("OWNER").appointmentVisibility,
    "operational",
  );
  assert.equal(
    scheduleLoadOptionsForRole("MANAGER").appointmentVisibility,
    "operational",
  );

  // Existing DB importantNote → masterNote without migration/resave
  assert.equal(normalizeMasterNote("VIP (тест)"), "VIP (тест)");
  assert.equal(normalizeMasterNote("  Важная пометка (тест)  "), "Важная пометка (тест)");

  // 7 Note renders inside cell markup without requiring an open handler
  const cellWithNote = renderToStaticMarkup(
    React.createElement(ScheduleMonthCell, {
      items: [masterAppointmentItem({ masterNote: "В ячейке сразу" })],
      cellTestId: "cell-with-note",
    }),
  );
  assert.match(cellWithNote, /Пометка для мастера/);
  assert.match(cellWithNote, /В ячейке сразу/);
  assert.doesNotMatch(cellWithNote, /role="button"/);
  assert.doesNotMatch(cellWithNote, /cursor-pointer/);
  assert.doesNotMatch(cellWithNote, /Открыть быстрый редактор/);

  // 8 Empty note → no visual block
  assert.equal(normalizeMasterNote(""), null);
  assert.equal(normalizeMasterNote("   "), null);
  const emptyLine = formatMonthCellLine(
    masterAppointmentItem({ masterNote: "   " }),
  );
  assert.equal(emptyLine.hasMasterNote, false);
  assert.equal(emptyLine.masterNote, null);
  const emptyBlock = renderToStaticMarkup(
    React.createElement(AppointmentMasterNoteBlock, { note: "   " }),
  );
  assert.equal(emptyBlock, "");
  const emptyCell = renderToStaticMarkup(
    React.createElement(ScheduleMonthCell, {
      items: [masterAppointmentItem({ masterNote: null })],
    }),
  );
  assert.doesNotMatch(emptyCell, /Пометка для мастера/);

  // 9–12 MASTER cells are fully inert (no open handler)
  assert.equal(canManageFullSchedule("MASTER"), false);
  assert.equal(canManageFullSchedule("OWNER"), true);
  assert.equal(canManageFullSchedule("MANAGER"), true);

  const inertEmpty = renderToStaticMarkup(
    React.createElement(ScheduleMonthCell, {
      items: [],
      cellTestId: "master-inert-empty",
    }),
  );
  assert.doesNotMatch(inertEmpty, /role="button"/);
  assert.doesNotMatch(inertEmpty, /cursor-pointer/);
  assert.doesNotMatch(inertEmpty, /tabindex/i);
  assert.doesNotMatch(inertEmpty, /Открыть/);

  const inertFilled = renderToStaticMarkup(
    React.createElement(ScheduleMonthCell, {
      items: [masterAppointmentItem({ masterNote: otherNote })],
      cellTestId: "master-inert-filled",
    }),
  );
  assert.doesNotMatch(inertFilled, /role="button"/);
  assert.doesNotMatch(inertFilled, /cursor-pointer/);
  assert.doesNotMatch(inertFilled, /tabindex/i);

  // OWNER/MANAGER interactive cell still wires open affordances when onOpen set
  let opened = 0;
  const interactive = renderToStaticMarkup(
    React.createElement(ScheduleMonthCell, {
      items: [operationalAppointmentItem("Заметка")],
      onOpen: () => {
        opened += 1;
      },
      cellTestId: "owner-interactive",
    }),
  );
  assert.match(interactive, /role="button"/);
  assert.match(interactive, /cursor-pointer/);
  assert.match(interactive, /Пометка для мастера/);
  assert.equal(opened, 0);

  // 13–14 No write roles / PATCH route stays WRITE_SCHEDULE_ROLES only
  assert.ok(!WRITE_SCHEDULE_ROLES.includes("MASTER"));
  assert.ok(WRITE_SCHEDULE_ROLES.includes("OWNER"));
  assert.ok(WRITE_SCHEDULE_ROLES.includes("MANAGER"));
  const appointmentsPatch = fs.readFileSync(
    path.join(ROOT, "src/app/api/appointments/[id]/route.ts"),
    "utf8",
  );
  assert.match(appointmentsPatch, /WRITE_SCHEDULE_ROLES/);
  assert.doesNotMatch(
    appointmentsPatch.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
    /MASTER/,
  );

  // 15 Forbidden contact keys stay off MASTER DTO
  const masterDto = masterAppointmentItem({ masterNote: "ok" });
  for (const key of FORBIDDEN_MASTER_APPOINTMENT_KEYS) {
    assert.equal(key in masterDto, false, `MASTER DTO must not expose ${key}`);
  }

  // 16 Navigation surfaces remain for MASTER (view switcher / scroll containers)
  const monthView = fs.readFileSync(
    path.join(ROOT, "src/components/schedule/schedule-month-view.tsx"),
    "utf8",
  );
  assert.match(monthView, /ScheduleViewSwitcher/);
  assert.match(monthView, /ScheduleMonthTable/);
  const monthTable = fs.readFileSync(
    path.join(ROOT, "src/components/schedule/schedule-month-table.tsx"),
    "utf8",
  );
  assert.match(monthTable, /schedule-month-table-scroll/);

  // 17 OWNER/MANAGER still receive onCellOpen when canEdit
  assert.match(monthView, /onCellOpen=\{\s*\n?\s*canEdit/);
  assert.match(monthView, /canManageFullSchedule/);

  // Length / plain-text constraints
  assert.equal(
    validateMasterNote("x".repeat(MASTER_NOTE_MAX_LENGTH + 1)),
    `Пометка для мастера не может быть длиннее ${MASTER_NOTE_MAX_LENGTH} символов.`,
  );
  const noteHtml = renderToStaticMarkup(
    React.createElement(AppointmentMasterNoteBlock, {
      note: "<b>не HTML</b>",
    }),
  );
  assert.match(noteHtml, /&lt;b&gt;не HTML&lt;\/b&gt;/);
}

function runMasterNoteValidationTests(): void {
  assert.equal(validateMasterNote("Стоимость согласована: 3 500 ₽"), null);
  assert.equal(validateMasterNote("Индивидуальная скидка 15%"), null);
  assert.equal(validateMasterNote("Оплата по сертификату, кабинет 7"), null);

  assert.equal(
    validateMasterNote("Позвонить +7 900 123-45-67"),
    MASTER_NOTE_VALIDATION_ERROR,
  );
  assert.equal(
    validateMasterNote("Написать client@example.com"),
    MASTER_NOTE_VALIDATION_ERROR,
  );
}

function runPublicBookingRequestTests(): void {
  const response = toPublicBookingRequestCreateResponse({ id: "req-test-001" });
  assert.equal(response.ok, true);
  assert.equal(response.requestId, "req-test-001");
  assert.match(response.message, /Заявка отправлена/);

  const forbidden = collectForbiddenPublicBookingRequestKeys(
    response as unknown as Record<string, unknown>,
  );
  assert.deepEqual(forbidden, []);
}

function runHealthTests(): void {
  const success = buildHealthSuccessResponse("2026-07-06T12:00:00.000Z");
  assert.equal(success.ok, true);
  assert.equal("database" in success, false);

  const productionError = buildHealthErrorResponse(
    true,
    "2026-07-06T12:00:00.000Z",
    new Error("Can't reach database server at postgres://user:pass@db:5432/app"),
  );
  assert.equal(productionError.ok, false);
  assert.equal("detail" in productionError, false);
}

function main(): void {
  runMapperTests();
  runMasterNoteTeamVisibilityRuntimeTests();
  runMasterNoteValidationTests();
  runPublicBookingRequestTests();
  runHealthTests();
  console.log("security-batch1-check: all assertions passed");
}

main();
