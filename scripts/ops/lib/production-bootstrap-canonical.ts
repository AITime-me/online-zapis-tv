/**
 * Канон production bootstrap рабочих данных.
 * Каталог: scripts/data/import-services-data.ts
 * Gifts/витрина: scripts/ops/lib/game-promotions-canonical.ts (нейтральный shared)
 *
 * UUID мастеров/категорий — явные business key → UUID (не array index).
 * UUID услуг — стабильный unique import num.
 */

import {
  CATEGORY_ORDER,
  IMPORT_SERVICES,
  REQUIRED_MASTERS,
  type ImportServiceRow,
} from "../../data/import-services-data";
import {
  CANONICAL_GAME_GIFTS,
  CANONICAL_GIFT_IDS,
  PREMIUM_GIFT_ID,
  PROCEDURE_GIFT_CATALOG_SLUG,
  SHOWCASE_DISCOUNT_PROMOTION,
  SHOWCASE_DISCOUNT_PROMOTION_ID,
} from "./game-promotions-canonical";

export {
  CANONICAL_GAME_GIFTS,
  CANONICAL_GIFT_IDS,
  PREMIUM_GIFT_ID,
  PROCEDURE_GIFT_CATALOG_SLUG,
  SHOWCASE_DISCOUNT_PROMOTION,
  SHOWCASE_DISCOUNT_PROMOTION_ID,
};

const SERVICE_ID_PREFIX = "a3000001-0000-4000-8000-";

function pad12(n: number): string {
  return String(n).padStart(12, "0");
}

/**
 * Явное соответствие каноническое имя мастера → UUID.
 * sortOrder — только отображение; ID не зависит от порядка массива.
 */
export const MASTER_STABLE_BY_NAME = {
  "Ксения Вайзер": {
    id: "a1000001-0000-4000-8000-000000000001",
    sortOrder: 1,
  },
  "Татьяна Федулова": {
    id: "a1000001-0000-4000-8000-000000000002",
    sortOrder: 2,
  },
  "Ирина Пашкова": {
    id: "a1000001-0000-4000-8000-000000000003",
    sortOrder: 3,
  },
  "Ирина Белизина": {
    id: "a1000001-0000-4000-8000-000000000004",
    sortOrder: 4,
  },
  "Елена Правич": {
    id: "a1000001-0000-4000-8000-000000000005",
    sortOrder: 5,
  },
} as const;

export type CanonicalMasterName = keyof typeof MASTER_STABLE_BY_NAME;

/**
 * Явное соответствие имя категории → UUID.
 * sortOrder берётся из CATEGORY_ORDER; ID не зависит от порядка Object.entries.
 */
export const CATEGORY_STABLE_BY_NAME = {
  "Аппаратная и эстетическая безинъекционная косметология":
    "a2000001-0000-4000-8000-000000000001",
  "Холодная плазма": "a2000001-0000-4000-8000-000000000002",
  "Уход за кожей рук": "a2000001-0000-4000-8000-000000000003",
  Ресницы: "a2000001-0000-4000-8000-000000000004",
  Брови: "a2000001-0000-4000-8000-000000000005",
  "Перманентный макияж": "a2000001-0000-4000-8000-000000000006",
  "Удаление старого татуажа и тату": "a2000001-0000-4000-8000-000000000007",
  "Массаж лица": "a2000001-0000-4000-8000-000000000008",
  "Массаж тела": "a2000001-0000-4000-8000-000000000009",
  "Инъекционная косметология": "a2000001-0000-4000-8000-000000000010",
  "Дополнительные смежные процедуры": "a2000001-0000-4000-8000-000000000011",
} as const;

export type CanonicalCategoryName = keyof typeof CATEGORY_STABLE_BY_NAME;

export function bootstrapMasterId(canonicalName: string): string {
  const entry =
    MASTER_STABLE_BY_NAME[canonicalName as CanonicalMasterName];
  if (!entry) {
    throw new Error(`unknown canonical master name: ${canonicalName}`);
  }
  return entry.id;
}

export function bootstrapCategoryId(canonicalName: string): string {
  const id =
    CATEGORY_STABLE_BY_NAME[canonicalName as CanonicalCategoryName];
  if (!id) {
    throw new Error(`unknown canonical category name: ${canonicalName}`);
  }
  return id;
}

export function bootstrapServiceId(importNum: number): string {
  if (!Number.isInteger(importNum) || importNum < 1 || importNum > 999) {
    throw new Error(`invalid service import num: ${importNum}`);
  }
  return `${SERVICE_ID_PREFIX}${pad12(importNum)}`;
}

export function breakAfterMinutesForCategory(category: string): number {
  return category === "Перманентный макияж" ? 30 : 15;
}

/** Официальные placeholder-часы при usesDefaultWorkHours=true. */
export const BOOTSTRAP_MASTER_WORK_START = "09:00";
export const BOOTSTRAP_MASTER_WORK_END = "18:00";
export const BOOTSTRAP_MASTER_SLOT_MINUTES = 30;
export const BOOTSTRAP_MASTER_BREAK_AFTER = 0;

export type CanonicalMasterSeed = {
  id: string;
  internalName: string;
  publicName: string;
  sortOrder: number;
  slotMinutes: number;
  workStart: string;
  workEnd: string;
  breakAfterMinutes: number;
  usesDefaultWorkHours: true;
  isActive: true;
  isPublic: true;
  isOnlineBookingEnabled: true;
};

export type CanonicalCategorySeed = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: true;
  isPublic: true;
};

export type CanonicalServiceSeed = {
  id: string;
  importNum: number;
  categoryId: string;
  categoryName: string;
  internalName: string;
  publicName: string;
  clientDescription: string | null;
  durationMinutes: number;
  breakAfterMinutes: number;
  priceFrom: number;
  priceTo: number | null;
  sortOrder: number;
  isActive: true;
  isPublic: true;
  isOnlineBookingEnabled: boolean;
  masterId: string;
  masterName: string;
};

export function buildCanonicalMasters(
  names: readonly string[] = REQUIRED_MASTERS,
): CanonicalMasterSeed[] {
  const seen = new Set<string>();
  const masters: CanonicalMasterSeed[] = [];

  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(`duplicate master name in source: ${name}`);
    }
    seen.add(name);
    const meta = MASTER_STABLE_BY_NAME[name as CanonicalMasterName];
    if (!meta) {
      throw new Error(`master missing stable UUID mapping: ${name}`);
    }
    masters.push({
      id: meta.id,
      internalName: name,
      publicName: name,
      sortOrder: meta.sortOrder,
      slotMinutes: BOOTSTRAP_MASTER_SLOT_MINUTES,
      workStart: BOOTSTRAP_MASTER_WORK_START,
      workEnd: BOOTSTRAP_MASTER_WORK_END,
      breakAfterMinutes: BOOTSTRAP_MASTER_BREAK_AFTER,
      usesDefaultWorkHours: true,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    });
  }

  for (const required of Object.keys(MASTER_STABLE_BY_NAME)) {
    if (!seen.has(required)) {
      throw new Error(`canonical master missing from source list: ${required}`);
    }
  }

  return masters;
}

export function buildCanonicalCategories(
  categoryOrder: Record<string, number> = CATEGORY_ORDER,
): CanonicalCategorySeed[] {
  const entries = Object.entries(categoryOrder);
  const seenNames = new Set<string>();
  const seenSort = new Set<number>();
  const categories: CanonicalCategorySeed[] = [];

  for (const [name, sortOrder] of entries) {
    if (seenNames.has(name)) {
      throw new Error(`duplicate category name: ${name}`);
    }
    if (seenSort.has(sortOrder)) {
      throw new Error(`duplicate category sortOrder: ${sortOrder}`);
    }
    seenNames.add(name);
    seenSort.add(sortOrder);

    const id = bootstrapCategoryId(name);
    const expectedSort = CATEGORY_ORDER[name];
    if (expectedSort === undefined) {
      throw new Error(`category not in CATEGORY_ORDER: ${name}`);
    }
    if (sortOrder !== expectedSort) {
      throw new Error(
        `category sortOrder drift for ${name}: ${sortOrder} != ${expectedSort}`,
      );
    }

    categories.push({
      id,
      name,
      sortOrder,
      isActive: true,
      isPublic: true,
    });
  }

  for (const required of Object.keys(CATEGORY_STABLE_BY_NAME)) {
    if (!seenNames.has(required)) {
      throw new Error(`canonical category missing from source: ${required}`);
    }
  }

  return categories.sort((a, b) => a.sortOrder - b.sortOrder);
}

export function assertUniqueImportNums(
  rows: readonly ImportServiceRow[] = IMPORT_SERVICES,
): void {
  const seen = new Map<number, string>();
  for (const row of rows) {
    const prev = seen.get(row.num);
    if (prev !== undefined) {
      throw new Error(
        `duplicate import num ${row.num}: "${prev}" and "${row.name}"`,
      );
    }
    seen.set(row.num, row.name);
  }
}

export function buildCanonicalServices(
  rows: readonly ImportServiceRow[] = IMPORT_SERVICES,
  masters: readonly CanonicalMasterSeed[] = CANONICAL_MASTERS,
  categories: readonly CanonicalCategorySeed[] = CANONICAL_CATEGORIES,
): CanonicalServiceSeed[] {
  assertUniqueImportNums(rows);

  const masterByName = new Map(
    masters.map((master) => [master.internalName, master]),
  );
  const categoryByName = new Map(
    categories.map((category) => [category.name, category]),
  );
  const seenNamesInCategory = new Set<string>();
  const services: CanonicalServiceSeed[] = [];

  for (const row of rows) {
    const category = categoryByName.get(row.category);
    const master = masterByName.get(row.master);
    if (!category) {
      throw new Error(
        `canonical category missing for row ${row.num}: ${row.category}`,
      );
    }
    if (!master) {
      throw new Error(
        `canonical master missing for row ${row.num}: ${row.master}`,
      );
    }

    const nameKey = `${row.category}::${row.name}`;
    if (seenNamesInCategory.has(nameKey)) {
      throw new Error(`duplicate service name in category: ${nameKey}`);
    }
    seenNamesInCategory.add(nameKey);

    services.push({
      id: bootstrapServiceId(row.num),
      importNum: row.num,
      categoryId: category.id,
      categoryName: row.category,
      internalName: row.name,
      publicName: row.name,
      clientDescription: row.clientDescription?.trim() || null,
      durationMinutes: row.durationMinutes,
      breakAfterMinutes: breakAfterMinutesForCategory(row.category),
      priceFrom: row.priceFrom,
      priceTo: row.priceTo,
      sortOrder: row.num,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: row.isOnlineBookingEnabled,
      masterId: master.id,
      masterName: master.internalName,
    });
  }

  return services;
}

export const CANONICAL_MASTERS: readonly CanonicalMasterSeed[] =
  buildCanonicalMasters();

export const CANONICAL_CATEGORIES: readonly CanonicalCategorySeed[] =
  buildCanonicalCategories();

export const CANONICAL_SERVICES: readonly CanonicalServiceSeed[] =
  buildCanonicalServices();

export const COLD_PLASMA_CATEGORY_NAME = "Холодная плазма";

export const CANONICAL_COLD_PLASMA_SERVICE_IDS: readonly string[] =
  CANONICAL_SERVICES.filter(
    (service) => service.categoryName === COLD_PLASMA_CATEGORY_NAME,
  ).map((service) => service.id);

export const BOOTSTRAP_EXPECTED_COUNTS = {
  masters: CANONICAL_MASTERS.length,
  categories: CANONICAL_CATEGORIES.length,
  services: CANONICAL_SERVICES.length,
  masterServices: CANONICAL_SERVICES.length,
  gifts: CANONICAL_GAME_GIFTS.length,
  promotions: 1,
  promotionServices: CANONICAL_COLD_PLASMA_SERVICE_IDS.length,
} as const;

export function assertCanonicalBootstrapIntegrity(): void {
  if (CANONICAL_MASTERS.length !== 5) {
    throw new Error(`expected 5 masters, got ${CANONICAL_MASTERS.length}`);
  }
  if (CANONICAL_CATEGORIES.length !== 11) {
    throw new Error(`expected 11 categories, got ${CANONICAL_CATEGORIES.length}`);
  }
  if (CANONICAL_SERVICES.length !== 101) {
    throw new Error(`expected 101 services, got ${CANONICAL_SERVICES.length}`);
  }
  if (CANONICAL_GAME_GIFTS.length !== 4) {
    throw new Error(`expected 4 gifts, got ${CANONICAL_GAME_GIFTS.length}`);
  }
  if (CANONICAL_COLD_PLASMA_SERVICE_IDS.length !== 13) {
    throw new Error(
      `expected 13 cold plasma services, got ${CANONICAL_COLD_PLASMA_SERVICE_IDS.length}`,
    );
  }

  assertUniqueImportNums();

  const masterIds = new Set(CANONICAL_MASTERS.map((m) => m.id));
  const serviceIds = new Set(CANONICAL_SERVICES.map((s) => s.id));
  if (masterIds.size !== CANONICAL_MASTERS.length) {
    throw new Error("duplicate canonical master ids");
  }
  if (serviceIds.size !== CANONICAL_SERVICES.length) {
    throw new Error("duplicate canonical service ids");
  }

  for (const service of CANONICAL_SERVICES) {
    if (!masterIds.has(service.masterId)) {
      throw new Error(
        `orphan master_services risk: service ${service.id} masterId ${service.masterId}`,
      );
    }
    if (!serviceIds.has(service.id)) {
      throw new Error(`internal service id missing: ${service.id}`);
    }
  }

  for (const linkServiceId of CANONICAL_COLD_PLASMA_SERVICE_IDS) {
    if (!serviceIds.has(linkServiceId)) {
      throw new Error(
        `orphan promotion_services risk: ${linkServiceId} not in services`,
      );
    }
  }
}

/** Для security-теста: UUID по имени не зависят от порядка входного массива. */
export function masterIdsByNameFromOrder(
  names: readonly string[],
): Record<string, string> {
  const built = buildCanonicalMasters(names);
  return Object.fromEntries(built.map((m) => [m.internalName, m.id]));
}

export function categoryIdsByNameFromOrder(
  categoryOrder: Record<string, number>,
): Record<string, string> {
  const built = buildCanonicalCategories(categoryOrder);
  return Object.fromEntries(built.map((c) => [c.name, c.id]));
}
