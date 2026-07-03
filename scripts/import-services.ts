/**
 * Импорт услуг студии «Твоё время».
 *
 * Usage:
 *   npx tsx scripts/import-services.ts           # dry-run (default)
 *   npx tsx scripts/import-services.ts --apply   # записать в БД
 */

import { Prisma, PrismaClient } from "@prisma/client";
import {
  CATEGORY_ORDER,
  IMPORT_SERVICES,
  MASTER_ALIASES,
  REQUIRED_MASTERS,
  type ImportServiceRow,
} from "./data/import-services-data";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

type DbMaster = {
  id: string;
  internalName: string;
  publicName: string;
  isActive: boolean;
};

type DbCategory = {
  id: string;
  name: string;
};

type DbService = {
  id: string;
  categoryId: string;
  internalName: string;
  publicName: string;
};

type ServicePlan = {
  row: ImportServiceRow;
  action: "create" | "update";
  serviceId?: string;
  categoryId?: string;
  categoryAction: "create" | "existing";
  masterId: string;
  masterCanonical: string;
  masterServiceAction: "create" | "update" | "unchanged";
  breakAfterMinutes: number;
};

function breakAfterMinutesFor(category: string): number {
  return category === "Перманентный макияж" ? 30 : 15;
}

function resolveCanonicalMaster(importName: string): string | null {
  for (const [canonical, aliases] of Object.entries(MASTER_ALIASES)) {
    if (aliases.includes(importName) || canonical === importName) {
      return canonical;
    }
  }
  return null;
}

function findDbMaster(
  masters: DbMaster[],
  canonical: string,
): DbMaster | undefined {
  const aliases = MASTER_ALIASES[canonical] ?? [canonical];
  return masters.find(
    (master) =>
      aliases.includes(master.publicName) ||
      aliases.includes(master.internalName) ||
      master.publicName === canonical ||
      master.internalName === canonical,
  );
}

function findCategory(categories: DbCategory[], name: string): DbCategory | undefined {
  return categories.find((category) => category.name === name);
}

function findService(
  services: DbService[],
  categoryId: string,
  name: string,
): DbService | undefined {
  const matches = services.filter(
    (service) =>
      service.categoryId === categoryId &&
      (service.internalName === name || service.publicName === name),
  );
  return matches[0];
}

function priceFields(row: ImportServiceRow): {
  price: null;
  priceFrom: Prisma.Decimal;
  priceTo: Prisma.Decimal | null;
} {
  return {
    price: null,
    priceFrom: new Prisma.Decimal(row.priceFrom),
    priceTo: row.priceTo != null ? new Prisma.Decimal(row.priceTo) : null,
  };
}

function detectImportDuplicates(): string[] {
  const seen = new Map<string, number>();
  const errors: string[] = [];
  for (const row of IMPORT_SERVICES) {
    const key = `${row.category}::${row.name}`;
    if (seen.has(key)) {
      errors.push(
        `Дубль в массиве импорта: №${row.num} и №${seen.get(key)} — «${row.name}»`,
      );
    } else {
      seen.set(key, row.num);
    }
  }
  return errors;
}

async function buildPlan() {
  const importDuplicates = detectImportDuplicates();
  const todos: string[] = [];
  const errors: string[] = [...importDuplicates];

  for (const row of IMPORT_SERVICES) {
    if (row.todos?.length) {
      todos.push(`№${row.num} «${row.name}»: ${row.todos.join("; ")}`);
    }
  }

  const dbMasters = await prisma.master.findMany({
    select: { id: true, internalName: true, publicName: true, isActive: true },
  });

  const masterMap = new Map<string, DbMaster>();
  for (const canonical of REQUIRED_MASTERS) {
    const found = findDbMaster(dbMasters, canonical);
    if (!found) {
      errors.push(`Мастер не найден в БД: ${canonical}`);
      continue;
    }
    if (!found.isActive) {
      todos.push(
        `Мастер «${canonical}» найден, но isActive=false (id=${found.id})`,
      );
    }
    masterMap.set(canonical, found);
  }

  const dbCategories = await prisma.serviceCategory.findMany({
    select: { id: true, name: true },
  });

  const dbServices = await prisma.service.findMany({
    select: { id: true, categoryId: true, internalName: true, publicName: true },
  });

  const dbMasterServices = await prisma.masterService.findMany({
    select: { masterId: true, serviceId: true },
  });

  const plans: ServicePlan[] = [];
  const possibleDbDuplicates: string[] = [];

  for (const row of IMPORT_SERVICES) {
    const canonical = resolveCanonicalMaster(row.master);
    if (!canonical) {
      errors.push(`№${row.num}: неизвестный мастер «${row.master}»`);
      continue;
    }

    const master = masterMap.get(canonical);
    if (!master) {
      continue;
    }

    const existingCategory = findCategory(dbCategories, row.category);
    const categoryAction = existingCategory ? "existing" : "create";
    const categoryId = existingCategory?.id;

    let serviceAction: "create" | "update" = "create";
    let serviceId: string | undefined;

    if (categoryId) {
      const sameName = dbServices.filter(
        (service) =>
          service.categoryId === categoryId &&
          (service.internalName === row.name || service.publicName === row.name),
      );
      if (sameName.length > 1) {
        possibleDbDuplicates.push(
          `№${row.num} «${row.name}»: в БД ${sameName.length} совпадений по названию`,
        );
      }
      const existing = findService(dbServices, categoryId, row.name);
      if (existing) {
        serviceAction = "update";
        serviceId = existing.id;
      }
    }

    const masterServiceAction: ServicePlan["masterServiceAction"] =
      serviceAction === "update" &&
      serviceId &&
      dbMasterServices.some(
        (link) => link.masterId === master.id && link.serviceId === serviceId,
      )
        ? "update"
        : serviceAction === "update" && serviceId
          ? "create"
          : "create";

    plans.push({
      row,
      action: serviceAction,
      serviceId,
      categoryId,
      categoryAction,
      masterId: master.id,
      masterCanonical: canonical,
      masterServiceAction,
      breakAfterMinutes: breakAfterMinutesFor(row.category),
    });
  }

  return { plans, errors, todos, possibleDbDuplicates, masterMap };
}

function printReport(
  plans: ServicePlan[],
  errors: string[],
  todos: string[],
  possibleDbDuplicates: string[],
  masterMap: Map<string, DbMaster>,
) {
  const creates = plans.filter((plan) => plan.action === "create");
  const updates = plans.filter((plan) => plan.action === "update");
  const categoriesToCreate = [
    ...new Set(
      plans
        .filter((plan) => plan.categoryAction === "create")
        .map((plan) => plan.row.category),
    ),
  ];
  const onlineTrue = plans.filter((plan) => plan.row.isOnlineBookingEnabled);
  const onlineFalse = plans.filter((plan) => !plan.row.isOnlineBookingEnabled);
  const msCreates = plans.filter((plan) => plan.masterServiceAction === "create");
  const msUpdates = plans.filter((plan) => plan.masterServiceAction === "update");

  console.log(apply ? "=== APPLY MODE ===" : "=== DRY-RUN MODE (no changes) ===");
  console.log("");
  console.log("--- SUMMARY ---");
  console.log(`Услуг в массиве: ${IMPORT_SERVICES.length}`);
  console.log(`Категорий к созданию: ${categoriesToCreate.length}`);
  console.log(`Услуг к созданию: ${creates.length}`);
  console.log(`Услуг к обновлению: ${updates.length}`);
  console.log(`Связей master_services к созданию: ${msCreates.length}`);
  console.log(`Связей master_services к обновлению: ${msUpdates.length}`);
  console.log(`isOnlineBookingEnabled=true: ${onlineTrue.length}`);
  console.log(`isOnlineBookingEnabled=false: ${onlineFalse.length}`);
  console.log("");

  console.log("--- МАСТЕРА ---");
  for (const canonical of REQUIRED_MASTERS) {
    const master = masterMap.get(canonical);
    if (master) {
      console.log(
        `  ✓ ${canonical} → id=${master.id} (${master.publicName} / ${master.internalName})`,
      );
    } else {
      console.log(`  ✗ ${canonical} — НЕ НАЙДЕН`);
    }
  }
  console.log("");

  if (categoriesToCreate.length > 0) {
    console.log("--- КАТЕГОРИИ К СОЗДАНИЮ ---");
    for (const name of categoriesToCreate) {
      console.log(`  + ${name} (sortOrder=${CATEGORY_ORDER[name] ?? "?"})`);
    }
    console.log("");
  }

  console.log("--- УСЛУГИ К СОЗДАНИЮ ---");
  for (const plan of creates) {
    const price = plan.row.priceTo
      ? `${plan.row.priceFrom}–${plan.row.priceTo} ₽`
      : `${plan.row.priceFrom} ₽`;
    console.log(
      `  + №${plan.row.num} [${plan.row.category}] «${plan.row.name}» | ${plan.masterCanonical} | ${price} | ${plan.row.durationMinutes} мин | online=${plan.row.isOnlineBookingEnabled} | break=${plan.breakAfterMinutes}`,
    );
  }
  console.log("");

  console.log("--- УСЛУГИ К ОБНОВЛЕНИЮ ---");
  if (updates.length === 0) {
    console.log("  (нет)");
  }
  for (const plan of updates) {
    console.log(
      `  ~ №${plan.row.num} id=${plan.serviceId} «${plan.row.name}» | online=${plan.row.isOnlineBookingEnabled}`,
    );
  }
  console.log("");

  console.log("--- ОНЛАЙН-ЗАПИСЬ: ДА ---");
  for (const plan of onlineTrue) {
    console.log(`  ✓ №${plan.row.num} «${plan.row.name}»`);
  }
  console.log("");

  console.log("--- ОНЛАЙН-ЗАПИСЬ: НЕТ ---");
  for (const plan of onlineFalse) {
    console.log(`  – №${plan.row.num} «${plan.row.name}»`);
  }
  console.log("");

  if (possibleDbDuplicates.length > 0) {
    console.log("--- ВОЗМОЖНЫЕ ДУБЛИ В БД ---");
    for (const item of possibleDbDuplicates) {
      console.log(`  ? ${item}`);
    }
    console.log("");
  }

  if (todos.length > 0) {
    console.log("--- TODO ---");
    for (const item of todos) {
      console.log(`  ! ${item}`);
    }
    console.log("");
  }

  if (errors.length > 0) {
    console.log("--- ОШИБКИ ---");
    for (const item of errors) {
      console.log(`  ✗ ${item}`);
    }
    console.log("");
  }

  const canApply = errors.length === 0 && todos.length === 0;
  if (!apply) {
    console.log(
      canApply
        ? "Dry-run завершён. Можно запускать с --apply."
        : "Dry-run завершён. --apply заблокирован до устранения ошибок/TODO.",
    );
  }

  return canApply;
}

async function applyPlan(plans: ServicePlan[]) {
  const categoryCache = new Map<string, string>();

  const existingCategories = await prisma.serviceCategory.findMany({
    select: { id: true, name: true },
  });
  for (const category of existingCategories) {
    categoryCache.set(category.name, category.id);
  }

  let createdCategories = 0;
  let createdServices = 0;
  let updatedServices = 0;
  let createdLinks = 0;
  let updatedLinks = 0;

  await prisma.$transaction(async (tx) => {
    for (const plan of plans) {
      let categoryId = categoryCache.get(plan.row.category);
      if (!categoryId) {
        const created = await tx.serviceCategory.create({
          data: {
            name: plan.row.category,
            sortOrder: CATEGORY_ORDER[plan.row.category] ?? plan.row.num,
            isActive: true,
            isPublic: true,
          },
        });
        categoryId = created.id;
        categoryCache.set(plan.row.category, categoryId);
        createdCategories += 1;
      }

      const prices = priceFields(plan.row);
      const serviceData = {
        categoryId,
        internalName: plan.row.name,
        publicName: plan.row.name,
        clientDescription: plan.row.clientDescription ?? null,
        durationMinutes: plan.row.durationMinutes,
        breakAfterMinutes: plan.breakAfterMinutes,
        price: prices.price,
        priceFrom: prices.priceFrom,
        priceTo: prices.priceTo,
        sortOrder: plan.row.num,
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: plan.row.isOnlineBookingEnabled,
      };

      let serviceId = plan.serviceId;

      if (plan.action === "update" && serviceId) {
        await tx.service.update({
          where: { id: serviceId },
          data: serviceData,
        });
        updatedServices += 1;
      } else {
        const created = await tx.service.create({ data: serviceData });
        serviceId = created.id;
        createdServices += 1;
      }

      const linkData = {
        isEnabled: true,
        isPublic: true,
        isOnlineBookingEnabled: plan.row.isOnlineBookingEnabled,
        sortOrder: plan.row.num,
      };

      const existingLink = await tx.masterService.findUnique({
        where: {
          masterId_serviceId: {
            masterId: plan.masterId,
            serviceId: serviceId!,
          },
        },
      });

      if (existingLink) {
        await tx.masterService.update({
          where: {
            masterId_serviceId: {
              masterId: plan.masterId,
              serviceId: serviceId!,
            },
          },
          data: linkData,
        });
        updatedLinks += 1;
      } else {
        await tx.masterService.create({
          data: {
            masterId: plan.masterId,
            serviceId: serviceId!,
            ...linkData,
          },
        });
        createdLinks += 1;
      }
    }
  });

  console.log("--- APPLY RESULT ---");
  console.log(`Categories created: ${createdCategories}`);
  console.log(`Services created: ${createdServices}`);
  console.log(`Services updated: ${updatedServices}`);
  console.log(`MasterService created: ${createdLinks}`);
  console.log(`MasterService updated: ${updatedLinks}`);
}

async function main() {
  const { plans, errors, todos, possibleDbDuplicates, masterMap } =
    await buildPlan();

  const canApply = printReport(
    plans,
    errors,
    todos,
    possibleDbDuplicates,
    masterMap,
  );

  if (!canApply) {
    process.exitCode = 1;
    if (apply) {
      console.error("\n--apply отменён: есть ошибки или TODO.");
    }
    return;
  }

  if (!apply) {
    return;
  }

  await applyPlan(plans);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
