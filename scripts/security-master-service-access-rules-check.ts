/**
 * Runtime regression for internal/public service policy and appointment writes.
 * Production entrypoints run with an injected transaction runner; no DB is used.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type { Appointment, Prisma } from "@prisma/client";
import type { BookingPolicyRuntime } from "../src/services/BookingService";
import type { AppointmentServiceRuntime } from "../src/services/AppointmentService";
import {
  assertConnectedStagingDatabaseIdentity,
  assertExpectedStagingDatabaseUrl,
} from "./lib/master-service-access-db-identity";

process.env.SECURITY_BATCH_TEST = "1";
const originalConsoleError = console.error;
console.error = () => {};

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const serverOnlyMarker = require.resolve("server-only");
const serverOnlyEmpty = path.join(path.dirname(serverOnlyMarker), "empty.js");
require(serverOnlyEmpty);
require.cache[serverOnlyMarker] = require.cache[serverOnlyEmpty];

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "11111111-1111-4111-8111-222222222222";
const S1 = "22222222-2222-4222-8222-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const APPOINTMENT_ID = "33333333-3333-4333-8333-333333333333";

type LockedPolicyRow = {
  serviceId: string;
  serviceIsActive: boolean;
  serviceIsPublic: boolean;
  serviceIsOnlineBookingEnabled: boolean;
  categoryIsActive: boolean;
  categoryIsPublic: boolean;
  masterIsActive: boolean;
  masterIsPublic: boolean;
  masterIsOnlineBookingEnabled: boolean;
  masterServiceIsEnabled: boolean;
  masterServiceIsPublic: boolean;
  masterServiceIsOnlineBookingEnabled: boolean;
};

function policyRow(
  overrides: Partial<LockedPolicyRow> = {},
): LockedPolicyRow {
  return {
    serviceId: S1,
    serviceIsActive: true,
    serviceIsPublic: true,
    serviceIsOnlineBookingEnabled: true,
    categoryIsActive: true,
    categoryIsPublic: true,
    masterIsActive: true,
    masterIsPublic: true,
    masterIsOnlineBookingEnabled: true,
    masterServiceIsEnabled: true,
    masterServiceIsPublic: true,
    masterServiceIsOnlineBookingEnabled: true,
    ...overrides,
  };
}

type AppointmentWithService = Appointment & {
  service: { publicName: string } | null;
};

function appointmentFixture(
  overrides: Partial<AppointmentWithService> = {},
): AppointmentWithService {
  const startsAt = new Date("2099-01-05T05:00:00.000Z");
  return {
    id: APPOINTMENT_ID,
    masterId: M1,
    serviceId: S1,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * 60_000),
    clientName: "Runtime Client",
    clientPhone: "+79001234567",
    comment: null,
    importantNote: null,
    isBold: false,
    serviceDurationMinutes: 60,
    breakAfterMinutes: 0,
    standardDurationMinutes: 60,
    standardBreakAfterMinutes: 0,
    isManualTimeOverride: false,
    timingSemanticsVersion: 2,
    timingCanonicalStoredAt: startsAt,
    status: "SCHEDULED",
    source: "INTERNAL",
    promoCode: null,
    appliedPromotions: null,
    botSessionId: null,
    manageToken: null,
    manageTokenHash: null,
    cancelledBy: null,
    cancelReason: null,
    rescheduleRequestText: null,
    rescheduleRequestedAt: null,
    createdByUserId: null,
    clientId: null,
    cancelledAt: null,
    createdAt: startsAt,
    updatedAt: startsAt,
    service: { publicName: "Runtime Service" },
    ...overrides,
  };
}

function createAppointmentRuntimeHarness(options: {
  initial?: AppointmentWithService;
  policyRows?: LockedPolicyRow[];
  beforeTransaction?: () => void | Promise<void>;
} = {}) {
  const events: string[] = [];
  let state = options.initial ?? appointmentFixture();
  let lastUpdateData: Prisma.AppointmentUpdateInput | null = null;
  let policyTx: object | null = null;
  let writeTx: object | null = null;

  function applyUpdate(
    data: Prisma.AppointmentUpdateInput,
  ): AppointmentWithService {
    const mutable = data as Record<string, unknown>;
    const master = mutable.master as
      | { connect?: { id?: string } }
      | undefined;
    const service = mutable.service as
      | { connect?: { id?: string }; disconnect?: boolean }
      | undefined;
    const scalarKeys = [
      "startsAt",
      "endsAt",
      "clientName",
      "clientPhone",
      "comment",
      "importantNote",
      "isBold",
      "status",
      "source",
      "serviceDurationMinutes",
      "breakAfterMinutes",
      "standardDurationMinutes",
      "standardBreakAfterMinutes",
      "isManualTimeOverride",
      "timingSemanticsVersion",
      "timingCanonicalStoredAt",
    ] as const;
    const next = { ...state } as AppointmentWithService &
      Record<string, unknown>;
    if (master?.connect?.id) {
      next.masterId = master.connect.id;
    }
    if (service?.connect?.id) {
      next.serviceId = service.connect.id;
      next.service = { publicName: `Service ${service.connect.id}` };
    } else if (service?.disconnect) {
      next.serviceId = null;
      next.service = null;
    }
    for (const key of scalarKeys) {
      if (Object.prototype.hasOwnProperty.call(mutable, key)) {
        next[key] = mutable[key];
      }
    }
    state = next;
    return state;
  }

  const tx = {
    async $queryRaw(query: Prisma.Sql) {
      const sql = query.sql;
      if (/FOR UPDATE OF a/.test(sql)) {
        events.push("appointment-lock");
        return [{ id: state.id }];
      }
      assert.match(sql, /FOR SHARE/);
      policyTx = tx;
      events.push(
        /service_categories/.test(sql)
          ? "policy-PUBLIC_ONLINE"
          : "policy-INTERNAL",
      );
      return options.policyRows ?? [policyRow({ serviceId: state.serviceId ?? S1 })];
    },
    master: {
      async findUnique() {
        return {
          id: state.masterId,
          workStart: "00:00",
          workEnd: "23:59",
          usesDefaultWorkHours: false,
        };
      },
    },
    appointment: {
      async findUnique() {
        events.push("appointment-reread");
        return state;
      },
      async findMany() {
        return [];
      },
      async create(args: { data: Prisma.AppointmentCreateInput }) {
        writeTx = tx;
        events.push("appointment.create");
        const data = args.data as Prisma.AppointmentCreateInput & {
          master: { connect: { id: string } };
          service: { connect: { id: string } };
        };
        state = appointmentFixture({
          masterId: data.master.connect.id,
          serviceId: data.service.connect.id,
          startsAt: data.startsAt as Date,
          endsAt: data.endsAt as Date,
          clientName: data.clientName,
          clientPhone: data.clientPhone,
          comment: data.comment as string | null,
          status: data.status ?? "SCHEDULED",
          source: data.source ?? "INTERNAL",
          manageToken: (data.manageToken as string | null) ?? null,
          manageTokenHash: (data.manageTokenHash as string | null) ?? null,
          service: { publicName: "Runtime Service" },
        });
        return state;
      },
      async update(args: { data: Prisma.AppointmentUpdateInput }) {
        writeTx = tx;
        lastUpdateData = args.data;
        events.push("appointment.update");
        return applyUpdate(args.data);
      },
    },
    scheduleBlock: { async findMany() { return []; } },
    extraWorkWindow: { async findMany() { return []; } },
  };

  const runtime: AppointmentServiceRuntime = {
    db: {
      appointment: {
        async findUnique() {
          events.push("runtime-db-read");
          return state;
        },
      } as never,
    },
    async runSerializableWrite(callback) {
      events.push("transaction-start");
      await options.beforeTransaction?.();
      try {
        const result = await callback(tx as never);
        events.push("transaction-commit");
        return result;
      } catch (error) {
        events.push("transaction-rollback");
        throw error;
      }
    },
    async resolveServiceTiming() {
      return {
        durationMinutes: 60,
        breakAfterMinutes: 0,
        totalBusyMinutes: 60,
        source: "service",
      };
    },
    async recordPublicAcceptances(receivedTx) {
      assert.equal(receivedTx, tx);
      events.push("legal-acceptances");
    },
    async syncCompletedClientLink() {
      return { status: "not_applicable" };
    },
  };

  return {
    runtime,
    events,
    tx,
    getState: () => state,
    setState: (next: AppointmentWithService) => {
      state = next;
    },
    getLastUpdateData: () => lastUpdateData,
    assertGuardAndWriteUseSameTx: () => {
      assert.equal(policyTx, writeTx);
      assert.equal(
        events.filter((event) => event === "transaction-start").length,
        1,
      );
      assert.equal(
        events.filter((event) => event === "transaction-commit").length,
        1,
      );
      assert.ok(events.indexOf("transaction-start") < events.indexOf("policy-INTERNAL") ||
        events.indexOf("transaction-start") < events.indexOf("policy-PUBLIC_ONLINE"));
      assert.ok(
        events.indexOf("appointment.create") < events.indexOf("transaction-commit") ||
          events.indexOf("appointment.update") < events.indexOf("transaction-commit"),
      );
    },
  };
}

function manualCreateInput() {
  return {
    masterId: M1,
    serviceId: S1,
    dateKey: "2099-01-05",
    startTime: "10:00",
    endTime: "11:00",
    clientName: "Runtime Client",
    clientPhone: "+79001234567",
    status: "SCHEDULED" as const,
    source: "INTERNAL" as const,
  };
}

async function assertRejectsWithoutExpectedErrorLog(
  operation: () => Promise<unknown>,
): Promise<void> {
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(operation);
  } finally {
    console.error = originalError;
  }
}

async function testRealProductionAppointmentEntrypoints(): Promise<void> {
  const service = await import("../src/services/AppointmentService");

  {
    const harness = createAppointmentRuntimeHarness();
    await service.createAppointment(
      manualCreateInput(),
      "44444444-4444-4444-8444-444444444444",
      undefined,
      harness.runtime,
    );
    assert.ok(
      harness.events.indexOf("policy-INTERNAL") <
        harness.events.indexOf("appointment.create"),
    );
    harness.assertGuardAndWriteUseSameTx();
  }

  {
    const harness = createAppointmentRuntimeHarness();
    await service.createOnlineAppointment(
      {
        ...manualCreateInput(),
        serviceId: S1,
      },
      harness.runtime,
    );
    assert.ok(
      harness.events.indexOf("policy-PUBLIC_ONLINE") <
        harness.events.indexOf("appointment.create"),
    );
    assert.ok(
      harness.events.indexOf("appointment.create") <
        harness.events.indexOf("legal-acceptances"),
    );
    harness.assertGuardAndWriteUseSameTx();
  }

  {
    const harness = createAppointmentRuntimeHarness({ policyRows: [] });
    await assertRejectsWithoutExpectedErrorLog(() =>
      service.createAppointment(
        manualCreateInput(),
        "44444444-4444-4444-8444-444444444444",
        undefined,
        harness.runtime,
      ),
    );
    assert.equal(harness.events.includes("appointment.create"), false);
  }

  for (const serviceIsPublic of [true, false]) {
    for (const serviceIsOnline of [true, false]) {
      for (const linkIsPublic of [true, false]) {
        for (const linkIsOnline of [true, false]) {
          const harness = createAppointmentRuntimeHarness({
            policyRows: [
              policyRow({
                serviceIsPublic,
                serviceIsOnlineBookingEnabled: serviceIsOnline,
                masterServiceIsPublic: linkIsPublic,
                masterServiceIsOnlineBookingEnabled: linkIsOnline,
              }),
            ],
          });
          await service.createAppointment(
            manualCreateInput(),
            "44444444-4444-4444-8444-444444444444",
            undefined,
            harness.runtime,
          );
          assert.equal(harness.events.includes("appointment.create"), true);
        }
      }
    }
  }

  const { SEED_TEST_SERVICE_IDS } = await import(
    "../src/lib/services/seed-test-service-ids"
  );
  for (const override of [
    { serviceIsActive: false },
    { serviceIsPublic: false },
    { serviceIsOnlineBookingEnabled: false },
    { categoryIsActive: false },
    { categoryIsPublic: false },
    { masterIsActive: false },
    { masterIsPublic: false },
    { masterIsOnlineBookingEnabled: false },
    { masterServiceIsEnabled: false },
    { masterServiceIsPublic: false },
    { masterServiceIsOnlineBookingEnabled: false },
    { serviceId: SEED_TEST_SERVICE_IDS[0]! },
  ]) {
    const harness = createAppointmentRuntimeHarness({
      policyRows: [policyRow(override)],
    });
    await assertRejectsWithoutExpectedErrorLog(() =>
      service.createOnlineAppointment(
        { ...manualCreateInput(), serviceId: S1 },
        harness.runtime,
      ),
    );
    assert.equal(harness.events.includes("appointment.create"), false);
  }

  {
    const harness = createAppointmentRuntimeHarness();
    await service.updateAppointment(
      APPOINTMENT_ID,
      { masterId: M2, serviceId: S2 },
      undefined,
      harness.runtime,
    );
    assert.deepEqual(
      harness.events.filter((event) =>
        /appointment-lock|policy-|appointment\.update/.test(event),
      ),
      ["appointment-lock", "policy-INTERNAL", "appointment.update"],
    );
    harness.assertGuardAndWriteUseSameTx();
    assert.equal(harness.getState().masterId, M2);
    assert.equal(harness.getState().serviceId, S2);
  }

  {
    const harness = createAppointmentRuntimeHarness({
      initial: appointmentFixture({ masterId: M1, serviceId: S1 }),
      beforeTransaction() {
        harness.setState(
          appointmentFixture({ masterId: M2, serviceId: S2 }),
        );
      },
    });
    await service.updateAppointment(
      APPOINTMENT_ID,
      { comment: "stale PATCH B comment" },
      undefined,
      harness.runtime,
    );
    assert.equal(harness.getState().masterId, M2);
    assert.equal(harness.getState().serviceId, S2);
    assert.equal(harness.getState().comment, "stale PATCH B comment");
    assert.equal(harness.events.includes("policy-INTERNAL"), false);
    const updateData = harness.getLastUpdateData() as Record<string, unknown>;
    assert.equal(Object.hasOwn(updateData, "master"), false);
    assert.equal(Object.hasOwn(updateData, "service"), false);
  }
}

function createBookingRuntime(options: {
  master?: Record<string, unknown> | null;
  captured?: { masterServiceWhere?: unknown; masterWhere?: unknown };
} = {}): BookingPolicyRuntime {
  const service = {
    id: S1,
    isActive: true,
    isPublic: true,
    isOnlineBookingEnabled: true,
    category: { isActive: true, isPublic: true },
  };
  const master =
    options.master === undefined
      ? {
          isActive: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
        }
      : options.master;
  return {
    db: {
      service: {
        async findUnique() { return service; },
        async findMany() { return [service]; },
      },
      master: {
        async findUnique() { return master; },
        async findMany(args: { where: unknown }) {
          if (options.captured) options.captured.masterWhere = args.where;
          return master
            ? [{
                id: M1,
                publicName: "Master",
                clientDescription: null,
                photoUrl: null,
                isOnlineBookingEnabled: true,
              }]
            : [];
        },
      },
      masterService: {
        async findUnique() {
          return {
            isEnabled: true,
            isPublic: true,
            isOnlineBookingEnabled: true,
          };
        },
        async findMany(args: { where: unknown }) {
          if (options.captured) options.captured.masterServiceWhere = args.where;
          return [];
        },
      },
    } as never,
    async resolveTiming() {
      return {
        durationMinutes: 60,
        breakAfterMinutes: 0,
        totalBusyMinutes: 60,
        source: "service",
      };
    },
  };
}

async function testCatalogAndInternalRules(): Promise<void> {
  const booking = await import("../src/services/BookingService");
  const internal = await import(
    "../src/lib/schedule/internal-editor-master-service"
  );
  const { WRITE_SCHEDULE_ROLES } = await import("../src/lib/auth/api-access");
  const captured: { masterServiceWhere?: unknown; masterWhere?: unknown } = {};

  await booking.listServicesForMaster(
    M1,
    createBookingRuntime({ captured }),
  );
  assert.deepEqual(
    (captured.masterServiceWhere as { master?: unknown }).master,
    {
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    },
  );
  await booking.listMastersForService(
    S1,
    createBookingRuntime({ captured }),
  );
  assert.equal(
    (captured.masterWhere as { isOnlineBookingEnabled?: boolean })
      .isOnlineBookingEnabled,
    true,
  );
  await assert.rejects(() =>
    booking.assertOnlineBookable(
      M1,
      S1,
      createBookingRuntime({
        master: {
          isActive: true,
          isPublic: false,
          isOnlineBookingEnabled: true,
        },
      }),
    ),
  );

  const where = internal.internalEditorMasterServiceWhere(M1);
  assert.equal(where.masterId, M1);
  assert.equal(where.isEnabled, true);
  assert.equal(
    (where.service as { isActive?: boolean }).isActive,
    true,
  );
  assert.equal(Object.hasOwn(where, "isPublic"), false);
  assert.equal(Object.hasOwn(where, "isOnlineBookingEnabled"), false);
  assert.ok(WRITE_SCHEDULE_ROLES.includes("OWNER"));
  assert.ok(WRITE_SCHEDULE_ROLES.includes("MANAGER"));
  assert.ok(!WRITE_SCHEDULE_ROLES.includes("MASTER"));
}

function testDbIdentityPolicy(): void {
  const stagingUrl =
    "postgresql://user:secret@tvoe-vremya-staging-postgres:5432/tvoe_vremya_staging";
  const expected = assertExpectedStagingDatabaseUrl(stagingUrl);
  assert.deepEqual(expected, {
    hostname: "tvoe-vremya-staging-postgres",
    databaseName: "tvoe_vremya_staging",
    port: 5432,
  });

  // host(inet_server_addr()) must yield a bare IP; helper accepts clean IPv4/IPv6
  // and rejects CIDR text that net.isIP() does not understand.
  assert.doesNotThrow(() =>
    assertConnectedStagingDatabaseIdentity(expected, {
      currentDatabase: "tvoe_vremya_staging",
      serverAddress: "172.30.0.2",
      serverPort: 5432,
    }),
  );
  assert.doesNotThrow(() =>
    assertConnectedStagingDatabaseIdentity(expected, {
      currentDatabase: "tvoe_vremya_staging",
      serverAddress: "fd00:dead:beef::2",
      serverPort: 5432,
    }),
  );
  assert.throws(() =>
    assertConnectedStagingDatabaseIdentity(expected, {
      currentDatabase: "tvoe_vremya_staging",
      serverAddress: "172.18.0.3/32",
      serverPort: 5432,
    }),
  );
  assert.throws(() =>
    assertConnectedStagingDatabaseIdentity(expected, {
      currentDatabase: "tvoe_vremya_staging",
      serverAddress: "fd00:dead:beef::2/64",
      serverPort: 5432,
    }),
  );
  assert.match(
    fs.readFileSync(
      path.join(ROOT, "scripts/security-master-service-access-rules-db-check.ts"),
      "utf8",
    ),
    /host\(inet_server_addr\(\)\) AS "serverAddress"/,
  );

  for (const url of [
    "postgresql://user:secret@tvoe-vremya-production-postgres:5432/tvoe_vremya_staging",
    "postgresql://user:secret@postgres:5432/tvoe_vremya_staging",
    "postgresql://user:secret@tvoe-vremya-production_production_internal:5432/tvoe_vremya_staging",
    "postgresql://user:secret@tvoe-vremya-staging-postgres:5432/tvoe_vremya",
    "postgresql://user:secret@tvoe-vremya-staging-postgres:5433/tvoe_vremya_staging",
    undefined,
  ]) {
    assert.throws(() => assertExpectedStagingDatabaseUrl(url));
  }

  assert.throws(() =>
    assertConnectedStagingDatabaseIdentity(expected, {
      currentDatabase: "tvoe_vremya",
      serverAddress: "172.30.0.2",
      serverPort: 5432,
    }),
  );
  assert.throws(() =>
    assertConnectedStagingDatabaseIdentity(expected, {
      currentDatabase: "tvoe_vremya_staging",
      serverAddress: null,
      serverPort: 5432,
    }),
  );
  assert.throws(() =>
    assertConnectedStagingDatabaseIdentity(expected, {
      currentDatabase: "tvoe_vremya_staging",
      serverAddress: "not-an-ip",
      serverPort: 5432,
    }),
  );
  assert.throws(() =>
    assertConnectedStagingDatabaseIdentity(expected, {
      currentDatabase: "tvoe_vremya_staging",
      serverAddress: "172.30.0.2",
      serverPort: 5433,
    }),
  );
  assert.throws(() =>
    assertConnectedStagingDatabaseIdentity(expected, {
      currentDatabase: "tvoe_vremya_staging",
      serverAddress: "172.30.0.2",
      serverPort: null,
    }),
  );
}

async function testActualRouteErrorMapping(): Promise<void> {
  const appointmentService = await import("../src/services/AppointmentService");
  const authPath = require.resolve(path.join(ROOT, "src/lib/auth/api-access.ts"));
  const servicePath = require.resolve(
    path.join(ROOT, "src/services/AppointmentService.ts"),
  );
  const routePath = require.resolve(
    path.join(ROOT, "src/app/api/appointments/route.ts"),
  );
  const previousAuth = require.cache[authPath];
  const previousService = require.cache[servicePath];
  const previousRoute = require.cache[routePath];
  const template = require.cache[serverOnlyEmpty]!;
  require.cache[authPath] = {
    ...template,
    exports: {
      WRITE_SCHEDULE_ROLES: ["OWNER", "MANAGER"],
      requireProtectedMutatingApi: async () => ({
        user: { id: "runtime-owner", role: "OWNER" },
      }),
    },
  };
  require.cache[servicePath] = {
    ...template,
    exports: {
      AppointmentConflictError: appointmentService.AppointmentConflictError,
      AppointmentValidationError:
        appointmentService.AppointmentValidationError,
      createAppointment: async () => {
        throw new appointmentService.AppointmentValidationError(
          "runtime policy rejected",
        );
      },
    },
  };
  delete require.cache[routePath];
  try {
    const route = require(routePath) as {
      POST: (request: Request) => Promise<Response>;
    };
    const response = await route.POST(
      new Request("http://localhost/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ masterId: M1, serviceId: S1 }),
      }),
    );
    assert.equal(response.status, 400);
  } finally {
    if (previousAuth) require.cache[authPath] = previousAuth;
    else delete require.cache[authPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
    if (previousRoute) require.cache[routePath] = previousRoute;
    else delete require.cache[routePath];
  }
}

function testSupplementalStaticBoundaries(): void {
  const policy = fs.readFileSync(
    path.join(ROOT, "src/lib/schedule/master-service-assignment.ts"),
    "utf8",
  );
  assert.match(policy, /Prisma\.sql/);
  assert.match(policy, /FOR SHARE OF ms, s/);
  assert.match(policy, /FOR SHARE OF ms, s, c, m/);
  assert.doesNotMatch(policy, /\$queryRawUnsafe/);

  const appointment = fs.readFileSync(
    path.join(ROOT, "src/services/AppointmentService.ts"),
    "utf8",
  );
  assert.match(appointment, /FOR UPDATE OF a/);
  assert.doesNotMatch(
    appointment,
    /export async function (?:create|update)AppointmentWithLockedServicePolicy/,
  );
  for (const file of [
    "src/app/api/schedule/editor-options/route.ts",
    "src/services/ScheduleEditorOptionsService.ts",
  ]) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), "utf8"), /includeServiceId/);
  }
}

async function main(): Promise<void> {
  await testRealProductionAppointmentEntrypoints();
  await testCatalogAndInternalRules();
  testDbIdentityPolicy();
  await testActualRouteErrorMapping();
  testSupplementalStaticBoundaries();
  console.log("security-master-service-access-rules-check: OK");
}

void main().finally(() => {
  console.error = originalConsoleError;
});
