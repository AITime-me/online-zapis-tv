/**
 * Ядро безопасного импорта каталога услуг (без side effects при импорте модуля).
 * CLI: scripts/import-services.ts
 */

import { Prisma } from "@prisma/client";
import {
  CATEGORY_ORDER,
  IMPORT_SERVICES,
  MASTER_ALIASES,
  REQUIRED_MASTERS,
  type ImportServiceRow,
} from "../data/import-services-data";

export const ALLOWED_IMPORT_FLAGS = [
  "--apply",
  "--confirm-staging",
  "--disable-stale-bindings",
] as const;

export type ImportServicesCliFlags = {
  apply: boolean;
  confirmStaging: boolean;
  disableStaleBindings: boolean;
};

export type DbMaster = {
  id: string;
  internalName: string;
  publicName: string;
  isActive: boolean;
};

export type DbCategory = {
  id: string;
  name: string;
};

export type DbService = {
  id: string;
  categoryId: string;
  internalName: string;
  publicName: string;
  clientDescription: string | null;
  durationMinutes: number;
  breakAfterMinutes: number;
  priceFrom: Prisma.Decimal | number | string | null;
  priceTo: Prisma.Decimal | number | string | null;
  sortOrder: number;
  isActive: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
};

export type DbMasterService = {
  masterId: string;
  serviceId: string;
  isEnabled: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
  sortOrder: number;
};

export type FieldDiff = {
  field: string;
  from: string;
  to: string;
};

export type ServicePlanAction = "create" | "update" | "unchanged" | "conflict";

export type ServicePlan = {
  row: ImportServiceRow;
  action: ServicePlanAction;
  serviceId?: string;
  categoryId?: string;
  categoryAction: "create" | "existing";
  masterId?: string;
  masterCanonical?: string;
  masterServiceAction: "create" | "update" | "unchanged" | "skip";
  breakAfterMinutes: number;
  diffs: FieldDiff[];
  conflictReason?: string;
  /** Текущее описание из БД — для защиты ручных текстов при пустом каноне. */
  existingClientDescription?: string | null;
};

export type StaleMasterServiceLink = {
  serviceId: string;
  serviceName: string;
  masterId: string;
  masterLabel: string;
  expectedMasterCanonical: string;
};

export type CatalogImportPlan = {
  plans: ServicePlan[];
  errors: string[];
  warnings: string[];
  masterMap: Map<string, DbMaster>;
  staleMasterServiceLinks: StaleMasterServiceLink[];
  categoryCreates: string[];
  categoryExisting: string[];
  counters: {
    servicesCreate: number;
    servicesUpdate: number;
    servicesUnchanged: number;
    servicesConflict: number;
    linksCreate: number;
    linksUpdate: number;
    linksUnchanged: number;
    staleBindings: number;
  };
};

export type CatalogImportRepository = {
  findMasters(): Promise<DbMaster[]>;
  findCategories(): Promise<DbCategory[]>;
  findServices(): Promise<DbService[]>;
  findMasterServices(): Promise<DbMasterService[]>;
  findActiveLinksForServices(serviceIds: string[]): Promise<
    Array<{
      masterId: string;
      serviceId: string;
      masterInternalName: string;
      masterPublicName: string;
      servicePublicName: string;
    }>
  >;
  transaction<T>(fn: (tx: CatalogImportTx) => Promise<T>): Promise<T>;
};

export type CatalogImportTx = {
  createCategory(data: {
    name: string;
    sortOrder: number;
    isActive: boolean;
    isPublic: boolean;
  }): Promise<{ id: string }>;
  createService(data: Record<string, unknown>): Promise<{ id: string }>;
  updateService(id: string, data: Record<string, unknown>): Promise<void>;
  upsertMasterService(data: {
    masterId: string;
    serviceId: string;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<"create" | "update">;
  disableMasterService(masterId: string, serviceId: string): Promise<void>;
};

export class CatalogImportCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogImportCliError";
  }
}

export function parseImportServicesArgs(argv: string[]): ImportServicesCliFlags {
  const flags: ImportServicesCliFlags = {
    apply: false,
    confirmStaging: false,
    disableStaleBindings: false,
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      flags.apply = true;
      continue;
    }
    if (arg === "--confirm-staging") {
      flags.confirmStaging = true;
      continue;
    }
    if (arg === "--disable-stale-bindings") {
      flags.disableStaleBindings = true;
      continue;
    }
    throw new CatalogImportCliError(`Неизвестный аргумент: ${arg}`);
  }

  if (flags.disableStaleBindings && !flags.apply) {
    throw new CatalogImportCliError(
      "--disable-stale-bindings допускается только вместе с --apply",
    );
  }

  return flags;
}

/**
 * Fail-closed gate до любых обращений к БД.
 * Dry-run: всегда разрешён (чтение).
 * Apply: только APP_ENV=staging + --confirm-staging.
 */
export function assertCatalogImportWriteAllowed(
  flags: ImportServicesCliFlags,
  appEnv: string | undefined = process.env.APP_ENV,
): void {
  if (!flags.apply) {
    return;
  }

  const env = appEnv?.trim().toLowerCase() ?? "";

  if (env === "production") {
    throw new CatalogImportCliError(
      "Запись каталога (--apply) запрещена при APP_ENV=production",
    );
  }

  if (env !== "staging") {
    throw new CatalogImportCliError(
      "Запись каталога (--apply) разрешена только при APP_ENV=staging (текущее значение отсутствует или неизвестно)",
    );
  }

  if (!flags.confirmStaging) {
    throw new CatalogImportCliError(
      "Для staging apply требуется точный аргумент --confirm-staging",
    );
  }

  if (flags.disableStaleBindings && (!flags.apply || !flags.confirmStaging || env !== "staging")) {
    throw new CatalogImportCliError(
      "--disable-stale-bindings требует --apply, --confirm-staging и APP_ENV=staging",
    );
  }
}

export function breakAfterMinutesFor(category: string): number {
  return category === "Перманентный макияж" ? 30 : 15;
}

export function resolveCanonicalMaster(importName: string): string | null {
  for (const [canonical, aliases] of Object.entries(MASTER_ALIASES)) {
    if (aliases.includes(importName) || canonical === importName) {
      return canonical;
    }
  }
  return null;
}

export function masterMatchesCanonical(master: DbMaster, canonical: string): boolean {
  const aliases = MASTER_ALIASES[canonical] ?? [canonical];
  return (
    aliases.includes(master.publicName) ||
    aliases.includes(master.internalName) ||
    master.publicName === canonical ||
    master.internalName === canonical
  );
}

export function detectImportDuplicates(
  rows: ImportServiceRow[] = IMPORT_SERVICES,
): string[] {
  const seen = new Map<string, number>();
  const errors: string[] = [];
  for (const row of rows) {
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

export function assertCanonicalCatalogConsistency(
  rows: ImportServiceRow[] = IMPORT_SERVICES,
): string[] {
  const errors = detectImportDuplicates(rows);
  const usedCategories = new Set(rows.map((row) => row.category));

  for (const category of usedCategories) {
    if (!(category in CATEGORY_ORDER)) {
      errors.push(`Категория вне CATEGORY_ORDER: «${category}»`);
    }
  }

  for (const row of rows) {
    if (!resolveCanonicalMaster(row.master)) {
      errors.push(`№${row.num}: неизвестный мастер в каноне «${row.master}»`);
    }
    if (!(row.priceFrom > 0)) {
      errors.push(`№${row.num}: некорректная цена priceFrom=${row.priceFrom}`);
    }
    if (!(row.durationMinutes > 0)) {
      errors.push(
        `№${row.num}: некорректная длительность durationMinutes=${row.durationMinutes}`,
      );
    }
  }

  return errors;
}

/**
 * Ровно одна активная карточка на канонического мастера.
 * Неактивные и посторонние (например Юлия) игнорируются.
 */
export function resolveRequiredMasters(masters: DbMaster[]): {
  masterMap: Map<string, DbMaster>;
  errors: string[];
} {
  const errors: string[] = [];
  const masterMap = new Map<string, DbMaster>();
  const active = masters.filter((master) => master.isActive);

  for (const canonical of REQUIRED_MASTERS) {
    const matches = active.filter((master) =>
      masterMatchesCanonical(master, canonical),
    );

    if (matches.length === 0) {
      errors.push(`Мастер не найден среди активных карточек: ${canonical}`);
      continue;
    }

    if (matches.length > 1) {
      const detail = matches
        .map((master) => `${master.id} (${master.internalName} / ${master.publicName})`)
        .join("; ");
      errors.push(
        `Неоднозначный мастер «${canonical}»: ${matches.length} активных совпадений — ${detail}`,
      );
      continue;
    }

    masterMap.set(canonical, matches[0]!);
  }

  const usedIds = [...masterMap.values()].map((master) => master.id);
  if (new Set(usedIds).size !== usedIds.length) {
    errors.push(
      "Одна активная карточка мастера совпала с несколькими каноническими именами — исправьте имена в админке",
    );
  }

  return { masterMap, errors };
}

function decimalToString(value: Prisma.Decimal | number | string | null | undefined): string {
  if (value == null) {
    return "null";
  }
  return String(value);
}

function pricesEqual(
  left: Prisma.Decimal | number | string | null | undefined,
  right: number | null,
): boolean {
  if (right == null) {
    return left == null;
  }
  if (left == null) {
    return false;
  }
  return Number(left) === Number(right);
}

export function normalizeServiceNameForDiagnostics(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function findExactServicesInCategory(
  services: DbService[],
  categoryId: string,
  name: string,
): DbService[] {
  return services.filter(
    (service) =>
      service.categoryId === categoryId &&
      (service.internalName === name || service.publicName === name),
  );
}

function buildServiceDiffs(
  row: ImportServiceRow,
  existing: DbService,
  breakAfterMinutes: number,
  expectedMasterId: string,
  currentMasterId: string | null,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const push = (field: string, from: string, to: string) => {
    if (from !== to) {
      diffs.push({ field, from, to });
    }
  };

  push("internalName", existing.internalName, row.name);
  push("publicName", existing.publicName, row.name);
  push("durationMinutes", String(existing.durationMinutes), String(row.durationMinutes));
  push("breakAfterMinutes", String(existing.breakAfterMinutes), String(breakAfterMinutes));
  push("priceFrom", decimalToString(existing.priceFrom), String(row.priceFrom));
  push("priceTo", decimalToString(existing.priceTo), row.priceTo == null ? "null" : String(row.priceTo));
  push("isOnlineBookingEnabled", String(existing.isOnlineBookingEnabled), String(row.isOnlineBookingEnabled));
  push("isActive", String(existing.isActive), "true");
  push("isPublic", String(existing.isPublic), "true");
  push("sortOrder", String(existing.sortOrder), String(row.num));

  const canonicalDescription = row.clientDescription?.trim() || "";
  if (canonicalDescription) {
    push(
      "clientDescription",
      existing.clientDescription ?? "null",
      canonicalDescription,
    );
  }

  push(
    "masterId",
    currentMasterId ?? "null",
    expectedMasterId,
  );

  return diffs;
}

function buildManagedServiceData(
  row: ImportServiceRow,
  categoryId: string,
  breakAfterMinutes: number,
  existingDescription: string | null | undefined,
): Record<string, unknown> {
  const canonicalDescription = row.clientDescription?.trim() || "";
  const clientDescription = canonicalDescription
    ? canonicalDescription
    : (existingDescription ?? null);

  return {
    categoryId,
    internalName: row.name,
    publicName: row.name,
    clientDescription,
    durationMinutes: row.durationMinutes,
    breakAfterMinutes,
    price: null,
    priceFrom: new Prisma.Decimal(row.priceFrom),
    priceTo: row.priceTo != null ? new Prisma.Decimal(row.priceTo) : null,
    sortOrder: row.num,
    isActive: true,
    isPublic: true,
    isOnlineBookingEnabled: row.isOnlineBookingEnabled,
  };
}

function linkTarget(row: ImportServiceRow): {
  isEnabled: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
  sortOrder: number;
} {
  return {
    isEnabled: true,
    isPublic: true,
    isOnlineBookingEnabled: row.isOnlineBookingEnabled,
    sortOrder: row.num,
  };
}

export async function buildCatalogImportPlan(
  repo: CatalogImportRepository,
  rows: ImportServiceRow[] = IMPORT_SERVICES,
): Promise<CatalogImportPlan> {
  const errors = assertCanonicalCatalogConsistency(rows);
  const warnings: string[] = [];

  for (const row of rows) {
    if (row.todos?.length) {
      warnings.push(`№${row.num} «${row.name}»: ${row.todos.join("; ")}`);
    }
  }

  const dbMasters = await repo.findMasters();
  const { masterMap, errors: masterErrors } = resolveRequiredMasters(dbMasters);
  errors.push(...masterErrors);

  const dbCategories = await repo.findCategories();
  const dbServices = await repo.findServices();
  const dbMasterServices = await repo.findMasterServices();

  const categoryByName = new Map(dbCategories.map((category) => [category.name, category]));
  const categoryCreates = new Set<string>();
  const categoryExisting = new Set<string>();
  const plans: ServicePlan[] = [];

  for (const row of rows) {
    const breakAfter = breakAfterMinutesFor(row.category);
    const canonical = resolveCanonicalMaster(row.master);
    if (!canonical) {
      plans.push({
        row,
        action: "conflict",
        categoryAction: "create",
        masterServiceAction: "skip",
        breakAfterMinutes: breakAfter,
        diffs: [],
        conflictReason: `неизвестный мастер «${row.master}»`,
      });
      errors.push(`№${row.num}: неизвестный мастер «${row.master}»`);
      continue;
    }

    const master = masterMap.get(canonical);
    if (!master) {
      plans.push({
        row,
        action: "conflict",
        categoryAction: categoryByName.has(row.category) ? "existing" : "create",
        masterServiceAction: "skip",
        breakAfterMinutes: breakAfter,
        diffs: [],
        conflictReason: `мастер «${canonical}» не сопоставлен`,
        masterCanonical: canonical,
      });
      continue;
    }

    const existingCategory = categoryByName.get(row.category);
    const categoryAction = existingCategory ? "existing" : "create";
    if (existingCategory) {
      categoryExisting.add(row.category);
    } else {
      categoryCreates.add(row.category);
    }

    const categoryId = existingCategory?.id;
    let action: ServicePlanAction = "create";
    let serviceId: string | undefined;
    let diffs: FieldDiff[] = [];
    let conflictReason: string | undefined;

    if (categoryId) {
      const matches = findExactServicesInCategory(dbServices, categoryId, row.name);
      if (matches.length > 1) {
        action = "conflict";
        conflictReason = `в категории найдено ${matches.length} услуг с именем «${row.name}»`;
        errors.push(`№${row.num} «${row.name}»: ${conflictReason}`);
      } else if (matches.length === 1) {
        const existing = matches[0]!;
        serviceId = existing.id;
        const currentLink =
          dbMasterServices.find(
            (link) =>
              link.serviceId === existing.id &&
              link.masterId === master.id &&
              link.isEnabled,
          ) ??
          dbMasterServices.find(
            (link) => link.serviceId === existing.id && link.isEnabled,
          );
        diffs = buildServiceDiffs(
          row,
          existing,
          breakAfter,
          master.id,
          currentLink?.masterId ?? null,
        );

        // Учитываем также флаги целевой связи ожидаемого мастера
        const expectedLink = dbMasterServices.find(
          (link) => link.serviceId === existing.id && link.masterId === master.id,
        );
        const targetLink = linkTarget(row);
        if (expectedLink) {
          if (expectedLink.isEnabled !== targetLink.isEnabled) {
            diffs.push({
              field: "link.isEnabled",
              from: String(expectedLink.isEnabled),
              to: String(targetLink.isEnabled),
            });
          }
          if (expectedLink.isPublic !== targetLink.isPublic) {
            diffs.push({
              field: "link.isPublic",
              from: String(expectedLink.isPublic),
              to: String(targetLink.isPublic),
            });
          }
          if (
            expectedLink.isOnlineBookingEnabled !== targetLink.isOnlineBookingEnabled
          ) {
            diffs.push({
              field: "link.isOnlineBookingEnabled",
              from: String(expectedLink.isOnlineBookingEnabled),
              to: String(targetLink.isOnlineBookingEnabled),
            });
          }
          if (expectedLink.sortOrder !== targetLink.sortOrder) {
            diffs.push({
              field: "link.sortOrder",
              from: String(expectedLink.sortOrder),
              to: String(targetLink.sortOrder),
            });
          }
        }

        action = diffs.length === 0 ? "unchanged" : "update";
      }
    }

    let masterServiceAction: ServicePlan["masterServiceAction"] = "create";
    if (action === "conflict") {
      masterServiceAction = "skip";
    } else if (action === "unchanged" && serviceId) {
      const existingLink = dbMasterServices.find(
        (link) => link.masterId === master.id && link.serviceId === serviceId,
      );
      masterServiceAction = existingLink ? "unchanged" : "create";
      if (!existingLink) {
        action = "update";
        diffs = [
          ...diffs,
          {
            field: "masterService",
            from: "missing",
            to: `create→${canonical}`,
          },
        ];
        masterServiceAction = "create";
      }
    } else if (serviceId) {
      const existingLink = dbMasterServices.find(
        (link) => link.masterId === master.id && link.serviceId === serviceId,
      );
      masterServiceAction = existingLink ? "update" : "create";
      if (existingLink && action === "update") {
        const linkOnlyDiffs = diffs.filter((diff) => diff.field.startsWith("link."));
        const serviceDiffs = diffs.filter((diff) => !diff.field.startsWith("link."));
        if (serviceDiffs.length === 0 && linkOnlyDiffs.length === 0) {
          masterServiceAction = "unchanged";
        } else if (serviceDiffs.length === 0 && linkOnlyDiffs.length > 0) {
          masterServiceAction = "update";
        }
      }
    }

    const existingForDesc =
      serviceId != null
        ? dbServices.find((service) => service.id === serviceId)
        : undefined;

    plans.push({
      row,
      action,
      serviceId,
      categoryId,
      categoryAction,
      masterId: master.id,
      masterCanonical: canonical,
      masterServiceAction,
      breakAfterMinutes: breakAfter,
      diffs,
      conflictReason,
      existingClientDescription: existingForDesc?.clientDescription ?? null,
    });
  }

  const staleMasterServiceLinks = await detectStaleMasterServiceLinks(
    repo,
    plans,
    masterMap,
  );

  const counters = {
    servicesCreate: plans.filter((plan) => plan.action === "create").length,
    servicesUpdate: plans.filter((plan) => plan.action === "update").length,
    servicesUnchanged: plans.filter((plan) => plan.action === "unchanged").length,
    servicesConflict: plans.filter((plan) => plan.action === "conflict").length,
    linksCreate: plans.filter((plan) => plan.masterServiceAction === "create").length,
    linksUpdate: plans.filter((plan) => plan.masterServiceAction === "update").length,
    linksUnchanged: plans.filter((plan) => plan.masterServiceAction === "unchanged")
      .length,
    staleBindings: staleMasterServiceLinks.length,
  };

  return {
    plans,
    errors,
    warnings,
    masterMap,
    staleMasterServiceLinks,
    categoryCreates: [...categoryCreates].sort(),
    categoryExisting: [...categoryExisting].sort(),
    counters,
  };
}

async function detectStaleMasterServiceLinks(
  repo: CatalogImportRepository,
  plans: ServicePlan[],
  masterMap: Map<string, DbMaster>,
): Promise<StaleMasterServiceLink[]> {
  const expectedByServiceId = new Map<string, ServicePlan>();
  for (const plan of plans) {
    if (plan.serviceId && plan.action !== "conflict" && plan.masterId) {
      expectedByServiceId.set(plan.serviceId, plan);
    }
  }

  if (expectedByServiceId.size === 0) {
    return [];
  }

  const links = await repo.findActiveLinksForServices([...expectedByServiceId.keys()]);
  const stale: StaleMasterServiceLink[] = [];

  for (const link of links) {
    const plan = expectedByServiceId.get(link.serviceId);
    if (!plan || !plan.masterId || link.masterId === plan.masterId) {
      continue;
    }

    const known = [...masterMap.entries()].find(([, master]) => master.id === link.masterId);
    stale.push({
      serviceId: link.serviceId,
      serviceName: link.servicePublicName,
      masterId: link.masterId,
      masterLabel:
        known?.[0] ?? `${link.masterInternalName} / ${link.masterPublicName}`,
      expectedMasterCanonical: plan.masterCanonical ?? "?",
    });
  }

  return stale;
}

export function planAllowsApply(plan: CatalogImportPlan): boolean {
  return plan.errors.length === 0 && plan.counters.servicesConflict === 0;
}

export function formatCatalogImportReport(
  plan: CatalogImportPlan,
  flags: ImportServicesCliFlags,
): string {
  const lines: string[] = [];
  const mode = flags.apply ? "APPLY" : "DRY-RUN";
  lines.push(`=== CATALOG IMPORT ${mode} ===`);
  lines.push("");
  lines.push("--- SUMMARY ---");
  lines.push(`Канон: услуг=${IMPORT_SERVICES.length}, категорий=${Object.keys(CATEGORY_ORDER).length}, мастеров=${REQUIRED_MASTERS.length}`);
  lines.push(`Категорий к созданию: ${plan.categoryCreates.length}`);
  lines.push(`Категорий существующих: ${plan.categoryExisting.length}`);
  lines.push(`Услуг к созданию: ${plan.counters.servicesCreate}`);
  lines.push(`Услуг к обновлению: ${plan.counters.servicesUpdate}`);
  lines.push(`Услуг без изменений: ${plan.counters.servicesUnchanged}`);
  lines.push(`Услуг-конфликтов: ${plan.counters.servicesConflict}`);
  lines.push(`Связей к созданию: ${plan.counters.linksCreate}`);
  lines.push(`Связей к обновлению: ${plan.counters.linksUpdate}`);
  lines.push(`Связей без изменений: ${plan.counters.linksUnchanged}`);
  lines.push(`Stale bindings (отчёт): ${plan.counters.staleBindings}`);
  lines.push(
    `Stale disable: ${
      flags.disableStaleBindings ? "ДА (--disable-stale-bindings)" : "НЕТ (только отчёт)"
    }`,
  );
  lines.push("");

  lines.push("--- МАСТЕРА ---");
  for (const canonical of REQUIRED_MASTERS) {
    const master = plan.masterMap.get(canonical);
    if (master) {
      lines.push(
        `  ✓ ${canonical} → id=${master.id} (${master.publicName} / ${master.internalName})`,
      );
    } else {
      lines.push(`  ✗ ${canonical} — НЕ НАЙДЕН / КОНФЛИКТ`);
    }
  }
  lines.push("");

  lines.push("--- КАТЕГОРИИ К СОЗДАНИЮ ---");
  if (plan.categoryCreates.length === 0) {
    lines.push("  (нет)");
  } else {
    for (const name of plan.categoryCreates) {
      lines.push(`  + ${name} (sortOrder=${CATEGORY_ORDER[name] ?? "?"})`);
    }
  }
  lines.push("");

  lines.push("--- КАТЕГОРИИ УЖЕ СУЩЕСТВУЮТ ---");
  if (plan.categoryExisting.length === 0) {
    lines.push("  (нет)");
  } else {
    for (const name of plan.categoryExisting) {
      lines.push(`  = ${name}`);
    }
  }
  lines.push("");

  lines.push("--- УСЛУГИ К СОЗДАНИЮ ---");
  const creates = plan.plans.filter((item) => item.action === "create");
  if (creates.length === 0) {
    lines.push("  (нет)");
  }
  for (const item of creates) {
    lines.push(
      `  + №${item.row.num} «${item.row.name}» → ${item.masterCanonical} | ${item.row.priceFrom}₽ | ${item.row.durationMinutes}м | online=${item.row.isOnlineBookingEnabled}`,
    );
  }
  lines.push("");

  lines.push("--- УСЛУГИ К ОБНОВЛЕНИЮ (DIFF) ---");
  const updates = plan.plans.filter((item) => item.action === "update");
  if (updates.length === 0) {
    lines.push("  (нет)");
  }
  for (const item of updates) {
    lines.push(`  ~ №${item.row.num} id=${item.serviceId} «${item.row.name}»`);
    for (const diff of item.diffs) {
      lines.push(`      ${diff.field}: ${diff.from} → ${diff.to}`);
    }
  }
  lines.push("");

  lines.push("--- УСЛУГИ БЕЗ ИЗМЕНЕНИЙ ---");
  const unchanged = plan.plans.filter((item) => item.action === "unchanged");
  lines.push(`  count=${unchanged.length}`);
  lines.push("");

  lines.push("--- КОНФЛИКТЫ / НЕОДНОЗНАЧНОСТИ ---");
  const conflicts = plan.plans.filter((item) => item.action === "conflict");
  if (conflicts.length === 0 && plan.errors.length === 0) {
    lines.push("  (нет)");
  }
  for (const item of conflicts) {
    lines.push(
      `  ✗ №${item.row.num} «${item.row.name}»: ${item.conflictReason ?? "conflict"}`,
    );
  }
  for (const error of plan.errors) {
    if (!conflicts.some((item) => error.includes(`№${item.row.num}`))) {
      lines.push(`  ✗ ${error}`);
    }
  }
  lines.push("");

  lines.push("--- STALE BINDINGS ---");
  if (plan.staleMasterServiceLinks.length === 0) {
    lines.push("  (нет)");
  } else {
    for (const link of plan.staleMasterServiceLinks) {
      lines.push(
        `  ! «${link.serviceName}»: ${link.masterLabel} (id=${link.masterId}) — ожидается ${link.expectedMasterCanonical}`,
      );
    }
    if (!flags.disableStaleBindings) {
      lines.push(
        "  (не будут отключены; для отключения нужен --disable-stale-bindings вместе с --apply --confirm-staging)",
      );
    }
  }
  lines.push("");

  if (plan.warnings.length > 0) {
    lines.push("--- WARNINGS ---");
    for (const warning of plan.warnings) {
      lines.push(`  ! ${warning}`);
    }
    lines.push("");
  }

  if (!flags.apply) {
    lines.push(
      planAllowsApply(plan)
        ? "Dry-run OK. Staging apply: --apply --confirm-staging (APP_ENV=staging)."
        : "Dry-run завершён с ошибками — apply заблокирован.",
    );
  }

  return lines.join("\n");
}

export async function applyCatalogImportPlan(
  repo: CatalogImportRepository,
  plan: CatalogImportPlan,
  flags: ImportServicesCliFlags,
): Promise<{
  createdCategories: number;
  createdServices: number;
  updatedServices: number;
  unchangedServices: number;
  createdLinks: number;
  updatedLinks: number;
  disabledStaleLinks: number;
}> {
  if (!planAllowsApply(plan)) {
    throw new CatalogImportCliError(
      "Apply отменён: в плане есть ошибки или конфликты",
    );
  }

  assertCatalogImportWriteAllowed(flags);

  let createdCategories = 0;
  let createdServices = 0;
  let updatedServices = 0;
  let unchangedServices = 0;
  let createdLinks = 0;
  let updatedLinks = 0;
  let disabledStaleLinks = 0;

  await repo.transaction(async (tx) => {
    const categoryCache = new Map<string, string>();
    // Категории, уже известные из плана (existing) — подхватим id из plan.categoryId
    for (const item of plan.plans) {
      if (item.categoryId) {
        categoryCache.set(item.row.category, item.categoryId);
      }
    }

    for (const item of plan.plans) {
      if (item.action === "conflict" || !item.masterId) {
        throw new CatalogImportCliError(
          `Неожиданный conflict в apply для №${item.row.num}`,
        );
      }

      let categoryId = categoryCache.get(item.row.category);
      if (!categoryId) {
        const created = await tx.createCategory({
          name: item.row.category,
          sortOrder: CATEGORY_ORDER[item.row.category] ?? item.row.num,
          isActive: true,
          isPublic: true,
        });
        categoryId = created.id;
        categoryCache.set(item.row.category, categoryId);
        createdCategories += 1;
      }

      const serviceData = buildManagedServiceData(
        item.row,
        categoryId,
        item.breakAfterMinutes,
        item.existingClientDescription,
      );

      let serviceId = item.serviceId;
      if (item.action === "unchanged" && serviceId) {
        unchangedServices += 1;
      } else if (item.action === "update" && serviceId) {
        await tx.updateService(serviceId, serviceData);
        updatedServices += 1;
      } else {
        const created = await tx.createService(serviceData);
        serviceId = created.id;
        createdServices += 1;
      }

      if (item.masterServiceAction === "unchanged" && serviceId) {
        // Связь уже в целевом состоянии — не трогаем.
      } else {
        const link = linkTarget(item.row);
        const linkResult = await tx.upsertMasterService({
          masterId: item.masterId,
          serviceId: serviceId!,
          create: link,
          update: link,
        });
        if (linkResult === "create") {
          createdLinks += 1;
        } else {
          updatedLinks += 1;
        }
      }
    }

    if (flags.disableStaleBindings) {
      for (const stale of plan.staleMasterServiceLinks) {
        await tx.disableMasterService(stale.masterId, stale.serviceId);
        disabledStaleLinks += 1;
      }
    }
  });

  return {
    createdCategories,
    createdServices,
    updatedServices,
    unchangedServices,
    createdLinks,
    updatedLinks,
    disabledStaleLinks,
  };
}

type PrismaLike = {
  master: { findMany: (args: unknown) => Promise<DbMaster[]> };
  serviceCategory: {
    findMany: (args: unknown) => Promise<DbCategory[]>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
  service: {
    findMany: (args: unknown) => Promise<DbService[]>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  masterService: {
    findMany: (args: unknown) => Promise<unknown[]>;
    findUnique: (args: unknown) => Promise<DbMasterService | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    update: (args: {
      where: { masterId_serviceId: { masterId: string; serviceId: string } };
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  $transaction: <T>(fn: (tx: PrismaLike) => Promise<T>) => Promise<T>;
};

export function createPrismaCatalogImportRepository(
  prisma: PrismaLike,
): CatalogImportRepository {
  return {
    findMasters: () =>
      prisma.master.findMany({
        select: {
          id: true,
          internalName: true,
          publicName: true,
          isActive: true,
        },
      }),
    findCategories: () =>
      prisma.serviceCategory.findMany({
        select: { id: true, name: true },
      }),
    findServices: () =>
      prisma.service.findMany({
        select: {
          id: true,
          categoryId: true,
          internalName: true,
          publicName: true,
          clientDescription: true,
          durationMinutes: true,
          breakAfterMinutes: true,
          priceFrom: true,
          priceTo: true,
          sortOrder: true,
          isActive: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
        },
      }),
    async findMasterServices() {
      return (await prisma.masterService.findMany({
        select: {
          masterId: true,
          serviceId: true,
          isEnabled: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
          sortOrder: true,
        },
      })) as DbMasterService[];
    },
    async findActiveLinksForServices(serviceIds: string[]) {
      const rows = (await prisma.masterService.findMany({
        where: {
          serviceId: { in: serviceIds },
          OR: [
            { isEnabled: true },
            { isPublic: true },
            { isOnlineBookingEnabled: true },
          ],
        },
        include: {
          master: { select: { internalName: true, publicName: true } },
          service: { select: { publicName: true } },
        },
      })) as Array<{
        masterId: string;
        serviceId: string;
        master: { internalName: string; publicName: string };
        service: { publicName: string };
      }>;

      return rows.map((row) => ({
        masterId: row.masterId,
        serviceId: row.serviceId,
        masterInternalName: row.master.internalName,
        masterPublicName: row.master.publicName,
        servicePublicName: row.service.publicName,
      }));
    },
    transaction(fn) {
      return prisma.$transaction(async (tx) => {
        const api: CatalogImportTx = {
          createCategory: (data) => tx.serviceCategory.create({ data }),
          createService: (data) => tx.service.create({ data }),
          updateService: async (id, data) => {
            await tx.service.update({ where: { id }, data });
          },
          async upsertMasterService({ masterId, serviceId, create, update }) {
            const existing = await tx.masterService.findUnique({
              where: { masterId_serviceId: { masterId, serviceId } },
            });
            if (existing) {
              await tx.masterService.update({
                where: { masterId_serviceId: { masterId, serviceId } },
                data: update,
              });
              return "update";
            }
            await tx.masterService.create({
              data: { masterId, serviceId, ...create },
            });
            return "create";
          },
          async disableMasterService(masterId, serviceId) {
            await tx.masterService.update({
              where: { masterId_serviceId: { masterId, serviceId } },
              data: {
                isEnabled: false,
                isPublic: false,
                isOnlineBookingEnabled: false,
              },
            });
          },
        };
        return fn(api);
      });
    },
  };
}

export {
  CATEGORY_ORDER,
  IMPORT_SERVICES,
  MASTER_ALIASES,
  REQUIRED_MASTERS,
};
export type { ImportServiceRow };

/** Тестовый helper: pricesEqual экспортируется косвенно через diff. */
export function servicePricesEqualForTests(
  left: Prisma.Decimal | number | string | null | undefined,
  right: number | null,
): boolean {
  return pricesEqual(left, right);
}
