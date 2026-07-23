/**
 * Регрессия: COMPLETED → CRM client link, suggest privacy, UI persistence,
 * public/MASTER DTO boundary + optional Prisma/PostgreSQL integration suite.
 *
 * DB suite требует явный opt-in:
 *   RUN_APPOINTMENT_CLIENT_LINK_DB_TESTS=1
 *   DB_TEST_TARGET=staging
 * Без opt-in печатает SKIPPED (не считается успехом DB-proof).
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  classifyClientPhone,
  isUsableClientPhone,
  TECHNICAL_NORMALIZED_PHONES,
} from "../src/lib/phone/usable-client-phone";
import {
  normalizePhone,
  resolveClientPhoneMatchKey,
} from "../src/lib/phone/normalize-phone";
import { APPOINTMENT_CLIENT_SOURCE_LABELS } from "../src/types/appointment-client-link";
import {
  FORBIDDEN_MASTER_APPOINTMENT_KEYS,
  collectForbiddenMasterAppointmentKeys,
} from "../src/lib/schedule/appointment-contract";
import {
  WRITE_SCHEDULE_ROLES,
  CLIENTS_ADMIN_ROLES,
} from "../src/lib/auth/api-access";
import {
  clientLinkRetryButtonLabel,
  describeClientLinkActionMessage,
  resolveNextClientLinkUiState,
  shouldOfferClientLinkRetry,
} from "../src/lib/schedule/client-link-ui";

const ROOT = process.cwd();

type DbOutcome = "PASSED" | "SKIPPED";

const dbOutcomes: Array<{ name: string; outcome: DbOutcome; detail?: string }> =
  [];

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function testPhoneUsability(): void {
  assert.equal(isUsableClientPhone("+79001234567"), true);
  assert.equal(isUsableClientPhone("+70000000000"), false);
  assert.equal(
    classifyClientPhone("+70000000000").ok === false &&
      classifyClientPhone("+70000000000").reason,
    "technical",
  );
  assert.equal(normalizePhone("+70000000000"), "70000000000");
  assert.ok(TECHNICAL_NORMALIZED_PHONES.has("70000000000"));
  assert.equal(isUsableClientPhone(""), false);
  assert.equal(isUsableClientPhone("+7111"), false);
  assert.equal(isUsableClientPhone(null), false);
}

function testPhoneMatchKey(): void {
  const local = resolveClientPhoneMatchKey("+79001234567");
  const foreignPrefix = resolveClientPhoneMatchKey("+179001234567");
  assert.equal(local, "9001234567");
  assert.equal(foreignPrefix, "9001234567");
  assert.equal(local, foreignPrefix);
  assert.equal(resolveClientPhoneMatchKey("+70000000000"), "0000000000");
  assert.equal(resolveClientPhoneMatchKey(""), null);
  assert.equal(resolveClientPhoneMatchKey(null), null);
}

function testSourceLabelsDistinct(): void {
  assert.equal(APPOINTMENT_CLIENT_SOURCE_LABELS.ONLINE, "Онлайн-запись");
  assert.equal(APPOINTMENT_CLIENT_SOURCE_LABELS.INTERNAL, "Ручная запись");
  assert.equal(APPOINTMENT_CLIENT_SOURCE_LABELS.PHONE, "Телефон");
  assert.equal(APPOINTMENT_CLIENT_SOURCE_LABELS.BOT, "Бот");
  assert.equal(APPOINTMENT_CLIENT_SOURCE_LABELS.OTHER, "Другое");
}

function testServiceWiring(): void {
  const service = stripSource(read("src/services/AppointmentService.ts"));
  assert.match(service, /syncCompletedAppointmentClientLink/);
  assert.match(
    service,
    /becameCompleted[\s\S]*existing\.status !== "COMPLETED"[\s\S]*appointment\.status === "COMPLETED"/,
  );
  assert.match(service, /retryClientLink/);
  assert.match(
    service,
    /Object\.prototype\.hasOwnProperty\.call\([\s\S]*?"clientId"[\s\S]*?\)/,
  );
  assert.match(service, /hasClientIdChange/);
  assert.match(service, /hasExplicitClientConnect/);
  assert.match(
    service,
    /appointment\.status === "COMPLETED" && hasExplicitClientConnect/,
  );
  assert.match(
    service,
    /assertLinkableClientForAppointment\([\s\S]*?,\s*tx\)/,
  );
  assert.match(service, /export type OperationalAppointmentDto/);
  assert.match(
    service,
    /export type AppointmentDto = \{[\s\S]*?\};[\s\S]*OperationalAppointmentDto/,
  );
  const dtoMatch = service.match(/export type AppointmentDto = \{([^}]+)\}/);
  assert.ok(dtoMatch, "AppointmentDto type missing");
  assert.doesNotMatch(dtoMatch[1]!, /clientId/);
  assert.match(service, /clientId: appointment\.clientId \?\? null/);
  assert.doesNotMatch(
    service,
    /appendDuplicateNote|DUPLICATE_COMMENT_PREFIX|\[CRM:/,
  );

  const linkService = stripSource(
    read("src/services/AppointmentClientLinkService.ts"),
  );
  assert.match(linkService, /pg_advisory_xact_lock/);
  assert.match(linkService, /hashtext\(\$\{matchKey\}\)/);
  assert.match(linkService, /resolveClientPhoneMatchKey/);
  assert.match(linkService, /status:\s*"ACTIVE"/);
  assert.match(
    linkService,
    /client\.status === "NEW" \|\| client\.status === "INACTIVE"/,
  );
  assert.doesNotMatch(linkService, /status === "BLOCKED"[\s\S]*ACTIVE/);
  assert.doesNotMatch(
    linkService,
    /name_duplicate|findClientsByNormalizedFullName/,
  );
  assert.match(
    linkService,
    /export async function assertLinkableClientForAppointment\([\s\S]*db:\s*ClientLookupDb/,
  );

  const phoneLib = stripSource(read("src/lib/phone/usable-client-phone.ts"));
  assert.match(phoneLib, /70000000000/);
  const normalizeLib = stripSource(read("src/lib/phone/normalize-phone.ts"));
  assert.match(normalizeLib, /resolveClientPhoneMatchKey/);
}

function testApiContracts(): void {
  const patch = stripSource(read("src/app/api/appointments/[id]/route.ts"));
  assert.match(patch, /clientLink:\s*result\.clientLink/);
  assert.match(patch, /retryClientLink/);

  const post = stripSource(read("src/app/api/appointments/route.ts"));
  assert.match(post, /clientLink:\s*result\.clientLink/);

  const suggest = stripSource(
    read("src/app/api/admin/clients/suggest/route.ts"),
  );
  assert.match(suggest, /CLIENTS_ADMIN_ROLES/);
  assert.match(suggest, /mode === "name" && q\.length < 2/);
  assert.match(suggest, /mode === "phone" && q\.replace\(/);
  assert.match(suggest, /length < 4/);
  assert.doesNotMatch(suggest, /notes|bonusBalance|totalSpent|mergeNote/);
}

function testMasterAndPublicPrivacy(): void {
  assert.ok(FORBIDDEN_MASTER_APPOINTMENT_KEYS.includes("clientId"));
  assert.ok(!WRITE_SCHEDULE_ROLES.includes("MASTER"));
  assert.ok(!CLIENTS_ADMIN_ROLES.includes("MASTER"));

  const forbidden = collectForbiddenMasterAppointmentKeys({
    clientPhone: "x",
    clientId: "y",
  });
  assert.ok(forbidden.includes("clientPhone"));
  assert.ok(forbidden.includes("clientId"));

  const mapSource = stripSource(
    read("src/lib/schedule/map-schedule-appointment.ts"),
  );
  assert.match(
    mapSource,
    /mapScheduleDayAppointmentOperational[\s\S]*clientId:\s*appointment\.clientId/,
  );
  const masterFnStart = mapSource.indexOf(
    "export function mapScheduleDayAppointmentMaster",
  );
  const operationalFnStart = mapSource.indexOf(
    "export function mapScheduleDayAppointmentOperational",
  );
  assert.ok(masterFnStart >= 0 && operationalFnStart > masterFnStart);
  const masterFn = mapSource.slice(masterFnStart, operationalFnStart);
  assert.doesNotMatch(masterFn, /clientId/);

  const bookingCreate = stripSource(
    read("src/app/api/booking/create/route.ts"),
  );
  assert.match(bookingCreate, /function toPublicCreatedAppointment/);
  const publicMapper = bookingCreate.slice(
    bookingCreate.indexOf("function toPublicCreatedAppointment"),
    bookingCreate.indexOf("function errorResponse"),
  );
  assert.doesNotMatch(publicMapper, /clientId|clientLink|candidates/);
  assert.doesNotMatch(publicMapper, /\bphone\b/);

  const manageView = stripSource(
    read("src/services/BookingManageService.ts"),
  );
  const viewType = manageView.match(
    /export type PublicManageAppointmentView = \{([^}]+)\}/,
  );
  assert.ok(viewType);
  assert.doesNotMatch(viewType[1]!, /clientId|clientLink|candidates|phone/);
}

function testUiExplicitPersistenceContract(): void {
  const form = stripSource(
    read("src/components/schedule/appointment-editor-form.tsx"),
  );

  assert.match(form, /persistClientLinkAction/);
  assert.match(
    form,
    /const applyPickedClient = \(client: ClientSuggestItem\) => \{\s*void persistClientLinkAction\(/,
  );
  assert.match(
    form,
    /const clearClientLink = \(\) => \{\s*void persistClientLinkAction\(\{\s*clientId:\s*null\s*\}\)/,
  );
  assert.match(form, /duplicateCandidates\.map[\s\S]*applyPickedClient\(/);
  assert.match(
    form,
    /persistClientLinkAction[\s\S]*clearPendingSave\(\)/,
  );
  assert.match(
    form,
    /const payloadBody: Record<string, unknown> = \{\s*clientId: action\.clientId,/,
  );
  assert.match(form, /body: JSON\.stringify\(payloadBody\)/);
  assert.match(form, /linkActionGenerationRef/);
  assert.match(form, /linkActionInFlightRef/);
  assert.match(
    form,
    /generationAtStart !== linkActionGenerationRef\.current/,
  );
  assert.match(form, /linkActionInFlightRef\.current/);
  assert.doesNotMatch(
    form,
    /clientId:\s*selectedClientId\s*\?\?\s*operationalClientId/,
  );
  assert.match(
    form,
    /describeClientLinkUi\(\{\s*statusCode: form\.status,\s*clientId: selectedClientId,/,
  );
  // Выбор не зависит от blur: persist вызывается напрямую из onPick
  assert.match(form, /onPick=\{applyPickedClient\}/);
  assert.match(form, /retryClientLink:\s*true/);
  assert.match(form, /ClientSuggestField/);
  assert.match(form, /\{retryButtonLabel\}/);
  assert.match(
    form,
    /if \(clientLinkDirtyRef\.current\) \{\s*payloadBody\.clientId = selectedClientIdRef\.current;/,
  );

  // Source of truth меняется только после response.ok (не до PATCH).
  const persistStart = form.indexOf(
    "const persistClientLinkAction = useCallback",
  );
  assert.ok(persistStart >= 0);
  const persistFn = form.slice(
    persistStart,
    form.indexOf("const applyPickedClient"),
  );
  const okIdx = persistFn.indexOf("if (!response.ok)");
  const setSelectedAfterOk = persistFn.indexOf(
    "setSelectedClientId(action.clientId)",
    okIdx,
  );
  assert.ok(okIdx >= 0, "persist must check response.ok");
  assert.ok(
    setSelectedAfterOk > okIdx,
    "final selectedClientId must change only after response.ok",
  );
  assert.doesNotMatch(
    persistFn.slice(0, okIdx),
    /setSelectedClientId\(action\.clientId\)/,
  );
  assert.doesNotMatch(
    persistFn.slice(0, okIdx),
    /setLinkBanner\(\s*"Клиент не связан"/,
  );
  assert.match(form, /Сохраняем связь…/);
  assert.match(form, /disabled=\{!canEdit \|\| isLinkActionPending\}/);
  assert.match(form, /disabled=\{isLinkActionPending\}/);
  assert.match(form, /Связь сохранена, но не удалось обновить список/);

  // Partial success CRM-sync: retry available with existing clientId.
  assert.match(form, /lastClientLinkResult/);
  assert.match(form, /shouldOfferClientLinkRetry/);
  assert.match(form, /describeClientLinkActionMessage/);
  assert.match(form, /from "@\/lib\/schedule\/client-link-ui"/);
  assert.match(form, /showClientLinkRetry \? \(/);
  assert.match(form, /retryButtonLabel/);
  assert.doesNotMatch(
    form,
    /form\.status === "COMPLETED" && !selectedClientId \? \(/,
  );

  const retryStart = form.indexOf("const handleRetryClientLink = async");
  assert.ok(retryStart >= 0);
  const retryFn = form.slice(
    retryStart,
    form.indexOf("// selectedClientId — source of truth"),
  );
  const retryOkIdx = retryFn.indexOf("if (!response.ok)");
  const setLastAfterOk = retryFn.indexOf(
    "setLastClientLinkResult(nextLinkUi.lastResult)",
    retryOkIdx,
  );
  const onSavedIdx = retryFn.indexOf("await onSaved()", retryOkIdx);
  assert.ok(retryOkIdx >= 0);
  assert.ok(
    setLastAfterOk > retryOkIdx,
    "successful PATCH result fixed before onSaved",
  );
  assert.ok(onSavedIdx > setLastAfterOk);
  assert.match(
    retryFn,
    /Синхронизация выполнена, но не удалось обновить список/,
  );
  assert.match(retryFn, /setError\(null\)/);

  // MASTER / view-only early return must not render CRM retry UI.
  assert.match(form, /\{canEdit \? \([\s\S]*showClientLinkRetry/);
  const readOnlyIdx = form.indexOf("if (!canEdit) {");
  assert.ok(readOnlyIdx >= 0);
  const readOnlyEnd = form.indexOf("}", form.indexOf("AppointmentMasterNoteBlock", readOnlyIdx));
  assert.ok(readOnlyEnd > readOnlyIdx);
  // Rough early-return window: before the editable article form fields.
  const editableNameField = form.indexOf('field="clientName"', readOnlyIdx);
  assert.ok(editableNameField > readOnlyIdx);
  const readOnlySlice = form.slice(readOnlyIdx, editableNameField);
  assert.doesNotMatch(
    readOnlySlice,
    /showClientLinkRetry|Повторить синхронизацию|resolveNextClientLinkUiState/,
  );

  assert.match(form, /resolveNextClientLinkUiState/);
  assert.match(form, /incoming: payload\.clientLink/);
  assert.match(form, /payload\.clientLink\.status !== "not_applicable"/);
  assert.match(form, /identityChanged:\s*true/);
  assert.match(form, /clearedByDisconnect:\s*action\.clientId === null/);
  assert.doesNotMatch(
    form,
    /if \(payload\.clientLink\) \{\s*setLastClientLinkResult\(payload\.clientLink\)/,
  );
  assert.doesNotMatch(
    form,
    /else if \(payload\.clientLink\) \{\s*setDuplicateCandidates\(\[\]\)/,
  );
}

function testClientLinkUiHelpers(): void {
  assert.equal(
    describeClientLinkActionMessage({
      clientLink: { status: "error", message: "x" },
      clientId: "c1",
    }),
    "Клиент связан, но данные визита не обновлены",
  );
  assert.equal(
    describeClientLinkActionMessage({
      clientLink: { status: "error", message: "x" },
      clientId: null,
    }),
    "Не удалось привязать клиента",
  );
  assert.equal(
    shouldOfferClientLinkRetry({
      statusCode: "COMPLETED",
      clientId: "c1",
      lastClientLink: { status: "error", message: "x" },
    }),
    true,
  );
  assert.equal(
    shouldOfferClientLinkRetry({
      statusCode: "COMPLETED",
      clientId: "c1",
      lastClientLink: { status: "already_linked", clientId: "c1" },
    }),
    false,
  );
  assert.equal(
    shouldOfferClientLinkRetry({
      statusCode: "COMPLETED",
      clientId: null,
      lastClientLink: null,
    }),
    true,
  );
  assert.equal(
    clientLinkRetryButtonLabel({
      clientId: "c1",
      lastClientLink: { status: "error", message: "x" },
    }),
    "Повторить синхронизацию",
  );
  assert.equal(
    clientLinkRetryButtonLabel({
      clientId: null,
      lastClientLink: { status: "error", message: "x" },
    }),
    "Повторить привязку",
  );

  const errorPrev = {
    lastResult: { status: "error" as const, message: "sync failed" },
    candidates: [] as [],
  };
  const keptError = resolveNextClientLinkUiState({
    previous: errorPrev,
    incoming: { status: "not_applicable" },
  });
  assert.equal(keptError.lastResult?.status, "error");
  assert.equal(
    shouldOfferClientLinkRetry({
      statusCode: "COMPLETED",
      clientId: "c1",
      lastClientLink: keptError.lastResult,
    }),
    true,
  );

  const dupCandidates = [
    {
      id: "a",
      fullName: "A",
      phone: "+79001112233",
      status: "ACTIVE" as const,
    },
    {
      id: "b",
      fullName: "B",
      phone: "+79001112233",
      status: "ACTIVE" as const,
    },
  ];
  const dupPrev = {
    lastResult: {
      status: "duplicate" as const,
      candidates: dupCandidates,
    },
    candidates: dupCandidates,
  };
  const keptDup = resolveNextClientLinkUiState({
    previous: dupPrev,
    incoming: { status: "not_applicable" },
  });
  assert.equal(keptDup.lastResult?.status, "duplicate");
  assert.equal(keptDup.candidates.length, 2);

  const skippedPrev = {
    lastResult: { status: "skipped_invalid_phone" as const },
    candidates: [] as [],
  };
  const keptSkipped = resolveNextClientLinkUiState({
    previous: skippedPrev,
    incoming: { status: "not_applicable" },
  });
  assert.equal(keptSkipped.lastResult?.status, "skipped_invalid_phone");

  const afterSuccess = resolveNextClientLinkUiState({
    previous: errorPrev,
    incoming: { status: "already_linked", clientId: "c1" },
  });
  assert.equal(afterSuccess.lastResult?.status, "already_linked");
  assert.equal(afterSuccess.candidates.length, 0);
  assert.equal(
    shouldOfferClientLinkRetry({
      statusCode: "COMPLETED",
      clientId: "c1",
      lastClientLink: afterSuccess.lastResult,
    }),
    false,
  );

  const afterDisconnect = resolveNextClientLinkUiState({
    previous: dupPrev,
    incoming: null,
    clearedByDisconnect: true,
  });
  assert.equal(afterDisconnect.lastResult, null);
  assert.equal(afterDisconnect.candidates.length, 0);

  const afterPhoneEdit = resolveNextClientLinkUiState({
    previous: dupPrev,
    incoming: null,
    identityChanged: true,
  });
  assert.equal(afterPhoneEdit.lastResult, null);
  assert.equal(afterPhoneEdit.candidates.length, 0);

  const afterMissingIncoming = resolveNextClientLinkUiState({
    previous: errorPrev,
    incoming: undefined,
  });
  assert.equal(afterMissingIncoming.lastResult?.status, "error");
}

function testNoCrmNotesInAppointmentText(): void {
  const linkService = read("src/services/AppointmentClientLinkService.ts");
  assert.doesNotMatch(linkService, /importantNote|comment:\s*`|\[CRM:/);
  const appointmentService = read("src/services/AppointmentService.ts");
  assert.doesNotMatch(
    appointmentService,
    /syncCompleted[\s\S]{0,200}comment:/,
  );
}

function testClientMergeKeepsAppointmentLinks(): void {
  const merge = stripSource(read("src/services/ClientMergeService.ts"));
  assert.match(merge, /appointment\.updateMany|appointments:\s*\{/);
  assert.match(merge, /clientId:\s*targetClientId|clientId:\s*input\.targetClientId/);
}

async function resolveDbSuiteGate(): Promise<
  | { ok: true; prisma: typeof import("../src/lib/db").prisma }
  | { ok: false; reason: string }
> {
  if (!process.env.DATABASE_URL) {
    return { ok: false, reason: "no DATABASE_URL" };
  }
  if (process.env.RUN_APPOINTMENT_CLIENT_LINK_DB_TESTS !== "1") {
    return { ok: false, reason: "explicit staging opt-in required" };
  }
  if (process.env.DB_TEST_TARGET !== "staging") {
    return {
      ok: false,
      reason: "DB_TEST_TARGET must be staging",
    };
  }

  const { prisma } = await import("../src/lib/db");
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return { ok: false, reason: "DB unreachable" };
  }

  console.log("DB integration target: staging");
  return { ok: true, prisma };
}

const phoneRunPrefix = Date.now().toString().slice(-6);
let phoneCounter = 0;
const issuedPhones = new Set<string>();

/** Гарантированно уникальные тестовые телефоны в рамках одного запуска. */
function uniquePhone(seed?: string): string {
  void seed;
  phoneCounter += 1;
  const n = (Number(phoneRunPrefix) * 10_000 + phoneCounter) % 10_000_000;
  const phone = `+7900${String(n).padStart(7, "0")}`;
  assert.ok(
    !issuedPhones.has(phone),
    "uniquePhone must never reuse a generated number",
  );
  issuedPhones.add(phone);
  return phone;
}

function testUniquePhoneGenerator(): void {
  const phones = [
    uniquePhone("09a"),
    uniquePhone("09b"),
    uniquePhone("17a"),
    uniquePhone("17m"),
    uniquePhone("x"),
    uniquePhone("y"),
    uniquePhone("z"),
  ];
  assert.equal(new Set(phones).size, phones.length);
  const norms = phones.map((phone) => {
    assert.ok(isUsableClientPhone(phone), `usable: ${phone}`);
    const normalized = normalizePhone(phone);
    assert.ok(normalized);
    return normalized;
  });
  assert.equal(new Set(norms).size, norms.length);
}

const DB_SCENARIO_NAMES = [
  "db.existing-phone-links",
  "db.no-match-creates",
  "db.status-transitions",
  "db.lastVisit-monotonic",
  "db.technical-and-invalid-phone",
  "db.duplicate-candidates",
  "db.manual-duplicate-resolve",
  "db.completed-disconnect-no-relink",
  "db.same-fio-other-phone",
  "db.idempotent-resync",
  "db.completed-reschedule-completed",
  "db.service-completed-workflow",
  "db.parallel-same-phone",
  "db.parallel-suffix-equivalent",
  "db.manual-create-selected-client",
  "db.manual-patch-connect-disconnect",
  "db.reject-archived-merged",
  "db.autosave-no-create",
  "db.explicit-retry",
  "db.comment-importantNote-clean",
] as const;

function skipAllDbScenarios(reason: string): void {
  for (const name of DB_SCENARIO_NAMES) {
    dbOutcomes.push({ name, outcome: "SKIPPED", detail: reason });
  }
  console.log(
    `security-appointment-completed-client-link-check: DB suite SKIPPED (${reason})`,
  );
}

async function runDbIntegrationSuite(): Promise<void> {
  const probe = await resolveDbSuiteGate();
  if (!probe.ok) {
    skipAllDbScenarios(probe.reason);
    return;
  }

  const { prisma } = probe;
  const {
    syncCompletedAppointmentClientLink,
  } = await import("../src/services/AppointmentClientLinkService");
  const {
    createAppointment,
    updateAppointment,
    AppointmentValidationError,
  } = await import("../src/services/AppointmentService");

  const master = await prisma.master.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  const service = await prisma.service.findFirst({
    where: { isActive: true },
    select: { id: true, publicName: true },
  });
  const user = await prisma.user.findFirst({
    where: { role: { in: ["OWNER", "MANAGER"] } },
    select: { id: true },
  });

  if (!master || !service || !user) {
    skipAllDbScenarios("missing master/service/admin user");
    await prisma.$disconnect();
    return;
  }

  const createdAppointmentIds: string[] = [];
  const createdClientIds: string[] = [];
  const tag = `ccl-${Date.now()}`;

  async function createCompletedRaw(input: {
    phone: string;
    name: string;
    startsAt: Date;
    endsAt: Date;
    comment?: string | null;
    importantNote?: string | null;
    clientId?: string | null;
  }) {
    const row = await prisma.appointment.create({
      data: {
        masterId: master!.id,
        serviceId: service!.id,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        clientName: input.name,
        clientPhone: input.phone,
        status: "COMPLETED",
        source: "INTERNAL",
        comment: input.comment ?? null,
        importantNote: input.importantNote ?? null,
        timingSemanticsVersion: 2,
        ...(input.clientId
          ? { client: { connect: { id: input.clientId } } }
          : {}),
      },
    });
    createdAppointmentIds.push(row.id);
    return row;
  }

  async function cleanup() {
    if (createdAppointmentIds.length > 0) {
      await prisma.appointment.deleteMany({
        where: { id: { in: createdAppointmentIds } },
      });
    }
    if (createdClientIds.length > 0) {
      await prisma.client.deleteMany({
        where: { id: { in: createdClientIds } },
      });
    }
    await prisma.client.deleteMany({
      where: { fullName: { startsWith: tag } },
    });
  }

  try {
    // 1. Existing phone → link, no create
    {
      const phone = uniquePhone("01");
      const normalized = normalizePhone(phone)!;
      const existing = await prisma.client.create({
        data: {
          fullName: `${tag} Existing`,
          phone,
          normalizedPhone: normalized,
          status: "ACTIVE",
        },
      });
      createdClientIds.push(existing.id);
      const appt = await createCompletedRaw({
        phone,
        name: `${tag} Appt1`,
        startsAt: new Date("2099-09-01T10:00:00+05:00"),
        endsAt: new Date("2099-09-01T11:00:00+05:00"),
      });
      const beforeCount = await prisma.client.count({
        where: { normalizedPhone: normalized },
      });
      const result = await syncCompletedAppointmentClientLink(appt.id);
      assert.equal(result.status, "linked");
      const afterCount = await prisma.client.count({
        where: { normalizedPhone: normalized },
      });
      assert.equal(afterCount, beforeCount);
      const linked = await prisma.appointment.findUnique({
        where: { id: appt.id },
      });
      assert.equal(linked?.clientId, existing.id);
      dbOutcomes.push({ name: "db.existing-phone-links", outcome: "PASSED" });
    }

    // 2. No match → create ACTIVE + source/tag/lastVisitAt
    {
      const phone = uniquePhone("02");
      const appt = await createCompletedRaw({
        phone,
        name: `${tag} NewClient`,
        startsAt: new Date("2099-09-02T10:00:00+05:00"),
        endsAt: new Date("2099-09-02T11:00:00+05:00"),
      });
      const result = await syncCompletedAppointmentClientLink(appt.id);
      assert.equal(result.status, "created");
      assert.ok(result.status === "created" && result.clientId);
      createdClientIds.push(result.clientId);
      const client = await prisma.client.findUnique({
        where: { id: result.clientId },
      });
      assert.ok(client);
      assert.equal(client.status, "ACTIVE");
      assert.equal(client.normalizedPhone, normalizePhone(phone));
      assert.equal(client.source, APPOINTMENT_CLIENT_SOURCE_LABELS.INTERNAL);
      assert.ok(client.tags.includes(service!.publicName));
      assert.equal(client.lastVisitAt?.toISOString(), appt.startsAt.toISOString());
      dbOutcomes.push({ name: "db.no-match-creates", outcome: "PASSED" });
    }

    // 3–5. NEW/INACTIVE → ACTIVE; BLOCKED stays; lastVisit monotonic
    {
      const phoneNew = uniquePhone("03");
      const phoneInactive = uniquePhone("04");
      const phoneBlocked = uniquePhone("05");
      const phoneVisit = uniquePhone("06");
      const cNew = await prisma.client.create({
        data: {
          fullName: `${tag} New`,
          phone: phoneNew,
          normalizedPhone: normalizePhone(phoneNew),
          status: "NEW",
        },
      });
      const cInactive = await prisma.client.create({
        data: {
          fullName: `${tag} Inactive`,
          phone: phoneInactive,
          normalizedPhone: normalizePhone(phoneInactive),
          status: "INACTIVE",
        },
      });
      const cBlocked = await prisma.client.create({
        data: {
          fullName: `${tag} Blocked`,
          phone: phoneBlocked,
          normalizedPhone: normalizePhone(phoneBlocked),
          status: "BLOCKED",
        },
      });
      const futureVisit = new Date("2099-09-10T12:00:00+05:00");
      const cVisit = await prisma.client.create({
        data: {
          fullName: `${tag} Visit`,
          phone: phoneVisit,
          normalizedPhone: normalizePhone(phoneVisit),
          status: "ACTIVE",
          lastVisitAt: futureVisit,
        },
      });
      createdClientIds.push(cNew.id, cInactive.id, cBlocked.id, cVisit.id);

      for (const [client, phone, starts] of [
        [cNew, phoneNew, "2099-09-03T10:00:00+05:00"],
        [cInactive, phoneInactive, "2099-09-04T10:00:00+05:00"],
        [cBlocked, phoneBlocked, "2099-09-05T10:00:00+05:00"],
        [cVisit, phoneVisit, "2099-09-06T10:00:00+05:00"],
      ] as const) {
        const appt = await createCompletedRaw({
          phone,
          name: `${tag} status`,
          startsAt: new Date(starts),
          endsAt: new Date(new Date(starts).getTime() + 60 * 60 * 1000),
        });
        await syncCompletedAppointmentClientLink(appt.id);
        void client;
      }

      const refreshedNew = await prisma.client.findUnique({
        where: { id: cNew.id },
      });
      const refreshedInactive = await prisma.client.findUnique({
        where: { id: cInactive.id },
      });
      const refreshedBlocked = await prisma.client.findUnique({
        where: { id: cBlocked.id },
      });
      const refreshedVisit = await prisma.client.findUnique({
        where: { id: cVisit.id },
      });
      assert.equal(refreshedNew?.status, "ACTIVE");
      assert.equal(refreshedInactive?.status, "ACTIVE");
      assert.equal(refreshedBlocked?.status, "BLOCKED");
      assert.equal(
        refreshedVisit?.lastVisitAt?.toISOString(),
        futureVisit.toISOString(),
      );
      dbOutcomes.push({ name: "db.status-transitions", outcome: "PASSED" });
      dbOutcomes.push({ name: "db.lastVisit-monotonic", outcome: "PASSED" });
    }

    // 6–7. technical + invalid phone
    {
      const tech = await createCompletedRaw({
        phone: "+70000000000",
        name: `${tag} Tech`,
        startsAt: new Date("2099-09-07T10:00:00+05:00"),
        endsAt: new Date("2099-09-07T11:00:00+05:00"),
      });
      const techResult = await syncCompletedAppointmentClientLink(tech.id);
      assert.equal(techResult.status, "skipped_technical_phone");
      const techAppt = await prisma.appointment.findUnique({
        where: { id: tech.id },
      });
      assert.equal(techAppt?.status, "COMPLETED");
      assert.equal(techAppt?.clientId, null);

      const bad = await createCompletedRaw({
        phone: "+7111",
        name: `${tag} Bad`,
        startsAt: new Date("2099-09-07T12:00:00+05:00"),
        endsAt: new Date("2099-09-07T13:00:00+05:00"),
      });
      const badResult = await syncCompletedAppointmentClientLink(bad.id);
      assert.equal(badResult.status, "skipped_invalid_phone");
      dbOutcomes.push({
        name: "db.technical-and-invalid-phone",
        outcome: "PASSED",
      });
    }

    // 8. duplicates
    {
      const phone = uniquePhone("08");
      const normalized = normalizePhone(phone)!;
      const d1 = await prisma.client.create({
        data: {
          fullName: `${tag} Dup1`,
          phone,
          normalizedPhone: normalized,
          status: "ACTIVE",
        },
      });
      const d2 = await prisma.client.create({
        data: {
          fullName: `${tag} Dup2`,
          phone,
          normalizedPhone: normalized,
          status: "ACTIVE",
        },
      });
      createdClientIds.push(d1.id, d2.id);
      const appt = await createCompletedRaw({
        phone,
        name: `${tag} DupAppt`,
        startsAt: new Date("2099-09-08T10:00:00+05:00"),
        endsAt: new Date("2099-09-08T11:00:00+05:00"),
      });
      const result = await syncCompletedAppointmentClientLink(appt.id);
      assert.equal(result.status, "duplicate");
      if (result.status === "duplicate") {
        for (const candidate of result.candidates) {
          assert.ok("id" in candidate && "fullName" in candidate);
          assert.ok("phone" in candidate && "status" in candidate);
          assert.equal(
            Object.keys(candidate).sort().join(","),
            "fullName,id,phone,status",
          );
        }
      }
      const linked = await prisma.appointment.findUnique({
        where: { id: appt.id },
      });
      assert.equal(linked?.clientId, null);
      dbOutcomes.push({ name: "db.duplicate-candidates", outcome: "PASSED" });
    }

    // 8b. manual duplicate resolve + disconnect without auto-relink
    {
      const phone = uniquePhone("08b");
      const normalized = normalizePhone(phone)!;
      const selected = await prisma.client.create({
        data: {
          fullName: `${tag} DupPick`,
          phone,
          normalizedPhone: normalized,
          status: "INACTIVE",
        },
      });
      const otherVisit = new Date("2090-01-01T00:00:00+05:00");
      const other = await prisma.client.create({
        data: {
          fullName: `${tag} DupOther`,
          phone,
          normalizedPhone: normalized,
          status: "ACTIVE",
          lastVisitAt: otherVisit,
          tags: ["keep-me"],
        },
      });
      createdClientIds.push(selected.id, other.id);
      const appt = await createCompletedRaw({
        phone,
        name: `${tag} DupResolveAppt`,
        startsAt: new Date("2099-09-08T14:00:00+05:00"),
        endsAt: new Date("2099-09-08T15:00:00+05:00"),
      });
      const dup = await syncCompletedAppointmentClientLink(appt.id);
      assert.equal(dup.status, "duplicate");

      const resolved = await updateAppointment(appt.id, {
        clientId: selected.id,
        clientName: selected.fullName,
        clientPhone: selected.phone,
      });
      assert.equal(resolved.appointment.clientId, selected.id);
      assert.ok(
        resolved.clientLink.status === "already_linked" ||
          resolved.clientLink.status === "linked",
        `expected already_linked/linked, got ${resolved.clientLink.status}`,
      );

      const refreshedSelected = await prisma.client.findUnique({
        where: { id: selected.id },
      });
      const refreshedOther = await prisma.client.findUnique({
        where: { id: other.id },
      });
      assert.equal(refreshedSelected?.status, "ACTIVE");
      assert.equal(
        refreshedSelected?.lastVisitAt?.toISOString(),
        appt.startsAt.toISOString(),
      );
      assert.ok(refreshedSelected?.tags.includes(service!.publicName));
      assert.equal(refreshedOther?.status, "ACTIVE");
      assert.equal(
        refreshedOther?.lastVisitAt?.toISOString(),
        otherVisit.toISOString(),
      );
      assert.deepEqual(refreshedOther?.tags, ["keep-me"]);
      assert.equal(
        await prisma.client.count({ where: { normalizedPhone: normalized } }),
        2,
      );
      dbOutcomes.push({
        name: "db.manual-duplicate-resolve",
        outcome: "PASSED",
      });

      const cleared = await updateAppointment(appt.id, { clientId: null });
      assert.equal(cleared.appointment.clientId, null);
      assert.equal(cleared.clientLink.status, "not_applicable");
      const afterClear = await prisma.appointment.findUnique({
        where: { id: appt.id },
      });
      assert.equal(afterClear?.clientId, null);
      assert.equal(afterClear?.status, "COMPLETED");
      assert.equal(
        await prisma.client.count({ where: { normalizedPhone: normalized } }),
        2,
      );
      dbOutcomes.push({
        name: "db.completed-disconnect-no-relink",
        outcome: "PASSED",
      });
    }

    // 9. same FIO other phone → create
    {
      const phoneA = uniquePhone("09a");
      const phoneB = uniquePhone("09b");
      const existing = await prisma.client.create({
        data: {
          fullName: `${tag} SameName`,
          phone: phoneA,
          normalizedPhone: normalizePhone(phoneA),
          status: "ACTIVE",
        },
      });
      createdClientIds.push(existing.id);
      const appt = await createCompletedRaw({
        phone: phoneB,
        name: `${tag} SameName`,
        startsAt: new Date("2099-09-09T10:00:00+05:00"),
        endsAt: new Date("2099-09-09T11:00:00+05:00"),
      });
      const result = await syncCompletedAppointmentClientLink(appt.id);
      assert.equal(result.status, "created");
      if (result.status === "created") {
        createdClientIds.push(result.clientId);
        assert.notEqual(result.clientId, existing.id);
      }
      dbOutcomes.push({ name: "db.same-fio-other-phone", outcome: "PASSED" });
    }

    // 10–11. idempotent + COMPLETED→SCHEDULED→COMPLETED
    {
      const phone = uniquePhone("10");
      const appt = await createCompletedRaw({
        phone,
        name: `${tag} Idem`,
        startsAt: new Date("2099-09-10T10:00:00+05:00"),
        endsAt: new Date("2099-09-10T11:00:00+05:00"),
      });
      const first = await syncCompletedAppointmentClientLink(appt.id);
      assert.equal(first.status, "created");
      assert.ok(first.status === "created");
      createdClientIds.push(first.clientId);
      const second = await syncCompletedAppointmentClientLink(appt.id);
      assert.equal(second.status, "already_linked");
      assert.ok(second.status === "already_linked");
      assert.equal(second.clientId, first.clientId);

      await prisma.appointment.update({
        where: { id: appt.id },
        data: { status: "SCHEDULED" },
      });
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { status: "COMPLETED" },
      });
      const third = await syncCompletedAppointmentClientLink(appt.id);
      assert.ok(
        third.status === "already_linked" || third.status === "linked",
      );
      if (third.status === "already_linked" || third.status === "linked") {
        assert.equal(third.clientId, first.clientId);
      }
      const count = await prisma.client.count({
        where: { normalizedPhone: normalizePhone(phone)! },
      });
      assert.equal(count, 1);
      dbOutcomes.push({ name: "db.idempotent-resync", outcome: "PASSED" });
      dbOutcomes.push({
        name: "db.completed-reschedule-completed",
        outcome: "PASSED",
      });
    }

    // 11b. real AppointmentService COMPLETED workflow
    {
      const phone = uniquePhone("11b");
      const created = await createAppointment(
        {
          masterId: master.id,
          dateKey: "2099-09-21",
          startTime: "10:00",
          endTime: "10:30",
          serviceId: service.id,
          clientName: `${tag} Workflow`,
          clientPhone: phone,
          status: "SCHEDULED",
          source: "INTERNAL",
        },
        user.id,
        { allowAppointmentOverlap: true },
      );
      createdAppointmentIds.push(created.appointment.id);
      assert.equal(created.clientLink.status, "not_applicable");
      assert.equal(created.appointment.clientId, null);

      const completed = await updateAppointment(
        created.appointment.id,
        { status: "COMPLETED" },
        { allowAppointmentOverlap: true },
      );
      assert.ok(
        completed.clientLink.status === "created" ||
          completed.clientLink.status === "linked",
        `expected create/link, got ${completed.clientLink.status}`,
      );
      const clientId = completed.appointment.clientId;
      assert.ok(clientId);
      createdClientIds.push(clientId);

      const commented = await updateAppointment(created.appointment.id, {
        comment: "workflow-comment",
      });
      assert.equal(commented.clientLink.status, "not_applicable");
      assert.equal(commented.appointment.clientId, clientId);
      assert.equal(
        await prisma.client.count({
          where: { normalizedPhone: normalizePhone(phone)! },
        }),
        1,
      );

      await updateAppointment(created.appointment.id, {
        status: "RESCHEDULED",
      });
      const again = await updateAppointment(
        created.appointment.id,
        { status: "COMPLETED" },
        { allowAppointmentOverlap: true },
      );
      assert.equal(again.appointment.clientId, clientId);
      assert.notEqual(again.clientLink.status, "created");
      assert.ok(
        again.clientLink.status === "already_linked" ||
          again.clientLink.status === "linked",
      );
      assert.equal(
        await prisma.client.count({
          where: { normalizedPhone: normalizePhone(phone)! },
        }),
        1,
      );
      dbOutcomes.push({
        name: "db.service-completed-workflow",
        outcome: "PASSED",
      });
    }

    // 12. parallel same full phone
    {
      const phone = uniquePhone("12");
      const normalized = normalizePhone(phone)!;
      const a = await createCompletedRaw({
        phone,
        name: `${tag} RaceA`,
        startsAt: new Date("2099-09-12T10:00:00+05:00"),
        endsAt: new Date("2099-09-12T11:00:00+05:00"),
      });
      const b = await createCompletedRaw({
        phone,
        name: `${tag} RaceB`,
        startsAt: new Date("2099-09-12T12:00:00+05:00"),
        endsAt: new Date("2099-09-12T13:00:00+05:00"),
      });
      await Promise.all([
        syncCompletedAppointmentClientLink(a.id),
        syncCompletedAppointmentClientLink(b.id),
      ]);
      const clients = await prisma.client.findMany({
        where: {
          normalizedPhone: normalized,
          fullName: { startsWith: tag },
        },
      });
      assert.equal(clients.length, 1);
      createdClientIds.push(clients[0]!.id);
      const linkedA = await prisma.appointment.findUnique({
        where: { id: a.id },
      });
      const linkedB = await prisma.appointment.findUnique({
        where: { id: b.id },
      });
      assert.equal(linkedA?.clientId, clients[0]!.id);
      assert.equal(linkedB?.clientId, clients[0]!.id);
      dbOutcomes.push({ name: "db.parallel-same-phone", outcome: "PASSED" });
    }

    // 13. parallel suffix-equivalent different full numbers
    {
      const suffixSeed = `${Date.now()}`.slice(-7);
      const phoneLocal = `+7900${suffixSeed}`;
      const phoneForeign = `+17900${suffixSeed}`;
      assert.equal(
        resolveClientPhoneMatchKey(phoneLocal),
        resolveClientPhoneMatchKey(phoneForeign),
      );
      const a = await createCompletedRaw({
        phone: phoneLocal,
        name: `${tag} SuffixA`,
        startsAt: new Date("2099-09-13T10:00:00+05:00"),
        endsAt: new Date("2099-09-13T11:00:00+05:00"),
      });
      const b = await createCompletedRaw({
        phone: phoneForeign,
        name: `${tag} SuffixB`,
        startsAt: new Date("2099-09-13T12:00:00+05:00"),
        endsAt: new Date("2099-09-13T13:00:00+05:00"),
      });
      await Promise.all([
        syncCompletedAppointmentClientLink(a.id),
        syncCompletedAppointmentClientLink(b.id),
      ]);
      const matchKey = resolveClientPhoneMatchKey(phoneLocal)!;
      const clients = await prisma.client.findMany({
        where: {
          OR: [
            { normalizedPhone: normalizePhone(phoneLocal)! },
            { normalizedPhone: normalizePhone(phoneForeign)! },
            { normalizedPhone: { endsWith: matchKey } },
          ],
          fullName: { startsWith: tag },
        },
      });
      const uniqueIds = new Set(clients.map((c) => c.id));
      assert.equal(uniqueIds.size, 1, "suffix-equivalent race must create one client");
      createdClientIds.push([...uniqueIds][0]!);
      const linkedA = await prisma.appointment.findUnique({
        where: { id: a.id },
      });
      const linkedB = await prisma.appointment.findUnique({
        where: { id: b.id },
      });
      assert.equal(linkedA?.clientId, linkedB?.clientId);
      assert.ok(linkedA?.clientId);
      dbOutcomes.push({
        name: "db.parallel-suffix-equivalent",
        outcome: "PASSED",
      });
    }

    // 14. manual create with selected client
    {
      const phone = uniquePhone("14");
      const client = await prisma.client.create({
        data: {
          fullName: `${tag} ManualCreate`,
          phone,
          normalizedPhone: normalizePhone(phone),
          status: "ACTIVE",
        },
      });
      createdClientIds.push(client.id);
      const created = await createAppointment(
        {
          masterId: master.id,
          dateKey: "2099-09-14",
          startTime: "10:00",
          endTime: "10:30",
          serviceId: service.id,
          clientName: client.fullName,
          clientPhone: phone,
          status: "SCHEDULED",
          source: "INTERNAL",
          clientId: client.id,
        },
        user.id,
        { allowAppointmentOverlap: true },
      );
      createdAppointmentIds.push(created.appointment.id);
      assert.equal(created.appointment.clientId, client.id);
      assert.equal(created.clientLink.status, "not_applicable");
      dbOutcomes.push({
        name: "db.manual-create-selected-client",
        outcome: "PASSED",
      });
    }

    // 15–16. PATCH connect / disconnect
    {
      const phone = uniquePhone("15");
      const client = await prisma.client.create({
        data: {
          fullName: `${tag} PatchClient`,
          phone,
          normalizedPhone: normalizePhone(phone),
          status: "ACTIVE",
        },
      });
      createdClientIds.push(client.id);
      const created = await createAppointment(
        {
          masterId: master.id,
          dateKey: "2099-09-15",
          startTime: "11:00",
          endTime: "11:30",
          serviceId: service.id,
          clientName: `${tag} PatchAppt`,
          clientPhone: phone,
          status: "SCHEDULED",
          source: "INTERNAL",
        },
        user.id,
        { allowAppointmentOverlap: true },
      );
      createdAppointmentIds.push(created.appointment.id);
      const linked = await updateAppointment(created.appointment.id, {
        clientId: client.id,
      });
      assert.equal(linked.appointment.clientId, client.id);
      const cleared = await updateAppointment(created.appointment.id, {
        clientId: null,
      });
      assert.equal(cleared.appointment.clientId, null);
      dbOutcomes.push({
        name: "db.manual-patch-connect-disconnect",
        outcome: "PASSED",
      });
    }

    // 17. archived / merged rejected
    {
      const phoneA = uniquePhone("17a");
      const phoneM = uniquePhone("17m");
      const target = await prisma.client.create({
        data: {
          fullName: `${tag} MergeTarget`,
          phone: phoneM,
          normalizedPhone: normalizePhone(phoneM),
          status: "ACTIVE",
        },
      });
      const archived = await prisma.client.create({
        data: {
          fullName: `${tag} Archived`,
          phone: phoneA,
          normalizedPhone: normalizePhone(phoneA),
          status: "ACTIVE",
          isArchived: true,
        },
      });
      const mergedPhone = uniquePhone("17b");
      const merged = await prisma.client.create({
        data: {
          fullName: `${tag} Merged`,
          phone: mergedPhone,
          normalizedPhone: normalizePhone(mergedPhone),
          status: "ACTIVE",
          mergedIntoClientId: target.id,
        },
      });
      createdClientIds.push(target.id, archived.id, merged.id);
      const created = await createAppointment(
        {
          masterId: master.id,
          dateKey: "2099-09-17",
          startTime: "12:00",
          endTime: "12:30",
          serviceId: service.id,
          clientName: `${tag} Reject`,
          clientPhone: phoneA,
          status: "SCHEDULED",
          source: "INTERNAL",
        },
        user.id,
        { allowAppointmentOverlap: true },
      );
      createdAppointmentIds.push(created.appointment.id);

      await assert.rejects(
        () =>
          updateAppointment(created.appointment.id, {
            clientId: archived.id,
          }),
        (error: unknown) =>
          error instanceof AppointmentValidationError &&
          error.message.includes("недоступен"),
      );
      await assert.rejects(
        () =>
          updateAppointment(created.appointment.id, {
            clientId: merged.id,
          }),
        (error: unknown) =>
          error instanceof AppointmentValidationError &&
          error.message.includes("недоступен"),
      );
      dbOutcomes.push({ name: "db.reject-archived-merged", outcome: "PASSED" });
    }

    // 18–20. autosave no create; retry; comment/note clean
    {
      const phone = uniquePhone("18");
      const appt = await createCompletedRaw({
        phone,
        name: `${tag} Autosave`,
        startsAt: new Date("2099-09-18T10:00:00+05:00"),
        endsAt: new Date("2099-09-18T11:00:00+05:00"),
        comment: "keep-me",
        importantNote: "note-keep",
      });
      const before = await prisma.client.count({
        where: { normalizedPhone: normalizePhone(phone)! },
      });
      const patched = await updateAppointment(appt.id, {
        comment: "edited-comment",
        clientPhone: phone,
      });
      assert.equal(patched.clientLink.status, "not_applicable");
      const afterPatch = await prisma.client.count({
        where: { normalizedPhone: normalizePhone(phone)! },
      });
      assert.equal(afterPatch, before);

      const retried = await updateAppointment(
        appt.id,
        {},
        { retryClientLink: true },
      );
      assert.ok(
        retried.clientLink.status === "created" ||
          retried.clientLink.status === "linked" ||
          retried.clientLink.status === "already_linked",
      );
      if (
        retried.clientLink.status === "created" ||
        retried.clientLink.status === "linked" ||
        retried.clientLink.status === "already_linked"
      ) {
        createdClientIds.push(retried.clientLink.clientId);
      }

      const row = await prisma.appointment.findUnique({
        where: { id: appt.id },
      });
      assert.equal(row?.comment, "edited-comment");
      assert.equal(row?.importantNote, "note-keep");
      assert.doesNotMatch(row?.comment ?? "", /CRM|clientId/i);
      assert.doesNotMatch(row?.importantNote ?? "", /CRM|clientId/i);

      dbOutcomes.push({ name: "db.autosave-no-create", outcome: "PASSED" });
      dbOutcomes.push({ name: "db.explicit-retry", outcome: "PASSED" });
      dbOutcomes.push({
        name: "db.comment-importantNote-clean",
        outcome: "PASSED",
      });
    }
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  testPhoneUsability();
  testPhoneMatchKey();
  testUniquePhoneGenerator();
  testSourceLabelsDistinct();
  testServiceWiring();
  testApiContracts();
  testMasterAndPublicPrivacy();
  testUiExplicitPersistenceContract();
  testClientLinkUiHelpers();
  testNoCrmNotesInAppointmentText();
  testClientMergeKeepsAppointmentLinks();
  console.log(
    "security-appointment-completed-client-link-check: STATIC PASSED",
  );
  await runDbIntegrationSuite();

  const passed = dbOutcomes.filter((o) => o.outcome === "PASSED");
  const skipped = dbOutcomes.filter((o) => o.outcome === "SKIPPED");
  console.log(
    `security-appointment-completed-client-link-check: DB PASSED=${passed.length}`,
  );
  for (const item of passed) {
    console.log(`  DB PASSED ${item.name}`);
  }
  console.log(
    `security-appointment-completed-client-link-check: DB SKIPPED=${skipped.length}`,
  );
  for (const item of skipped) {
    console.log(
      `  DB SKIPPED ${item.name}${item.detail ? ` (${item.detail})` : ""}`,
    );
  }
  console.log("security-appointment-completed-client-link-check: OK");
}

void main();
