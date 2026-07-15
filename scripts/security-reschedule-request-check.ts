/**
 * Проверка сценария клиентского запроса на перенос записи.
 * Без БД: unit + статический аудит схемы, сервиса и UI-маркеров.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getBookingRequestTypeLabel,
  getBookingRequestStatusLabel,
} from "../src/lib/booking-requests/booking-request-contract";
import { CLIENT_RESCHEDULE_APPOINTMENT_NOTICE } from "../src/lib/schedule/client-reschedule-notice";
import {
  getScheduleBookingRequestShortSourceLabel,
  getScheduleBookingRequestSourceLabel,
  toMasterScheduleBookingRequest,
  type FullScheduleBookingRequestDto,
} from "../src/lib/schedule/booking-request-schedule";
import {
  isBlockingAppointmentStatus,
  NON_BLOCKING_APPOINTMENT_STATUSES,
} from "../src/lib/schedule/non-blocking-appointment-statuses";
import {
  collectForbiddenMasterAppointmentKeys,
  FORBIDDEN_MASTER_APPOINTMENT_KEYS,
} from "../src/lib/schedule/appointment-contract";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function assertRescheduledFreesSlot(): void {
  assert.ok(NON_BLOCKING_APPOINTMENT_STATUSES.includes("RESCHEDULED"));
  assert.equal(isBlockingAppointmentStatus("RESCHEDULED"), false);
  assert.equal(isBlockingAppointmentStatus("SCHEDULED"), true);
  assert.equal(isBlockingAppointmentStatus("CONFIRMED"), true);
  assert.equal(isBlockingAppointmentStatus("CANCELLED"), false);
}

function assertLabels(): void {
  assert.equal(getBookingRequestTypeLabel("RESCHEDULE_REQUEST"), "Перенос записи");
  assert.equal(
    getBookingRequestTypeLabel("MANAGER_REQUEST"),
    "Заявка через менеджера",
  );
  assert.equal(getBookingRequestTypeLabel("CONSULTATION_REQUEST"), "Консультация");
  assert.equal(getBookingRequestStatusLabel("NEW"), "Новая");

  assert.equal(
    getScheduleBookingRequestSourceLabel({
      type: "RESCHEDULE_REQUEST",
      isFromGame: false,
    }),
    "Перенос записи",
  );
  assert.equal(
    getScheduleBookingRequestShortSourceLabel({
      type: "RESCHEDULE_REQUEST",
      isFromGame: false,
    }),
    "Перенос",
  );
  assert.equal(
    getScheduleBookingRequestSourceLabel({
      type: "MANAGER_REQUEST",
      isFromGame: false,
    }),
    "Онлайн-запись",
  );
  assert.equal(
    getScheduleBookingRequestSourceLabel({
      type: "CONSULTATION_REQUEST",
      isFromGame: false,
    }),
    "Консультация",
  );
}

function assertMasterSanitization(): void {
  const full: FullScheduleBookingRequestDto = {
    id: "req-1",
    createdAt: "2026-07-15T10:00:00.000Z",
    clientName: "Анна",
    clientPhone: "+79001112233",
    comment: "Удобно после 18:00",
    status: "NEW",
    type: "RESCHEDULE_REQUEST",
    isFromGame: false,
    masterName: "Мастер",
    appointmentId: "appt-1",
    appointmentStartsAt: "2026-07-20T12:00:00.000Z",
    appointmentServiceName: "Массаж",
    appointmentScheduleHref: "/schedule?view=day&date=2026-07-20",
  };

  const sanitized = toMasterScheduleBookingRequest(full);
  assert.equal("clientPhone" in sanitized, false);
  assert.equal("comment" in sanitized, false);
  assert.equal("email" in sanitized, false);
  assert.equal(sanitized.clientName, "Анна");
  assert.equal(sanitized.type, "RESCHEDULE_REQUEST");
  assert.equal(sanitized.appointmentServiceName, "Массаж");
  assert.equal(sanitized.appointmentId, "appt-1");
  assert.equal(
    sanitized.appointmentScheduleHref,
    "/schedule?view=day&date=2026-07-20",
  );

  assert.ok(
    CLIENT_RESCHEDULE_APPOINTMENT_NOTICE.includes("перенос"),
    "текст пометки должен упоминать перенос",
  );
  assert.doesNotMatch(CLIENT_RESCHEDULE_APPOINTMENT_NOTICE, /\+7|@|email|телефон/i);

  const masterAppointment = {
    id: "a1",
    startsAt: "2026-07-20T12:00:00.000Z",
    endsAt: "2026-07-20T13:00:00.000Z",
    clientName: "Анна",
    serviceName: "Массаж",
    isBold: false,
    isManualTimeOverride: false,
    status: "Перенесена",
    source: "Онлайн",
    statusCode: "RESCHEDULED" as const,
    sourceCode: "ONLINE" as const,
    promotionLabels: [] as string[],
    masterNote: null as string | null,
  };
  assert.equal(collectForbiddenMasterAppointmentKeys(masterAppointment).length, 0);
  for (const key of FORBIDDEN_MASTER_APPOINTMENT_KEYS) {
    assert.equal(key in masterAppointment, false, `MASTER DTO не должен содержать ${key}`);
  }
}

function assertSchemaAndMigration(): void {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /enum BookingRequestType[\s\S]*RESCHEDULE_REQUEST/);
  assert.match(schema, /appointmentId\s+String\?\s+@map\("appointment_id"\)/);
  assert.match(schema, /rescheduleRequests\s+BookingRequest\[\]/);

  const migration = read(
    "prisma/migrations/20260715180000_booking_request_reschedule/migration.sql",
  );
  assert.match(migration, /ADD VALUE 'RESCHEDULE_REQUEST'/);
  assert.match(migration, /ADD COLUMN "appointment_id"/);
  assert.match(migration, /REFERENCES "appointments"\("id"\)/);
}

function assertManageServiceTransaction(): void {
  const src = stripComments(read("src/services/BookingManageService.ts"));
  assert.match(src, /export async function requestRescheduleByManageToken/);
  assert.match(src, /\$transaction/);
  assert.match(src, /status:\s*"RESCHEDULED"/);
  assert.match(src, /rescheduleRequestText/);
  assert.match(src, /rescheduleRequestedAt/);
  assert.match(src, /type:\s*"RESCHEDULE_REQUEST"/);
  assert.match(src, /appointmentId:\s*appointment\.id/);
  assert.match(src, /bookingRequest\.findFirst/);
  assert.match(src, /bookingRequest\.update/);
  assert.match(src, /bookingRequest\.create/);
}

function assertPublicApiRejectsRescheduleType(): void {
  const route = stripComments(read("src/app/api/booking/request/route.ts"));
  assert.match(route, /MANAGER_REQUEST/);
  assert.match(route, /CONSULTATION_REQUEST/);
  assert.doesNotMatch(
    route,
    /body\.type\s*!==\s*"RESCHEDULE_REQUEST"|type\s*===\s*"RESCHEDULE_REQUEST"/,
  );
  assert.ok(
    !route.includes('"RESCHEDULE_REQUEST"'),
    "публичный /api/booking/request не должен принимать RESCHEDULE_REQUEST",
  );
}

function assertUiMarkers(): void {
  const notice = CLIENT_RESCHEDULE_APPOINTMENT_NOTICE;
  const card = read("src/components/schedule/appointment-card.tsx");
  assert.match(card, /CLIENT_RESCHEDULE_APPOINTMENT_NOTICE/);
  assert.match(card, /statusCode === "RESCHEDULED"/);

  const panel = read("src/components/admin/booking-requests-panel.tsx");
  assert.match(panel, /RescheduleContextCell/);
  assert.match(panel, /Исходная запись/);
  assert.match(panel, /Открыть день в расписании/);

  const requestCard = read("src/components/schedule/schedule-booking-request-card.tsx");
  assert.match(requestCard, /BookingRequestAppointmentContext/);
  assert.match(requestCard, /Прежние дата и время/);
  assert.match(requestCard, /Открыть исходный день в расписании/);

  const monthCell = read("src/components/schedule/schedule-month-cell.tsx");
  assert.match(monthCell, /rescheduleNotice/);

  assert.equal(
    notice,
    "Клиент запросил перенос. На прежнее время не придёт.",
  );
}

function assertBookingRequestServiceMapsAppointment(): void {
  const src = stripComments(read("src/services/BookingRequestService.ts"));
  assert.match(src, /appointment:\s*\{[\s\S]*startsAt[\s\S]*service/);
  assert.match(src, /appointmentScheduleHref/);
  assert.match(src, /appointmentServiceName/);
  assert.match(src, /toMasterScheduleBookingRequest/);
}

function main(): void {
  assertRescheduledFreesSlot();
  assertLabels();
  assertMasterSanitization();
  assertSchemaAndMigration();
  assertManageServiceTransaction();
  assertPublicApiRejectsRescheduleType();
  assertUiMarkers();
  assertBookingRequestServiceMapsAppointment();

  console.log("security-reschedule-request-check: OK");
}

main();
