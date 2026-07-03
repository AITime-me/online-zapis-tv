/**
 * Исправление ошибочных привязок master_services после импорта.
 *
 * Usage:
 *   npx tsx scripts/fix-master-service-bindings.ts           # dry-run (default)
 *   npx tsx scripts/fix-master-service-bindings.ts --apply   # применить
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

type MasterLinkTarget = {
  masterKey: "ksenia" | "tatyana" | "irina_b";
  displayName: string;
  match: (internalName: string, publicName: string) => boolean;
};

const MASTERS: MasterLinkTarget[] = [
  {
    masterKey: "ksenia",
    displayName: "Ксения Вайзер",
    match: (internal, pub) =>
      internal.includes("Ксения") || pub.includes("Ксения"),
  },
  {
    masterKey: "tatyana",
    displayName: "Татьяна Федулова",
    match: (internal, pub) =>
      internal.includes("Татьяна") || pub.includes("Татьяна"),
  },
  {
    masterKey: "irina_b",
    displayName: "Ирина Белизина",
    match: (internal, pub) =>
      (internal.includes("Ирина") && internal.includes("Б")) ||
      pub.includes("Белизина"),
  },
];

type ServiceFixRule = {
  publicName: string;
  categoryName: string;
  expectedPrice: number;
  expectedDuration: number;
  enableMasterKey: MasterLinkTarget["masterKey"];
  disableMasterKeys: MasterLinkTarget["masterKey"][];
};

const FIX_RULES: ServiceFixRule[] = [
  {
    publicName: "Комплекс омоложения кожи рук",
    categoryName: "Уход за кожей рук",
    expectedPrice: 2500,
    expectedDuration: 60,
    enableMasterKey: "ksenia",
    disableMasterKeys: ["tatyana"],
  },
  {
    publicName: "Реконструкция ресниц Velvet / Вельвет ресниц",
    categoryName: "Ресницы",
    expectedPrice: 2500,
    expectedDuration: 90,
    enableMasterKey: "tatyana",
    disableMasterKeys: ["irina_b"],
  },
];

type LinkSnapshot = {
  masterId: string;
  masterInternalName: string;
  masterPublicName: string;
  isEnabled: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
};

type PlannedLinkChange =
  | {
      action: "disable";
      masterId: string;
      masterName: string;
      serviceId: string;
      serviceName: string;
      before: Pick<
        LinkSnapshot,
        "isEnabled" | "isPublic" | "isOnlineBookingEnabled"
      >;
    }
  | {
      action: "enable";
      masterId: string;
      masterName: string;
      serviceId: string;
      serviceName: string;
      before: Pick<
        LinkSnapshot,
        "isEnabled" | "isPublic" | "isOnlineBookingEnabled"
      > | null;
    }
  | {
      action: "create";
      masterId: string;
      masterName: string;
      serviceId: string;
      serviceName: string;
    }
  | {
      action: "unchanged";
      masterId: string;
      masterName: string;
      serviceId: string;
      serviceName: string;
    };

function formatFlags(link: {
  isEnabled: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
}): string {
  return `enabled=${link.isEnabled}, public=${link.isPublic}, online=${link.isOnlineBookingEnabled}`;
}

function priceMatches(value: unknown, expected: number): boolean {
  if (value == null) {
    return false;
  }
  return Number(value) === expected;
}

async function main() {
  const dbMasters = await prisma.master.findMany({
    select: {
      id: true,
      internalName: true,
      publicName: true,
      isActive: true,
    },
    orderBy: { sortOrder: "asc" },
  });

  const masterByKey = new Map<MasterLinkTarget["masterKey"], (typeof dbMasters)[number]>();

  for (const target of MASTERS) {
    const matches = dbMasters.filter((master) =>
      target.match(master.internalName, master.publicName),
    );
    if (matches.length !== 1) {
      throw new Error(
        `Мастер «${target.displayName}»: ожидался 1 match, найдено ${matches.length}`,
      );
    }
    masterByKey.set(target.masterKey, matches[0]!);
  }

  console.log("=== Мастера ===");
  for (const target of MASTERS) {
    const master = masterByKey.get(target.masterKey)!;
    console.log(
      `- ${target.displayName}: ${master.internalName} / ${master.publicName} (${master.id})`,
    );
  }
  console.log("");

  const allPlannedChanges: PlannedLinkChange[] = [];
  let safeToApply = true;

  for (const rule of FIX_RULES) {
    console.log("=".repeat(72));
    console.log(`Услуга: ${rule.publicName}`);
    console.log(`Категория: ${rule.categoryName}`);

    const services = await prisma.service.findMany({
      where: {
        publicName: rule.publicName,
        category: { name: rule.categoryName },
      },
      include: {
        category: { select: { name: true } },
        masterServices: {
          include: {
            master: {
              select: { id: true, internalName: true, publicName: true },
            },
          },
        },
      },
    });

    if (services.length !== 1) {
      safeToApply = false;
      console.log(
        `ОШИБКА: найдено услуг ${services.length}, ожидалась ровно 1.`,
      );
      console.log("");
      continue;
    }

    const service = services[0]!;
    const priceOk =
      priceMatches(service.priceFrom, rule.expectedPrice) ||
      priceMatches(service.price, rule.expectedPrice);
    const durationOk = service.durationMinutes === rule.expectedDuration;

    console.log(`ID: ${service.id}`);
    console.log(
      `Цена: from=${service.priceFrom ?? "—"}, to=${service.priceTo ?? "—"}, price=${service.price ?? "—"} ${priceOk ? "OK" : "(!)"}`,
    );
    console.log(
      `Длительность: ${service.durationMinutes} мин ${durationOk ? "OK" : "(!)"}`,
    );
    if (!priceOk || !durationOk) {
      console.log(
        "ПРЕДУПРЕЖДЕНИЕ: параметры услуги не совпали с ожидаемыми (скрипт их не меняет).",
      );
    }

    const appointments = await prisma.appointment.findMany({
      where: { serviceId: service.id },
      select: {
        id: true,
        startsAt: true,
        status: true,
        master: { select: { internalName: true, publicName: true } },
        clientName: true,
      },
      orderBy: { startsAt: "desc" },
    });

    console.log("");
    console.log("Текущие связи master_services:");
    if (service.masterServices.length === 0) {
      console.log("  (нет)");
    } else {
      for (const link of service.masterServices) {
        console.log(
          `  - ${link.master.internalName} (${link.master.publicName}): ${formatFlags(link)}`,
        );
      }
    }

    console.log("");
    console.log("Записи appointments по этой услуге:");
    if (appointments.length === 0) {
      console.log("  (нет)");
    } else {
      for (const appointment of appointments) {
        console.log(
          `  - ${appointment.id} | ${appointment.startsAt.toISOString()} | ${appointment.status} | ${appointment.master.internalName} | ${appointment.clientName}`,
        );
      }
      console.log(
        "  Примечание: appointments не будут изменены; только отчёт.",
      );
    }

    const enableMaster = masterByKey.get(rule.enableMasterKey)!;
    const disableMasters = rule.disableMasterKeys.map(
      (key) => masterByKey.get(key)!,
    );

    const linkByMasterId = new Map(
      service.masterServices.map((link) => [link.masterId, link]),
    );

    const plannedForService: PlannedLinkChange[] = [];

    for (const disableMaster of disableMasters) {
      const existing = linkByMasterId.get(disableMaster.id);
      if (!existing) {
        plannedForService.push({
          action: "unchanged",
          masterId: disableMaster.id,
          masterName: disableMaster.internalName,
          serviceId: service.id,
          serviceName: service.publicName,
        });
        continue;
      }

      const alreadyDisabled =
        !existing.isEnabled &&
        !existing.isPublic &&
        !existing.isOnlineBookingEnabled;

      if (alreadyDisabled) {
        plannedForService.push({
          action: "unchanged",
          masterId: disableMaster.id,
          masterName: disableMaster.internalName,
          serviceId: service.id,
          serviceName: service.publicName,
        });
        continue;
      }

      plannedForService.push({
        action: "disable",
        masterId: disableMaster.id,
        masterName: disableMaster.internalName,
        serviceId: service.id,
        serviceName: service.publicName,
        before: {
          isEnabled: existing.isEnabled,
          isPublic: existing.isPublic,
          isOnlineBookingEnabled: existing.isOnlineBookingEnabled,
        },
      });
    }

    const enableExisting = linkByMasterId.get(enableMaster.id);
    if (!enableExisting) {
      plannedForService.push({
        action: "create",
        masterId: enableMaster.id,
        masterName: enableMaster.internalName,
        serviceId: service.id,
        serviceName: service.publicName,
      });
    } else {
      const alreadyEnabled =
        enableExisting.isEnabled &&
        enableExisting.isPublic &&
        enableExisting.isOnlineBookingEnabled;

      if (alreadyEnabled) {
        plannedForService.push({
          action: "unchanged",
          masterId: enableMaster.id,
          masterName: enableMaster.internalName,
          serviceId: service.id,
          serviceName: service.publicName,
        });
      } else {
        plannedForService.push({
          action: "enable",
          masterId: enableMaster.id,
          masterName: enableMaster.internalName,
          serviceId: service.id,
          serviceName: service.publicName,
          before: {
            isEnabled: enableExisting.isEnabled,
            isPublic: enableExisting.isPublic,
            isOnlineBookingEnabled: enableExisting.isOnlineBookingEnabled,
          },
        });
      }
    }

    console.log("");
    console.log("План изменений master_services:");
    for (const change of plannedForService) {
      if (change.action === "disable") {
        console.log(
          `  DISABLE ${change.masterName}: ${formatFlags(change.before)} → enabled=false, public=false, online=false`,
        );
      } else if (change.action === "enable") {
        console.log(
          `  ENABLE  ${change.masterName}: ${formatFlags(change.before!)} → enabled=true, public=true, online=true`,
        );
      } else if (change.action === "create") {
        console.log(
          `  CREATE  ${change.masterName}: (нет связи) → enabled=true, public=true, online=true`,
        );
      } else {
        console.log(`  OK      ${change.masterName}: уже корректно / связи нет`);
      }
    }

    allPlannedChanges.push(...plannedForService);
    console.log("");
  }

  const actionable = allPlannedChanges.filter(
    (change) => change.action !== "unchanged",
  );

  console.log("=".repeat(72));
  console.log(`Режим: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Всего изменений: ${actionable.length}`);

  if (actionable.length === 0) {
    console.log("Нечего менять — привязки уже корректны.");
  } else if (!apply) {
    console.log("Apply не запускался. Для применения:");
    console.log("  npx tsx scripts/fix-master-service-bindings.ts --apply");
  }

  console.log(`Безопасно запускать apply: ${safeToApply ? "ДА" : "НЕТ"}`);

  if (apply) {
    if (!safeToApply) {
      throw new Error("Apply отменён: есть блокирующие проблемы в dry-run.");
    }

    let disabled = 0;
    let enabled = 0;
    let created = 0;

    for (const change of actionable) {
      if (change.action === "disable") {
        await prisma.masterService.update({
          where: {
            masterId_serviceId: {
              masterId: change.masterId,
              serviceId: change.serviceId,
            },
          },
          data: {
            isEnabled: false,
            isPublic: false,
            isOnlineBookingEnabled: false,
          },
        });
        disabled += 1;
      } else if (change.action === "enable") {
        await prisma.masterService.update({
          where: {
            masterId_serviceId: {
              masterId: change.masterId,
              serviceId: change.serviceId,
            },
          },
          data: {
            isEnabled: true,
            isPublic: true,
            isOnlineBookingEnabled: true,
          },
        });
        enabled += 1;
      } else if (change.action === "create") {
        await prisma.masterService.create({
          data: {
            masterId: change.masterId,
            serviceId: change.serviceId,
            isEnabled: true,
            isPublic: true,
            isOnlineBookingEnabled: true,
          },
        });
        created += 1;
      }
    }

    console.log("");
    console.log(`Применено: disabled=${disabled}, enabled=${enabled}, created=${created}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
