/**
 * Архивация старых тестовых услуг из seed (без физического удаления).
 *
 * Usage:
 *   npx tsx scripts/archive-seed-services.ts           # dry-run (default)
 *   npx tsx scripts/archive-seed-services.ts --apply   # применить
 */

import { PrismaClient } from "@prisma/client";
import { IMPORT_SERVICES } from "./data/import-services-data";

/** Фиксированные UUID из prisma/seed.ts — кроме 104, обновлённого импортом */
export const SEED_TEST_SERVICE_IDS = [
  "00000000-0000-4000-8000-000000000101",
  "00000000-0000-4000-8000-000000000102",
  "00000000-0000-4000-8000-000000000103",
  "00000000-0000-4000-8000-000000000105",
  "00000000-0000-4000-8000-000000000106",
  "00000000-0000-4000-8000-000000000107",
  "00000000-0000-4000-8000-000000000108",
] as const;

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

type ServiceReport = {
  id: string;
  category: string;
  internalName: string;
  publicName: string;
  isActive: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
  masterServicesCount: number;
  appointmentsCount: number;
  activeAppointmentsCount: number;
  bookingLinksCount: number;
  isImportedService: boolean;
  reason: string;
  willChange: boolean;
  plannedChanges: string[];
};

function isImportedService(
  categoryName: string,
  internalName: string,
): boolean {
  return IMPORT_SERVICES.some(
    (row) => row.category === categoryName && row.name === internalName,
  );
}

async function loadSeedTestServices(): Promise<ServiceReport[]> {
  const services = await prisma.service.findMany({
    where: { id: { in: [...SEED_TEST_SERVICE_IDS] } },
    include: {
      category: { select: { name: true } },
      _count: {
        select: {
          masterServices: true,
          appointments: true,
          bookingLinks: true,
        },
      },
    },
    orderBy: { id: "asc" },
  });

  if (services.length !== SEED_TEST_SERVICE_IDS.length) {
    const found = new Set(services.map((s) => s.id));
    const missing = SEED_TEST_SERVICE_IDS.filter((id) => !found.has(id));
    throw new Error(
      `Ожидалось ${SEED_TEST_SERVICE_IDS.length} seed-услуг, найдено ${services.length}. Отсутствуют: ${missing.join(", ")}`,
    );
  }

  const reports: ServiceReport[] = [];

  for (const service of services) {
    const imported = isImportedService(
      service.category.name,
      service.internalName,
    );

    const activeAppointments = await prisma.appointment.count({
      where: {
        serviceId: service.id,
        status: { not: "CANCELLED" },
      },
    });

    const plannedChanges: string[] = [];
    if (service.isActive) {
      plannedChanges.push("isActive: true → false");
    }
    if (service.isOnlineBookingEnabled) {
      plannedChanges.push("isOnlineBookingEnabled: true → false");
    }
    if (service.isPublic) {
      plannedChanges.push("isPublic: true → false");
    }

    const masterServicesToUpdate = await prisma.masterService.count({
      where: {
        serviceId: service.id,
        OR: [
          { isOnlineBookingEnabled: true },
          { isPublic: true },
          { isEnabled: true },
        ],
      },
    });
    if (masterServicesToUpdate > 0) {
      plannedChanges.push(
        `master_services (${masterServicesToUpdate}): isEnabled/isPublic/isOnlineBookingEnabled → false`,
      );
    }

    reports.push({
      id: service.id,
      category: service.category.name,
      internalName: service.internalName,
      publicName: service.publicName,
      isActive: service.isActive,
      isPublic: service.isPublic,
      isOnlineBookingEnabled: service.isOnlineBookingEnabled,
      masterServicesCount: service._count.masterServices,
      appointmentsCount: service._count.appointments,
      activeAppointmentsCount: activeAppointments,
      bookingLinksCount: service._count.bookingLinks,
      isImportedService: imported,
      reason: imported
        ? "ОШИБКА: совпадает с импортированной услугой — не трогать"
        : service.internalName.includes("(тест)") ||
            service.clientDescription?.includes("(тест)")
          ? "Seed-услуга с маркером «(тест)» и фиксированным UUID из seed.ts"
          : "Фиксированный UUID из seed.ts, не входит в массив импорта",
      willChange: !imported && plannedChanges.length > 0,
      plannedChanges,
    });
  }

  return reports;
}

function printReport(reports: ServiceReport[]) {
  console.log(
    apply ? "=== APPLY MODE ===" : "=== DRY-RUN MODE (no changes) ===",
  );
  console.log("");

  const blocked = reports.filter((r) => r.isImportedService);
  const toArchive = reports.filter((r) => r.willChange);
  const alreadyArchived = reports.filter(
    (r) => !r.isImportedService && !r.willChange,
  );

  console.log(`Найдено seed-тестовых услуг: ${reports.length}`);
  console.log(`К архивации: ${toArchive.length}`);
  console.log(`Уже архивные: ${alreadyArchived.length}`);
  console.log(`Заблокировано (импорт): ${blocked.length}`);
  console.log("");

  for (const item of reports) {
    console.log(`--- ${item.internalName} ---`);
    console.log(`  id: ${item.id}`);
    console.log(`  category: ${item.category}`);
    console.log(`  publicName: ${item.publicName}`);
    console.log(
      `  isActive: ${item.isActive}, isPublic: ${item.isPublic}, isOnlineBookingEnabled: ${item.isOnlineBookingEnabled}`,
    );
    console.log(`  master_services: ${item.masterServicesCount}`);
    console.log(
      `  appointments: ${item.appointmentsCount} (активных: ${item.activeAppointmentsCount})`,
    );
    console.log(`  booking_links: ${item.bookingLinksCount}`);
    console.log(`  причина: ${item.reason}`);
    if (item.plannedChanges.length > 0) {
      console.log(`  изменения:`);
      for (const change of item.plannedChanges) {
        console.log(`    - ${change}`);
      }
    } else {
      console.log(`  изменения: не требуются`);
    }
    console.log("");
  }

  const totalActiveAppts = reports.reduce(
    (sum, r) => sum + r.activeAppointmentsCount,
    0,
  );
  if (totalActiveAppts > 0) {
    console.log("--- РИСК ---");
    console.log(
      `  Есть ${totalActiveAppts} активных записей на тестовые услуги.`,
    );
    console.log(
      "  Записи НЕ удаляются и НЕ меняются — они останутся в расписании как исторические данные.",
    );
    console.log(
      "  Услуги перестанут быть доступны для новой онлайн-записи и выбора в UI.",
    );
    console.log("");
  } else {
    console.log("--- РИСК ---");
    console.log("  Активных записей на тестовые услуги нет.");
    console.log("");
  }

  const canApply = blocked.length === 0 && toArchive.length > 0;
  if (!apply) {
    console.log(
      canApply
        ? "Dry-run завершён. Можно запускать с --apply."
        : blocked.length > 0
          ? "Dry-run: apply заблокирован — найдены импортированные услуги среди seed ID."
          : "Dry-run: нечего менять — все seed-услуги уже архивные.",
    );
  }

  return canApply;
}

async function applyArchive(reports: ServiceReport[]) {
  const targets = reports.filter((r) => r.willChange);
  let servicesUpdated = 0;
  let masterServicesUpdated = 0;

  await prisma.$transaction(async (tx) => {
    for (const item of targets) {
      await tx.service.update({
        where: { id: item.id },
        data: {
          isActive: false,
          isPublic: false,
          isOnlineBookingEnabled: false,
        },
      });
      servicesUpdated += 1;

      const msResult = await tx.masterService.updateMany({
        where: { serviceId: item.id },
        data: {
          isEnabled: false,
          isPublic: false,
          isOnlineBookingEnabled: false,
        },
      });
      masterServicesUpdated += msResult.count;
    }
  });

  console.log("--- APPLY RESULT ---");
  console.log(`Services archived: ${servicesUpdated}`);
  console.log(`MasterService links updated: ${masterServicesUpdated}`);
}

async function main() {
  const reports = await loadSeedTestServices();
  const canApply = printReport(reports);

  if (!canApply) {
    process.exitCode = apply ? 1 : reports.some((r) => r.isImportedService) ? 1 : 0;
    if (apply) {
      console.error("\n--apply отменён.");
    }
    return;
  }

  if (!apply) {
    return;
  }

  await applyArchive(reports);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
