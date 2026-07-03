/**
 * One-off script: merge duplicate Anna master into primary.
 *
 * Usage:
 *   npx tsx scripts/merge-anna-duplicate.ts           # dry-run (default)
 *   npx tsx scripts/merge-anna-duplicate.ts --apply   # execute merge
 */

import { PrismaClient, type Appointment, type ScheduleBlock } from "@prisma/client";

const PRIMARY_ID = "821960ea-c41f-409e-902a-1a54206df128";
const DUPLICATE_ID = "867963c1-5b19-4ead-af70-cb7d8e000a71";
const DUPLICATE_USER_EMAIL = "master1@example.local";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

type TimeInterval = { startsAt: Date; endsAt: Date };

function intervalsOverlap(left: TimeInterval, right: TimeInterval): boolean {
  return left.startsAt < right.endsAt && right.startsAt < left.endsAt;
}

function blockInterval(block: ScheduleBlock): TimeInterval | null {
  if (block.isFullDay && block.blockDate) {
    const dayStart = new Date(block.blockDate);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    return { startsAt: dayStart, endsAt: dayEnd };
  }
  if (block.startsAt && block.endsAt) {
    return { startsAt: block.startsAt, endsAt: block.endsAt };
  }
  return null;
}

function isActiveAppointment(appointment: Appointment): boolean {
  return appointment.status !== "CANCELLED";
}

type Conflict = {
  kind: string;
  detail: string;
};

async function loadData() {
  const [primary, duplicate] = await Promise.all([
    prisma.master.findUnique({
      where: { id: PRIMARY_ID },
      include: { user: { select: { id: true, email: true, isActive: true } } },
    }),
    prisma.master.findUnique({
      where: { id: DUPLICATE_ID },
      include: { user: { select: { id: true, email: true, isActive: true } } },
    }),
  ]);

  if (!primary || !duplicate) {
    throw new Error("Primary or duplicate master not found");
  }

  const [
    dupAppointments,
    priAppointments,
    dupBlocks,
    priBlocks,
    dupExtraWork,
    priExtraWork,
    dupServices,
    priServices,
    dupBookingLinks,
  ] = await Promise.all([
    prisma.appointment.findMany({ where: { masterId: DUPLICATE_ID } }),
    prisma.appointment.findMany({ where: { masterId: PRIMARY_ID } }),
    prisma.scheduleBlock.findMany({ where: { masterId: DUPLICATE_ID } }),
    prisma.scheduleBlock.findMany({ where: { masterId: PRIMARY_ID } }),
    prisma.extraWorkWindow.findMany({ where: { masterId: DUPLICATE_ID } }),
    prisma.extraWorkWindow.findMany({ where: { masterId: PRIMARY_ID } }),
    prisma.masterService.findMany({ where: { masterId: DUPLICATE_ID } }),
    prisma.masterService.findMany({ where: { masterId: PRIMARY_ID } }),
    prisma.bookingLink.findMany({ where: { masterId: DUPLICATE_ID } }),
  ]);

  return {
    primary,
    duplicate,
    dupAppointments,
    priAppointments,
    dupBlocks,
    priBlocks,
    dupExtraWork,
    priExtraWork,
    dupServices,
    priServices,
    dupBookingLinks,
  };
}

function detectConflicts(data: Awaited<ReturnType<typeof loadData>>): Conflict[] {
  const conflicts: Conflict[] = [];
  const activeDup = data.dupAppointments.filter(isActiveAppointment);
  const activePri = data.priAppointments.filter(isActiveAppointment);

  for (const dup of activeDup) {
    for (const pri of activePri) {
      if (intervalsOverlap(dup, pri)) {
        conflicts.push({
          kind: "appointment_vs_appointment",
          detail: `Дубль «${dup.clientName}» ${dup.startsAt.toISOString()}–${dup.endsAt.toISOString()} пересекается с основной «${pri.clientName}» ${pri.startsAt.toISOString()}–${pri.endsAt.toISOString()}`,
        });
      }
    }
  }

  for (const block of data.dupBlocks) {
    const blockTime = blockInterval(block);
    if (!blockTime) {
      continue;
    }

    for (const pri of activePri) {
      if (intervalsOverlap(blockTime, pri)) {
        conflicts.push({
          kind: "dup_block_vs_pri_appointment",
          detail: `Блок дубля ${block.blockType}${block.isFullDay ? " (весь день)" : ""} id=${block.id} конфликтует с записью основной «${pri.clientName}» ${pri.startsAt.toISOString()}–${pri.endsAt.toISOString()}`,
        });
      }
    }
  }

  for (const dup of activeDup) {
    for (const block of data.priBlocks) {
      const blockTime = blockInterval(block);
      if (!blockTime) {
        continue;
      }
      if (intervalsOverlap(dup, blockTime)) {
        conflicts.push({
          kind: "dup_appointment_vs_pri_block",
          detail: `Запись дубля «${dup.clientName}» ${dup.startsAt.toISOString()} конфликтует с блоком основной ${block.blockType}${block.isFullDay ? " (весь день)" : ""} id=${block.id}`,
        });
      }
    }
  }

  for (const dupBlock of data.dupBlocks) {
    for (const priBlock of data.priBlocks) {
      if (
        dupBlock.isFullDay &&
        priBlock.isFullDay &&
        dupBlock.blockDate &&
        priBlock.blockDate &&
        dupBlock.blockDate.getTime() === priBlock.blockDate.getTime()
      ) {
        conflicts.push({
          kind: "full_day_block_same_date",
          detail: `Оба full-day блока на ${dupBlock.blockDate.toISOString()}: дубль ${dupBlock.blockType} id=${dupBlock.id}, основная ${priBlock.blockType} id=${priBlock.id}`,
        });
      }

      const dupTime = blockInterval(dupBlock);
      const priTime = blockInterval(priBlock);
      if (
        dupTime &&
        priTime &&
        !dupBlock.isFullDay &&
        !priBlock.isFullDay &&
        intervalsOverlap(dupTime, priTime)
      ) {
        conflicts.push({
          kind: "interval_block_overlap",
          detail: `Интервальные блоки пересекаются: дубль id=${dupBlock.id} ${dupTime.startsAt.toISOString()}, основная id=${priBlock.id} ${priTime.startsAt.toISOString()}`,
        });
      }
    }
  }

  return conflicts;
}

async function main() {
  console.log(apply ? "=== APPLY MODE ===" : "=== DRY-RUN MODE (no changes) ===");
  console.log(`Primary:   ${PRIMARY_ID} (master@example.local)`);
  console.log(`Duplicate: ${DUPLICATE_ID} (master1@example.local)`);
  console.log("");

  const data = await loadData();

  const conflicts = detectConflicts(data);
  const priServiceIds = new Set(data.priServices.map((s) => s.serviceId));
  const servicesToMove = data.dupServices.filter(
    (s) => !priServiceIds.has(s.serviceId),
  );
  const servicesToSkip = data.dupServices.filter((s) =>
    priServiceIds.has(s.serviceId),
  );

  console.log("--- PLANNED ACTIONS ---");
  console.log(`Appointments to reassign: ${data.dupAppointments.length}`);
  for (const a of data.dupAppointments) {
    console.log(
      `  - ${a.id} [${a.status}] ${a.clientName} ${a.startsAt.toISOString()}`,
    );
  }

  console.log(`Schedule blocks to reassign: ${data.dupBlocks.length}`);
  for (const b of data.dupBlocks) {
    console.log(
      `  - ${b.id} ${b.blockType}${b.isFullDay ? " FULL_DAY" : ""} ${b.startsAt?.toISOString() ?? b.blockDate?.toISOString() ?? ""}`,
    );
  }

  console.log(`Extra work windows to reassign: ${data.dupExtraWork.length}`);
  console.log(`Master services to move: ${servicesToMove.length}`);
  console.log(`Master services to skip (duplicate serviceId): ${servicesToSkip.length}`);
  for (const s of servicesToSkip) {
    console.log(`  - skip serviceId=${s.serviceId}`);
  }

  console.log(`Booking links to reassign: ${data.dupBookingLinks.length}`);
  console.log(`Deactivate duplicate master: isActive=false`);
  console.log(
    `Deactivate duplicate user: ${data.duplicate.user?.email ?? DUPLICATE_USER_EMAIL} isActive=false`,
  );
  console.log("");

  if (conflicts.length > 0) {
    console.log("--- CONFLICTS DETECTED: AUTO-MERGE BLOCKED ---");
    for (const c of conflicts) {
      console.log(`[${c.kind}] ${c.detail}`);
    }
    console.log("");
    console.log(
      "Resolve conflicts manually, then re-run dry-run before --apply.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("--- CONFLICT CHECK: OK (no conflicts) ---");
  console.log("");

  if (!apply) {
    console.log("Dry-run complete. Re-run with --apply to execute merge.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const movedAppointments = await tx.appointment.updateMany({
      where: { masterId: DUPLICATE_ID },
      data: { masterId: PRIMARY_ID },
    });

    const movedBlocks = await tx.scheduleBlock.updateMany({
      where: { masterId: DUPLICATE_ID },
      data: { masterId: PRIMARY_ID },
    });

    const movedExtraWork = await tx.extraWorkWindow.updateMany({
      where: { masterId: DUPLICATE_ID },
      data: { masterId: PRIMARY_ID },
    });

    const movedBookingLinks = await tx.bookingLink.updateMany({
      where: { masterId: DUPLICATE_ID },
      data: { masterId: PRIMARY_ID },
    });

    let movedServices = 0;
    for (const service of servicesToMove) {
      await tx.masterService.update({
        where: {
          masterId_serviceId: {
            masterId: DUPLICATE_ID,
            serviceId: service.serviceId,
          },
        },
        data: { masterId: PRIMARY_ID },
      });
      movedServices += 1;
    }

    await tx.master.update({
      where: { id: DUPLICATE_ID },
      data: { isActive: false },
    });

    if (data.duplicate.userId) {
      await tx.user.update({
        where: { id: data.duplicate.userId },
        data: { isActive: false },
      });
    }

    return {
      movedAppointments: movedAppointments.count,
      movedBlocks: movedBlocks.count,
      movedExtraWork: movedExtraWork.count,
      movedBookingLinks: movedBookingLinks.count,
      movedServices,
      skippedServices: servicesToSkip.length,
    };
  });

  const activeAnnas = await prisma.master.count({
    where: {
      isActive: true,
      internalName: "Анна И.",
    },
  });

  console.log("--- APPLY RESULT ---");
  console.log(`Appointments moved: ${result.movedAppointments}`);
  console.log(`Schedule blocks moved: ${result.movedBlocks}`);
  console.log(`Extra work windows moved: ${result.movedExtraWork}`);
  console.log(`Booking links moved: ${result.movedBookingLinks}`);
  console.log(`Master services moved: ${result.movedServices}`);
  console.log(`Master services skipped: ${result.skippedServices}`);
  console.log(`Duplicate master deactivated: yes`);
  console.log(`Duplicate user deactivated: yes`);
  console.log(`Active «Анна И.» masters remaining: ${activeAnnas}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
