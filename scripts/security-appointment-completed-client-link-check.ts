/**
 * Регрессия: COMPLETED → CRM client link + suggest privacy.
 * In-memory/unit + optional Prisma race when DATABASE_URL доступен.
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
import { normalizePhone } from "../src/lib/phone/normalize-phone";
import {
  APPOINTMENT_CLIENT_SOURCE_LABELS,
} from "../src/types/appointment-client-link";
import {
  FORBIDDEN_MASTER_APPOINTMENT_KEYS,
  collectForbiddenMasterAppointmentKeys,
} from "../src/lib/schedule/appointment-contract";
import { WRITE_SCHEDULE_ROLES, CLIENTS_ADMIN_ROLES } from "../src/lib/auth/api-access";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function testPhoneUsability(): void {
  assert.equal(isUsableClientPhone("+79001234567"), true);
  assert.equal(isUsableClientPhone("+70000000000"), false);
  assert.equal(classifyClientPhone("+70000000000").ok, false);
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

function testSourceLabelsDistinct(): void {
  assert.equal(APPOINTMENT_CLIENT_SOURCE_LABELS.ONLINE, "Онлайн-запись");
  assert.equal(APPOINTMENT_CLIENT_SOURCE_LABELS.INTERNAL, "Ручная запись");
  assert.equal(APPOINTMENT_CLIENT_SOURCE_LABELS.PHONE, "Телефон");
  assert.equal(APPOINTMENT_CLIENT_SOURCE_LABELS.BOT, "Бот");
  assert.equal(APPOINTMENT_CLIENT_SOURCE_LABELS.OTHER, "Другое");
}

function testServiceWiring(): void {
  const service = stripComments(read("src/services/AppointmentService.ts"));
  assert.match(service, /syncCompletedAppointmentClientLink/);
  assert.match(
    service,
    /becameCompleted[\s\S]*existing\.status !== "COMPLETED"[\s\S]*appointment\.status === "COMPLETED"/,
  );
  assert.match(service, /retryClientLink/);
  assert.match(
    service,
    /Object\.prototype\.hasOwnProperty\.call\(input,\s*"clientId"\)/,
  );
  assert.doesNotMatch(
    service,
    /appendDuplicateNote|DUPLICATE_COMMENT_PREFIX|\[CRM:/,
  );

  const linkService = stripComments(
    read("src/services/AppointmentClientLinkService.ts"),
  );
  assert.match(linkService, /pg_advisory_xact_lock/);
  assert.match(linkService, /hashtext\(\$\{normalizedPhone\}\)/);
  assert.match(linkService, /status:\s*"ACTIVE"/);
  assert.match(
    linkService,
    /client\.status === "NEW" \|\| client\.status === "INACTIVE"/,
  );
  assert.doesNotMatch(linkService, /status === "BLOCKED"[\s\S]*ACTIVE/);
  assert.doesNotMatch(linkService, /name_duplicate|findClientsByNormalizedFullName/);

  const phoneLib = stripComments(read("src/lib/phone/usable-client-phone.ts"));
  assert.match(phoneLib, /70000000000/);
}

function testApiContracts(): void {
  const patch = stripComments(read("src/app/api/appointments/[id]/route.ts"));
  assert.match(patch, /clientLink:\s*result\.clientLink/);
  assert.match(patch, /retryClientLink/);

  const post = stripComments(read("src/app/api/appointments/route.ts"));
  assert.match(post, /clientLink:\s*result\.clientLink/);

  const suggest = stripComments(
    read("src/app/api/admin/clients/suggest/route.ts"),
  );
  assert.match(suggest, /CLIENTS_ADMIN_ROLES/);
  assert.match(suggest, /mode === "name" && q\.length < 2/);
  assert.match(suggest, /mode === "phone" && q\.replace\(/);
  assert.match(suggest, /length < 4/);
  assert.doesNotMatch(suggest, /notes|bonusBalance|totalSpent|mergeNote/);
}

function testMasterPrivacy(): void {
  assert.ok(FORBIDDEN_MASTER_APPOINTMENT_KEYS.includes("clientId"));
  assert.ok(!WRITE_SCHEDULE_ROLES.includes("MASTER"));
  assert.ok(!CLIENTS_ADMIN_ROLES.includes("MASTER"));

  const forbidden = collectForbiddenMasterAppointmentKeys({
    clientPhone: "x",
    clientId: "y",
  });
  assert.ok(forbidden.includes("clientPhone"));
  assert.ok(forbidden.includes("clientId"));

  const mapSource = stripComments(
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
}

function testUiNoAutosaveCreateOnCompletedFields(): void {
  const form = stripComments(
    read("src/components/schedule/appointment-editor-form.tsx"),
  );
  assert.match(form, /retryClientLink:\s*true/);
  assert.match(form, /ClientSuggestField/);
  assert.match(form, /Повторить привязку/);
  assert.match(form, /clientLinkDirtyRef\.current/);
  // autosave sends clientId only when dirty — not on every completed field debounce
  assert.match(
    form,
    /if \(clientLinkDirtyRef\.current\) \{\s*payloadBody\.clientId = selectedClientIdRef\.current;/,
  );
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

async function testPrismaRaceOptional(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log(
      "security-appointment-completed-client-link-check: Prisma race skipped (no DATABASE_URL)",
    );
    return;
  }

  const { prisma } = await import("../src/lib/db");
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.log(
      "security-appointment-completed-client-link-check: Prisma race skipped (DB unreachable)",
    );
    return;
  }

  const { syncCompletedAppointmentClientLink } = await import(
    "../src/services/AppointmentClientLinkService"
  );
  const phone = `+7900${String(Date.now()).slice(-7)}`;
  const normalized = normalizePhone(phone);
  assert.ok(normalized);

  const master = await prisma.master.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  if (!master) {
    console.log(
      "security-appointment-completed-client-link-check: Prisma race skipped (no master)",
    );
    return;
  }

  const startsAt = new Date("2099-08-01T10:00:00+05:00");
  const endsAt = new Date("2099-08-01T11:00:00+05:00");

  const [a, b] = await prisma.$transaction([
    prisma.appointment.create({
      data: {
        masterId: master.id,
        startsAt,
        endsAt,
        clientName: "Race Client A",
        clientPhone: phone,
        status: "COMPLETED",
        source: "INTERNAL",
        timingSemanticsVersion: 2,
      },
    }),
    prisma.appointment.create({
      data: {
        masterId: master.id,
        startsAt: new Date("2099-08-01T12:00:00+05:00"),
        endsAt: new Date("2099-08-01T13:00:00+05:00"),
        clientName: "Race Client B",
        clientPhone: phone,
        status: "COMPLETED",
        source: "INTERNAL",
        timingSemanticsVersion: 2,
      },
    }),
  ]);

  try {
    const [r1, r2] = await Promise.all([
      syncCompletedAppointmentClientLink(a.id),
      syncCompletedAppointmentClientLink(b.id),
    ]);

    assert.ok(
      r1.status === "created" ||
        r1.status === "linked" ||
        r1.status === "already_linked",
      `r1=${r1.status}`,
    );
    assert.ok(
      r2.status === "created" ||
        r2.status === "linked" ||
        r2.status === "already_linked",
      `r2=${r2.status}`,
    );

    const clients = await prisma.client.findMany({
      where: {
        normalizedPhone: normalized,
        isArchived: false,
        mergedIntoClientId: null,
      },
    });
    assert.equal(clients.length, 1, "parallel sync must create exactly one client");

    const linkedA = await prisma.appointment.findUnique({ where: { id: a.id } });
    const linkedB = await prisma.appointment.findUnique({ where: { id: b.id } });
    assert.equal(linkedA?.clientId, clients[0]!.id);
    assert.equal(linkedB?.clientId, clients[0]!.id);
  } finally {
    await prisma.appointment.deleteMany({
      where: { id: { in: [a.id, b.id] } },
    });
    await prisma.client.deleteMany({
      where: { normalizedPhone: normalized, fullName: { startsWith: "Race Client" } },
    });
    await prisma.$disconnect();
  }

  console.log(
    "security-appointment-completed-client-link-check: Prisma race OK",
  );
}

async function main(): Promise<void> {
  testPhoneUsability();
  testSourceLabelsDistinct();
  testServiceWiring();
  testApiContracts();
  testMasterPrivacy();
  testUiNoAutosaveCreateOnCompletedFields();
  testNoCrmNotesInAppointmentText();
  await testPrismaRaceOptional();
  console.log("security-appointment-completed-client-link-check: OK");
}

void main();
