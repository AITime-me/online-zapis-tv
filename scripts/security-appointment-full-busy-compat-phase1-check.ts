/** Phase 1 compatibility gates for canonical Appointment free-at writes. */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AppointmentTimingValidationError,
  buildAppointmentTimingWriteData,
  isAppointmentTimingDirty,
} from "../src/lib/schedule/appointment-timing-write";
import { formatFullBusyWritesRuntimeLabel } from "../src/lib/schedule/appointment-full-busy-writes";
import type { AppointmentBusyTimingSnapshot } from "../src/lib/schedule/appointment-busy";
import { parseStudioDateKey } from "../src/lib/datetime/date-layer";

const ROOT = process.cwd();
const DATE_KEY = "2026-07-20";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function at(time: string): Date {
  const value = parseStudioDateKey(DATE_KEY, time);
  assert.ok(value, `parseStudioDateKey(${DATE_KEY}, ${time})`);
  return value;
}

function legacySnapshot(
  overrides: Partial<AppointmentBusyTimingSnapshot> = {},
): AppointmentBusyTimingSnapshot {
  return {
    startsAt: at("10:00"),
    endsAt: at("11:00"),
    timingSemanticsVersion: 1,
    breakAfterMinutes: 20,
    standardBreakAfterMinutes: 20,
    standardDurationMinutes: 60,
    isManualTimeOverride: false,
    ...overrides,
  };
}

function write(input: Parameters<typeof buildAppointmentTimingWriteData>[0]) {
  return buildAppointmentTimingWriteData({
    ...input,
    now: at("09:00"),
    env: { APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED: "false" },
  });
}

function testWriteAdapterInvariants(): void {
  const startsAt = at("10:00");
  const freeAt = at("11:20");

  const existingV2 = write({
    startsAt,
    desiredFreeAt: freeAt,
    standardDurationMinutes: 60,
    standardBreakAfterMinutes: 20,
    breakAfterMinutes: 20,
    existing: legacySnapshot({ timingSemanticsVersion: 2, endsAt: freeAt }),
  });
  assert.equal(existingV2.timingSemanticsVersion, 2, "existing v2 never downgrades");
  assert.equal(existingV2.endsAt.getTime(), freeAt.getTime());

  const newManual = write({
    startsAt,
    desiredFreeAt: at("11:45"),
    standardDurationMinutes: 60,
    standardBreakAfterMinutes: 20,
    breakAfterMinutes: 20,
  });
  assert.equal(newManual.timingSemanticsVersion, 2, "new custom time is v2");

  const newStandardLegacy = write({
    startsAt,
    desiredFreeAt: freeAt,
    standardDurationMinutes: 60,
    standardBreakAfterMinutes: 20,
    breakAfterMinutes: 20,
  });
  assert.equal(newStandardLegacy.timingSemanticsVersion, 1);
  assert.equal(newStandardLegacy.endsAt.getTime(), at("11:00").getTime());
  assert.equal(newStandardLegacy.timingCanonicalStoredAt, null);

  const newStandardV2 = buildAppointmentTimingWriteData({
    startsAt,
    desiredFreeAt: freeAt,
    standardDurationMinutes: 60,
    standardBreakAfterMinutes: 20,
    breakAfterMinutes: 20,
    now: at("09:00"),
    env: { APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED: "true" },
  });
  assert.equal(newStandardV2.timingSemanticsVersion, 2);
  assert.equal(newStandardV2.timingCanonicalStoredAt?.getTime(), at("09:00").getTime());

  const exactExisting = write({
    startsAt,
    desiredFreeAt: freeAt,
    standardDurationMinutes: 60,
    standardBreakAfterMinutes: 20,
    breakAfterMinutes: 20,
    existing: legacySnapshot(),
    isUpdate: true,
  });
  assert.equal(exactExisting.timingSemanticsVersion, 1, "exact v1 procedure-only standard result may remain legacy");

  for (const existing of [
    legacySnapshot({ isManualTimeOverride: true }),
    legacySnapshot({ endsAt: at("11:10") }),
    legacySnapshot({ standardDurationMinutes: null }),
  ]) {
    const result = write({
      startsAt,
      desiredFreeAt: at("11:45"),
      standardDurationMinutes: null,
      standardBreakAfterMinutes: 20,
      breakAfterMinutes: 20,
      existing,
      isUpdate: true,
    });
    assert.equal(result.timingSemanticsVersion, 2, "ambiguous or manual legacy timing changes write v2 free-at");
    assert.equal(result.endsAt.getTime(), at("11:45").getTime());
  }

  assert.throws(
    () =>
      write({
        startsAt: at("11:00"),
        desiredFreeAt: at("10:00"),
        standardDurationMinutes: 60,
        standardBreakAfterMinutes: 20,
        breakAfterMinutes: 20,
      }),
    AppointmentTimingValidationError,
  );
}

function testNoteOnlyUpdateIsNotTimingDirty(): void {
  const dirty = isAppointmentTimingDirty({
    current: legacySnapshot(),
    currentServiceId: "service-1",
    currentMasterId: "master-1",
    currentDateKey: DATE_KEY,
    desiredStartsAt: at("10:00"),
    desiredFreeAt: at("11:20"),
    desiredServiceId: "service-1",
    desiredMasterId: "master-1",
    desiredDateKey: DATE_KEY,
  });
  assert.equal(dirty, false, "v1 raw 10:00–11:00 + 20 break compares as free-at 11:20");
}

function testBusySelectInventory(): void {
  const targets = [
    "src/services/MasterAvailabilityService.ts",
    "src/services/BookingService.ts",
    "src/services/AppointmentService.ts",
    "src/lib/schedule/map-schedule-appointment.ts",
  ];
  for (const file of targets) {
    const source = stripComments(read(file));
    assert.doesNotMatch(source, /toPublicBusy\w*|usePublicBusyFor\w*/);
    if (
      source.includes("getAppointmentBusyInterval") &&
      (source.includes("findMany") || file.includes("map-schedule"))
    ) {
      assert.match(source, /timingSemanticsVersion|APPOINTMENT_BUSY_TIMING_SELECT/);
    }
  }

  const servicesDir = path.join(ROOT, "src/services");
  for (const filename of fs.readdirSync(servicesDir).filter((name) => name.endsWith(".ts"))) {
    const source = stripComments(fs.readFileSync(path.join(servicesDir, filename), "utf8"));
    const hasTruncatedAppointmentSelect =
      /(?:prisma|db)\.appointment\.findMany\(\{[\s\S]{0,1500}select:/.test(source);
    if (source.includes("getAppointmentBusyInterval") && hasTruncatedAppointmentSelect) {
      assert.match(
        source,
        /APPOINTMENT_BUSY_TIMING_SELECT|timingSemanticsVersion:\s*true/,
        `${filename}: busy query select must include timingSemanticsVersion`,
      );
    }
  }
}

function testTimingWriteInventory(): void {
  for (const file of [
    "src/services/AppointmentService.ts",
    "src/services/BookingService.ts",
  ]) {
    const source = stripComments(read(file));
    if (/appointment\.(?:create|update)\s*\(/.test(source)) {
      assert.match(
        source,
        /buildAppointmentTimingWriteData/,
        `${file}: appointment timing writes must use the central adapter`,
      );
    }
  }

  const appointment = stripComments(read("src/services/AppointmentService.ts"));
  assert.match(appointment, /endsAt:\s*timingWrite\.endsAt/);
}

function testRuntimeAndCompose(): void {
  assert.equal(
    formatFullBusyWritesRuntimeLabel({ APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED: "true" }),
    "FULL_BUSY_WRITES_ON",
  );
  for (const value of [undefined, "TRUE", "1", "false"]) {
    assert.equal(
      formatFullBusyWritesRuntimeLabel({
        APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED: value,
      }),
      "FULL_BUSY_WRITES_OFF",
    );
  }

  for (const file of ["docker-compose.staging.yml", "docker-compose.production.yml"]) {
    assert.match(
      read(file),
      /APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED:\s*\$\{APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED:-false\}/,
    );
  }
}

function assertRollbackGuard(file: string): void {
  const source = stripComments(read(file));
  assert.match(source, /ops_assert_pre_compat_timing_rollback_allowed/);
  const audit = source.search(/audit|compat.*timing/i);
  const eligibility = source.indexOf("ops_assert_pre_compat_timing_rollback_allowed");
  const confirm = source.search(/ops_require_interactive_confirmation/);
  const apply = source.search(/perform_rollback|ops_apply_compose_app_image/);
  assert.ok(audit >= 0 && audit < eligibility && eligibility < confirm && confirm < apply);
  const perform = source.slice(source.indexOf("perform_rollback"));
  assert.match(perform, /ops_assert_pre_compat_timing_rollback_allowed/);
}

function testRollbackAndDeployManifestGates(): void {
  assertRollbackGuard("scripts/ops/staging-rollback-app.sh");
  assertRollbackGuard("scripts/ops/production-rollback-app.sh");

  const common = stripComments(read("scripts/ops/lib/staging-ops-common.sh"));
  assert.match(common, /ops_assert_pre_compat_timing_rollback_allowed/);
  assert.match(common, /dry.?run[\s\S]{0,500}count[\s\S]{0,500}(?:> 0|>0|non.?zero)/i);

  const requiredFields = [
    "COMPAT_COMMIT_SHA",
    "FULL_BUSY_WRITES_FLAG",
    "DEPLOY_AT_UTC",
    "PHASE1_VERSION_ONLY_V2_COUNT",
    "CANONICAL_V2_WRITE_COUNT_BEFORE",
    "CANONICAL_V2_WRITE_COUNT_AFTER",
    "FIRST_CANONICAL_V2_WRITE_AT",
    "PRE_COMPAT_ROLLBACK_ALLOWED",
    "ALLOWED_ROLLBACK_TARGET",
  ];
  for (const file of ["scripts/ops/staging-deploy.sh", "scripts/ops/production-deploy.sh"]) {
    const source = stripComments(read(file));
    for (const field of requiredFields) {
      assert.ok(source.includes(field), `${file}: manifest must write ${field}`);
    }
  }
}

function main(): void {
  testWriteAdapterInvariants();
  testNoteOnlyUpdateIsNotTimingDirty();
  testBusySelectInventory();
  testTimingWriteInventory();
  testRuntimeAndCompose();
  testRollbackAndDeployManifestGates();
  console.log("security-appointment-full-busy-compat-phase1-check: ok");
}

main();
