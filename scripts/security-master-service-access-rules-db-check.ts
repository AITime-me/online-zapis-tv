/**
 * Explicit opt-in PostgreSQL integration for appointment service-policy locks.
 *
 * Default execution exits before importing the Prisma client. Staging mutation
 * additionally requires ALLOW_MASTER_SERVICE_ACCESS_DB_MUTATION=1.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import {
  assertConnectedStagingDatabaseIdentity,
  assertExpectedStagingDatabaseUrl,
} from "./lib/master-service-access-db-identity";

const RUN_FLAG = "RUN_MASTER_SERVICE_ACCESS_DB_TESTS";
const TARGET_FLAG = "DB_TEST_TARGET";
const MUTATION_FLAG = "ALLOW_MASTER_SERVICE_ACCESS_DB_MUTATION";

if (process.env[RUN_FLAG] !== "1") {
  console.log(
    "security-master-service-access-rules-db-check: SKIPPED (explicit opt-in required)",
  );
  process.exit(0);
}

if (process.env[TARGET_FLAG] !== "staging") {
  throw new Error(
    "DB integration refused: DB_TEST_TARGET must be exactly staging",
  );
}

if (process.env[MUTATION_FLAG] !== "1") {
  throw new Error(
    "DB integration refused: ALLOW_MASTER_SERVICE_ACCESS_DB_MUTATION=1 required",
  );
}

const expectedDbIdentity = assertExpectedStagingDatabaseUrl(
  process.env.DATABASE_URL,
);

const require = createRequire(import.meta.url);
const serverOnlyMarker = require.resolve("server-only");
const serverOnlyEmpty = path.join(path.dirname(serverOnlyMarker), "empty.js");
require(serverOnlyEmpty);
require.cache[serverOnlyMarker] = require.cache[serverOnlyEmpty];

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

type AppointmentServicePolicy = "INTERNAL" | "PUBLIC_ONLINE";

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const resolvedStagingAddresses = (
    await lookup(expectedDbIdentity.hostname, { all: true })
  ).map((entry) => entry.address);
  if (resolvedStagingAddresses.length === 0) {
    throw new Error("DB integration refused: staging hostname did not resolve");
  }

  const [{ prisma }, appointmentService, assignmentPolicy, bookingService] =
    await Promise.all([
      import("../src/lib/db"),
      import("../src/services/AppointmentService"),
      import("../src/lib/schedule/master-service-assignment"),
      import("../src/services/BookingService"),
    ]);

  const runId = randomUUID();
  const categoryId = randomUUID();
  const masterId = randomUUID();
  const secondMasterId = randomUUID();
  const serviceId = randomUUID();
  const secondServiceId = randomUUID();
  const phonePrefix = `+7999${Date.now().toString().slice(-7)}`;
  let appointmentCounter = 0;

  const appointmentData = (
    selectedServiceId = serviceId,
    source: "INTERNAL" | "ONLINE" = "INTERNAL",
  ): Prisma.AppointmentCreateInput => {
    appointmentCounter += 1;
    const startsAt = new Date(
      Date.UTC(2098, 0, 10 + appointmentCounter, 10, 0, 0),
    );
    return {
      master: { connect: { id: masterId } },
      service: { connect: { id: selectedServiceId } },
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60_000),
      clientName: `MS access DB ${runId}`,
      clientPhone: `${phonePrefix}${appointmentCounter}`,
      comment: `master-service-access-db:${runId}`,
      status: "SCHEDULED",
      source,
      serviceDurationMinutes: 60,
      breakAfterMinutes: 0,
      standardDurationMinutes: 60,
      standardBreakAfterMinutes: 0,
      isManualTimeOverride: false,
      timingSemanticsVersion: 2,
      timingCanonicalStoredAt: startsAt,
    };
  };

  const createUnderPolicy = (
    policy: AppointmentServicePolicy,
    selectedServiceId = serviceId,
  ) =>
    prisma.$transaction(
      async (tx) => {
        await assignmentPolicy.lockAndAssertAppointmentServicePolicy(tx, {
          masterId,
          serviceId: selectedServiceId,
          policy,
        });
        return tx.appointment.create({
          data: appointmentData(
            selectedServiceId,
            policy === "PUBLIC_ONLINE" ? "ONLINE" : "INTERNAL",
          ),
          include: { service: true },
        });
      },
      { isolationLevel: "Serializable" },
    );

  async function expectPolicyReject(
    policy: AppointmentServicePolicy,
    selectedServiceId = serviceId,
  ): Promise<void> {
    const before = await prisma.appointment.count({
      where: { comment: `master-service-access-db:${runId}` },
    });
    await assert.rejects(() => createUnderPolicy(policy, selectedServiceId));
    const after = await prisma.appointment.count({
      where: { comment: `master-service-access-db:${runId}` },
    });
    assert.equal(after, before, "rejected policy must not create Appointment");
  }

  try {
    const connectedIdentity = await prisma.$queryRaw<
      Array<{
        currentDatabase: string;
        serverAddress: string | null;
        serverPort: number | null;
      }>
    >`
      SELECT
        current_database() AS "currentDatabase",
        host(inet_server_addr()) AS "serverAddress",
        inet_server_port() AS "serverPort"
    `;
    const actualIdentity = connectedIdentity[0];
    if (!actualIdentity) {
      throw new Error("DB integration refused: connected identity is missing");
    }
    assertConnectedStagingDatabaseIdentity(expectedDbIdentity, actualIdentity);

    await prisma.serviceCategory.create({
      data: {
        id: categoryId,
        name: `MS access category ${runId}`,
        isActive: true,
        isPublic: true,
      },
    });
    await prisma.master.create({
      data: {
        id: masterId,
        internalName: `MS access master ${runId}`,
        publicName: `MS access master ${runId}`,
        workStart: "09:00",
        workEnd: "20:00",
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
      },
    });
    await prisma.master.create({
      data: {
        id: secondMasterId,
        internalName: `MS access second master ${runId}`,
        publicName: `MS access second master ${runId}`,
        workStart: "09:00",
        workEnd: "20:00",
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
      },
    });
    await prisma.service.createMany({
      data: [
        {
          id: serviceId,
          categoryId,
          internalName: `MS access service ${runId}`,
          publicName: `MS access service ${runId}`,
          durationMinutes: 60,
          isActive: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
        },
        {
          id: secondServiceId,
          categoryId,
          internalName: `MS access second ${runId}`,
          publicName: `MS access second ${runId}`,
          durationMinutes: 60,
          isActive: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
        },
      ],
    });
    await prisma.masterService.createMany({
      data: [
        {
          masterId,
          serviceId,
          isEnabled: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
        },
        {
          masterId,
          serviceId: secondServiceId,
          isEnabled: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
        },
        {
          masterId: secondMasterId,
          serviceId: secondServiceId,
          isEnabled: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
        },
      ],
    });

    // A holds FOR SHARE; B cannot commit UPDATE until A writes and commits.
    {
      const locked = deferred();
      const release = deferred();
      let updateSettled = false;
      const transactionA = prisma.$transaction(
        async (tx) => {
          await assignmentPolicy.lockAndAssertAppointmentServicePolicy(tx, {
            masterId,
            serviceId,
            policy: "INTERNAL",
          });
          locked.resolve();
          await release.promise;
          return tx.appointment.create({ data: appointmentData() });
        },
        { isolationLevel: "Serializable" },
      );

      await locked.promise;
      const transactionB = prisma.masterService
        .update({
          where: { masterId_serviceId: { masterId, serviceId } },
          data: { isEnabled: false },
        })
        .finally(() => {
          updateSettled = true;
        });

      await sleep(300);
      assert.equal(
        updateSettled,
        false,
        "concurrent masterService UPDATE must wait for policy lock",
      );
      release.resolve();
      await transactionA;
      await transactionB;
      await prisma.masterService.update({
        where: { masterId_serviceId: { masterId, serviceId } },
        data: { isEnabled: true },
      });
    }

    // The same lock must block DELETE of master_services.
    {
      const locked = deferred();
      const release = deferred();
      let deleteSettled = false;
      const transactionA = prisma.$transaction(async (tx) => {
        await assignmentPolicy.lockAndAssertAppointmentServicePolicy(tx, {
          masterId,
          serviceId,
          policy: "INTERNAL",
        });
        locked.resolve();
        await release.promise;
        return tx.appointment.create({ data: appointmentData() });
      });

      await locked.promise;
      const transactionB = prisma.masterService
        .delete({
          where: { masterId_serviceId: { masterId, serviceId } },
        })
        .finally(() => {
          deleteSettled = true;
        });
      await sleep(300);
      assert.equal(
        deleteSettled,
        false,
        "concurrent masterService DELETE must wait for policy lock",
      );
      release.resolve();
      await transactionA;
      await transactionB;
      await prisma.masterService.create({
        data: {
          masterId,
          serviceId,
          isEnabled: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
        },
      });
    }

    // Reverse order: disabled/deleted link commits first, then create rejects.
    await prisma.masterService.update({
      where: { masterId_serviceId: { masterId, serviceId } },
      data: { isEnabled: false },
    });
    await expectPolicyReject("INTERNAL");
    await prisma.masterService.delete({
      where: { masterId_serviceId: { masterId, serviceId } },
    });
    await expectPolicyReject("INTERNAL");
    await prisma.masterService.create({
      data: {
        masterId,
        serviceId,
        isEnabled: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
      },
    });

    await prisma.service.update({
      where: { id: serviceId },
      data: { isActive: false },
    });
    await expectPolicyReject("INTERNAL");
    await prisma.service.update({
      where: { id: serviceId },
      data: { isActive: true },
    });

    // Every PUBLIC_ONLINE policy factor is authoritative at write time.
    const publicMutations: Array<{
      disable: () => Promise<unknown>;
      restore: () => Promise<unknown>;
    }> = [
      {
        disable: () =>
          prisma.master.update({
            where: { id: masterId },
            data: { isActive: false },
          }),
        restore: () =>
          prisma.master.update({
            where: { id: masterId },
            data: { isActive: true },
          }),
      },
      {
        disable: () =>
          prisma.master.update({
            where: { id: masterId },
            data: { isPublic: false },
          }),
        restore: () =>
          prisma.master.update({
            where: { id: masterId },
            data: { isPublic: true },
          }),
      },
      {
        disable: () =>
          prisma.master.update({
            where: { id: masterId },
            data: { isOnlineBookingEnabled: false },
          }),
        restore: () =>
          prisma.master.update({
            where: { id: masterId },
            data: { isOnlineBookingEnabled: true },
          }),
      },
      {
        disable: () =>
          prisma.service.update({
            where: { id: serviceId },
            data: { isPublic: false },
          }),
        restore: () =>
          prisma.service.update({
            where: { id: serviceId },
            data: { isPublic: true },
          }),
      },
      {
        disable: () =>
          prisma.service.update({
            where: { id: serviceId },
            data: { isOnlineBookingEnabled: false },
          }),
        restore: () =>
          prisma.service.update({
            where: { id: serviceId },
            data: { isOnlineBookingEnabled: true },
          }),
      },
      {
        disable: () =>
          prisma.serviceCategory.update({
            where: { id: categoryId },
            data: { isPublic: false },
          }),
        restore: () =>
          prisma.serviceCategory.update({
            where: { id: categoryId },
            data: { isPublic: true },
          }),
      },
      {
        disable: () =>
          prisma.masterService.update({
            where: { masterId_serviceId: { masterId, serviceId } },
            data: { isPublic: false },
          }),
        restore: () =>
          prisma.masterService.update({
            where: { masterId_serviceId: { masterId, serviceId } },
            data: { isPublic: true },
          }),
      },
      {
        disable: () =>
          prisma.masterService.update({
            where: { masterId_serviceId: { masterId, serviceId } },
            data: { isOnlineBookingEnabled: false },
          }),
        restore: () =>
          prisma.masterService.update({
            where: { masterId_serviceId: { masterId, serviceId } },
            data: { isOnlineBookingEnabled: true },
          }),
      },
    ];

    for (const mutation of publicMutations) {
      await mutation.disable();
      try {
        await expectPolicyReject("PUBLIC_ONLINE");
      } finally {
        await mutation.restore();
      }
    }
    await createUnderPolicy("PUBLIC_ONLINE");

    // Production master-first service path observes master policy.
    assert.equal((await bookingService.listServicesForMaster(masterId)).length, 2);
    for (const data of [
      { isActive: false },
      { isPublic: false },
      { isOnlineBookingEnabled: false },
    ]) {
      await prisma.master.update({ where: { id: masterId }, data });
      assert.equal(
        (await bookingService.listServicesForMaster(masterId)).length,
        0,
      );
      await prisma.master.update({
        where: { id: masterId },
        data: {
          isActive: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
        },
      });
    }

    // Pair-changing PATCH locks the new pair; unrelated historical PATCH does not.
    const historical = await createUnderPolicy("INTERNAL");
    await appointmentService.updateAppointment(historical.id, {
      serviceId: secondServiceId,
    });
    await prisma.masterService.update({
      where: {
        masterId_serviceId: { masterId, serviceId: secondServiceId },
      },
      data: { isEnabled: false },
    });
    const unrelated = await appointmentService.updateAppointment(historical.id, {
      comment: `historical-unrelated:${runId}`,
    });
    assert.equal(
      unrelated.appointment.comment,
      `historical-unrelated:${runId}`,
    );

    // Deterministic stale-snapshot race: PATCH B starts first but enters its
    // transaction only after PATCH A commits M2/S2.
    const raced = await createUnderPolicy("INTERNAL");
    const patchBEntered = deferred();
    const releasePatchB = deferred();
    const patchBRuntime = appointmentService.createAppointmentServiceRuntime({
      runSerializableWrite: async (callback) => {
        patchBEntered.resolve();
        await releasePatchB.promise;
        return appointmentService.runSerializableAppointmentWrite(callback);
      },
    });
    const patchB = appointmentService.updateAppointment(
      raced.id,
      { comment: `race-comment:${runId}` },
      undefined,
      patchBRuntime,
    );
    await patchBEntered.promise;
    await appointmentService.updateAppointment(raced.id, {
      masterId: secondMasterId,
      serviceId: secondServiceId,
    });
    releasePatchB.resolve();
    await patchB;
    const racedAfter = await prisma.appointment.findUniqueOrThrow({
      where: { id: raced.id },
      select: { masterId: true, serviceId: true, comment: true },
    });
    assert.deepEqual(racedAfter, {
      masterId: secondMasterId,
      serviceId: secondServiceId,
      comment: `race-comment:${runId}`,
    });

    assert.throws(() =>
      assignmentPolicy.assertWritableIdNotExplicitlyCleared({
        fieldPresent: true,
        value: null,
        emptyMessage: assignmentPolicy.MASTER_SERVICE_ID_REQUIRED_MESSAGE,
      }),
    );
    assert.throws(() =>
      assignmentPolicy.assertWritableIdNotExplicitlyCleared({
        fieldPresent: true,
        value: null,
        emptyMessage: assignmentPolicy.MASTER_ID_REQUIRED_MESSAGE,
      }),
    );

    console.log("security-master-service-access-rules-db-check: OK");
  } finally {
    await prisma.appointment.deleteMany({
      where: { comment: { contains: runId } },
    });
    await prisma.masterService.deleteMany({
      where: { masterId: { in: [masterId, secondMasterId] } },
    });
    await prisma.service.deleteMany({
      where: { id: { in: [serviceId, secondServiceId] } },
    });
    await prisma.master.deleteMany({
      where: { id: { in: [masterId, secondMasterId] } },
    });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  }
}

void main();
