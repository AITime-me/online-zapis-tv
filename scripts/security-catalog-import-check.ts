/**
 * Security-проверка безопасного импорта каталога услуг.
 * Без реальной БД: mocked repository + статический аудит CLI.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertCatalogImportWriteAllowed,
  applyCatalogImportPlan,
  buildCatalogImportPlan,
  CatalogImportCliError,
  createPrismaCatalogImportRepository,
  detectImportDuplicates,
  formatCatalogImportReport,
  masterMatchesCanonical,
  parseImportServicesArgs,
  planAllowsApply,
  resolveRequiredMasters,
  type CatalogImportRepository,
  type CatalogImportTx,
  type DbCategory,
  type DbMaster,
  type DbMasterService,
  type DbService,
  type ImportServiceRow,
  IMPORT_SERVICES,
  REQUIRED_MASTERS,
} from "./lib/catalog-service-import";

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function sampleRow(overrides: Partial<ImportServiceRow> = {}): ImportServiceRow {
  return {
    num: 1,
    category: "Брови",
    name: "Оформление бровей воском",
    master: "Ирина Белизина",
    priceFrom: 500,
    priceTo: null,
    durationMinutes: 20,
    isOnlineBookingEnabled: true,
    clientDescription: null,
    ...overrides,
  };
}

function canonicalMasters(): DbMaster[] {
  return REQUIRED_MASTERS.map((name, index) => ({
    id: `m-${index + 1}`,
    internalName: name,
    publicName: name,
    isActive: true,
  }));
}

type MemState = {
  masters: DbMaster[];
  categories: DbCategory[];
  services: DbService[];
  links: DbMasterService[];
  writes: string[];
  txStarted: boolean;
  txCommitted: boolean;
};

function createMemoryRepo(state: MemState): CatalogImportRepository {
  return {
    async findMasters() {
      return state.masters.map((master) => ({ ...master }));
    },
    async findCategories() {
      return state.categories.map((category) => ({ ...category }));
    },
    async findServices() {
      return state.services.map((service) => ({ ...service }));
    },
    async findMasterServices() {
      return state.links.map((link) => ({ ...link }));
    },
    async findActiveLinksForServices(serviceIds: string[]) {
      return state.links
        .filter(
          (link) =>
            serviceIds.includes(link.serviceId) &&
            (link.isEnabled || link.isPublic || link.isOnlineBookingEnabled),
        )
        .map((link) => {
          const master = state.masters.find((item) => item.id === link.masterId)!;
          const service = state.services.find((item) => item.id === link.serviceId)!;
          return {
            masterId: link.masterId,
            serviceId: link.serviceId,
            masterInternalName: master.internalName,
            masterPublicName: master.publicName,
            servicePublicName: service.publicName,
          };
        });
    },
    async transaction(fn) {
      state.txStarted = true;
      const snapshot = {
        categories: JSON.parse(JSON.stringify(state.categories)) as DbCategory[],
        services: JSON.parse(JSON.stringify(state.services)) as DbService[],
        links: JSON.parse(JSON.stringify(state.links)) as DbMasterService[],
      };

      const tx: CatalogImportTx = {
        async createCategory(data) {
          state.writes.push("createCategory");
          const created = { id: `c-${state.categories.length + 1}`, name: data.name };
          state.categories.push(created);
          return created;
        },
        async createService(data) {
          state.writes.push("createService");
          const created: DbService = {
            id: `s-${state.services.length + 1}`,
            categoryId: String(data.categoryId),
            internalName: String(data.internalName),
            publicName: String(data.publicName),
            clientDescription: (data.clientDescription as string | null) ?? null,
            durationMinutes: Number(data.durationMinutes),
            breakAfterMinutes: Number(data.breakAfterMinutes),
            priceFrom: data.priceFrom as number,
            priceTo: (data.priceTo as number | null) ?? null,
            sortOrder: Number(data.sortOrder),
            isActive: Boolean(data.isActive),
            isPublic: Boolean(data.isPublic),
            isOnlineBookingEnabled: Boolean(data.isOnlineBookingEnabled),
          };
          state.services.push(created);
          return { id: created.id };
        },
        async updateService(id, data) {
          state.writes.push("updateService");
          const service = state.services.find((item) => item.id === id);
          if (!service) {
            throw new Error("missing service");
          }
          Object.assign(service, data);
        },
        async upsertMasterService({ masterId, serviceId, create, update }) {
          const existing = state.links.find(
            (link) => link.masterId === masterId && link.serviceId === serviceId,
          );
          if (existing) {
            state.writes.push("updateLink");
            Object.assign(existing, update);
            return "update";
          }
          state.writes.push("createLink");
          state.links.push({
            masterId,
            serviceId,
            isEnabled: Boolean(create.isEnabled),
            isPublic: Boolean(create.isPublic),
            isOnlineBookingEnabled: Boolean(create.isOnlineBookingEnabled),
            sortOrder: Number(create.sortOrder),
          });
          return "create";
        },
        async disableMasterService(masterId, serviceId) {
          state.writes.push("disableLink");
          const link = state.links.find(
            (item) => item.masterId === masterId && item.serviceId === serviceId,
          );
          if (!link) {
            throw new Error("missing link");
          }
          link.isEnabled = false;
          link.isPublic = false;
          link.isOnlineBookingEnabled = false;
        },
      };

      try {
        const result = await fn(tx);
        state.txCommitted = true;
        return result;
      } catch (error) {
        state.categories = snapshot.categories;
        state.services = snapshot.services;
        state.links = snapshot.links;
        state.txCommitted = false;
        throw error;
      }
    },
  };
}

function testCliArgsAndEnvGate(): void {
  assert.deepEqual(parseImportServicesArgs([]), {
    apply: false,
    confirmStaging: false,
    disableStaleBindings: false,
  });

  assert.throws(
    () => parseImportServicesArgs(["--unknown"]),
    (error: unknown) =>
      error instanceof CatalogImportCliError && /Неизвестный аргумент/.test(error.message),
  );

  assert.throws(
    () => parseImportServicesArgs(["--disable-stale-bindings"]),
    (error: unknown) =>
      error instanceof CatalogImportCliError &&
      /только вместе с --apply/.test(error.message),
  );

  const dry = parseImportServicesArgs(["--confirm-staging"]);
  assert.equal(dry.apply, false);
  assertCatalogImportWriteAllowed(dry, "production");

  assert.throws(
    () =>
      assertCatalogImportWriteAllowed(
        { apply: true, confirmStaging: true, disableStaleBindings: false },
        "production",
      ),
    /production/,
  );

  assert.throws(
    () =>
      assertCatalogImportWriteAllowed(
        { apply: true, confirmStaging: true, disableStaleBindings: false },
        "",
      ),
    /только при APP_ENV=staging/,
  );

  assert.throws(
    () =>
      assertCatalogImportWriteAllowed(
        { apply: true, confirmStaging: true, disableStaleBindings: false },
        "development",
      ),
    /только при APP_ENV=staging/,
  );

  assert.throws(
    () =>
      assertCatalogImportWriteAllowed(
        { apply: true, confirmStaging: false, disableStaleBindings: false },
        "staging",
      ),
    /--confirm-staging/,
  );

  assert.doesNotThrow(() =>
    assertCatalogImportWriteAllowed(
      { apply: true, confirmStaging: true, disableStaleBindings: false },
      "staging",
    ),
  );

  assert.doesNotThrow(() =>
    assertCatalogImportWriteAllowed(
      { apply: true, confirmStaging: true, disableStaleBindings: true },
      "staging",
    ),
  );
}

function testMasterMatching(): void {
  const julia: DbMaster = {
    id: "julia",
    internalName: "Юлия",
    publicName: "Юлия",
    isActive: true,
  };
  assert.equal(masterMatchesCanonical(julia, "Ксения Вайзер"), false);
  assert.equal(masterMatchesCanonical(julia, "Ирина Пашкова"), false);
  assert.equal(masterMatchesCanonical(julia, "Ирина Белизина"), false);

  const irinaOnly: DbMaster = {
    id: "irina",
    internalName: "Ирина",
    publicName: "Ирина",
    isActive: true,
  };
  assert.equal(masterMatchesCanonical(irinaOnly, "Ирина Пашкова"), true);
  assert.equal(masterMatchesCanonical(irinaOnly, "Ирина Белизина"), false);

  const missing = resolveRequiredMasters([julia]);
  assert.ok(missing.errors.some((error) => /не найден/.test(error)));
  assert.equal(missing.masterMap.size, 0);

  const ambiguous = resolveRequiredMasters([
    {
      id: "a",
      internalName: "Ксения Вайзер",
      publicName: "Ксения Вайзер",
      isActive: true,
    },
    {
      id: "b",
      internalName: "Ксения",
      publicName: "Ксения",
      isActive: true,
    },
    ...canonicalMasters().filter((master) => master.publicName !== "Ксения Вайзер"),
  ]);
  assert.ok(ambiguous.errors.some((error) => /Неоднозначный мастер «Ксения Вайзер»/.test(error)));
}

async function testDryRunDoesNotWrite(): Promise<void> {
  const state: MemState = {
    masters: canonicalMasters(),
    categories: [],
    services: [],
    links: [],
    writes: [],
    txStarted: false,
    txCommitted: false,
  };
  const repo = createMemoryRepo(state);
  const plan = await buildCatalogImportPlan(repo, [sampleRow()]);
  assert.equal(planAllowsApply(plan), true);
  assert.equal(state.writes.length, 0);
  assert.equal(state.txStarted, false);
  const report = formatCatalogImportReport(plan, {
    apply: false,
    confirmStaging: false,
    disableStaleBindings: false,
  });
  assert.match(report, /DRY-RUN/);
  assert.doesNotMatch(report, /DATABASE_URL|postgresql:\/\//i);
}

async function testMissingAndAmbiguousService(): Promise<void> {
  const masters = canonicalMasters();
  const state: MemState = {
    masters,
    categories: [{ id: "cat-1", name: "Брови" }],
    services: [
      {
        id: "s1",
        categoryId: "cat-1",
        internalName: "Оформление бровей воском",
        publicName: "Оформление бровей воском",
        clientDescription: "ручное",
        durationMinutes: 20,
        breakAfterMinutes: 15,
        priceFrom: 500,
        priceTo: null,
        sortOrder: 1,
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
      },
      {
        id: "s2",
        categoryId: "cat-1",
        internalName: "Оформление бровей воском",
        publicName: "Оформление бровей воском",
        clientDescription: null,
        durationMinutes: 20,
        breakAfterMinutes: 15,
        priceFrom: 500,
        priceTo: null,
        sortOrder: 2,
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
      },
    ],
    links: [],
    writes: [],
    txStarted: false,
    txCommitted: false,
  };
  const plan = await buildCatalogImportPlan(createMemoryRepo(state), [sampleRow()]);
  assert.equal(planAllowsApply(plan), false);
  assert.equal(plan.counters.servicesConflict, 1);

  await assert.rejects(
    () =>
      applyCatalogImportPlan(createMemoryRepo(state), plan, {
        apply: true,
        confirmStaging: true,
        disableStaleBindings: false,
      }),
    /отменён/,
  );
  assert.equal(state.writes.length, 0);
}

async function testCanonicalDuplicateBlocks(): Promise<void> {
  const rows = [sampleRow({ num: 1 }), sampleRow({ num: 2 })];
  const errors = detectImportDuplicates(rows);
  assert.ok(errors.some((error) => /Дубль в массиве/.test(error)));
  const state: MemState = {
    masters: canonicalMasters(),
    categories: [],
    services: [],
    links: [],
    writes: [],
    txStarted: false,
    txCommitted: false,
  };
  const plan = await buildCatalogImportPlan(createMemoryRepo(state), rows);
  assert.equal(planAllowsApply(plan), false);
}

async function testDescriptionProtectionAndStale(): Promise<void> {
  const masters = canonicalMasters();
  const belizina = masters.find((master) => master.publicName === "Ирина Белизина")!;
  const alien = {
    id: "alien",
    internalName: "Юлия",
    publicName: "Юлия",
    isActive: true,
  };
  masters.push(alien);

  const state: MemState = {
    masters,
    categories: [{ id: "cat-1", name: "Брови" }],
    services: [
      {
        id: "s1",
        categoryId: "cat-1",
        internalName: "Оформление бровей воском",
        publicName: "Оформление бровей воском",
        clientDescription: "ручное описание менеджера",
        durationMinutes: 20,
        breakAfterMinutes: 15,
        priceFrom: 600,
        priceTo: null,
        sortOrder: 31,
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
      },
    ],
    links: [
      {
        masterId: belizina.id,
        serviceId: "s1",
        isEnabled: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
        sortOrder: 31,
      },
      {
        masterId: alien.id,
        serviceId: "s1",
        isEnabled: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
        sortOrder: 1,
      },
    ],
    writes: [],
    txStarted: false,
    txCommitted: false,
  };

  const repo = createMemoryRepo(state);
  const plan = await buildCatalogImportPlan(repo, [
    sampleRow({ num: 31, priceFrom: 500, clientDescription: null }),
  ]);
  assert.equal(plan.counters.staleBindings, 1);
  assert.equal(planAllowsApply(plan), true);
  assert.equal(plan.counters.servicesUpdate, 1);
  assert.ok(
    !plan.plans[0]!.diffs.some((diff) => diff.field === "clientDescription"),
    "пустое каноническое описание не должно попадать в diff как стирание",
  );

  await applyCatalogImportPlan(repo, plan, {
    apply: true,
    confirmStaging: true,
    disableStaleBindings: false,
  });
  const linkAlien = state.links.find((link) => link.masterId === alien.id)!;
  assert.equal(linkAlien.isEnabled, true, "stale не отключается по умолчанию");
  const service = state.services[0]!;
  assert.equal(service.clientDescription, "ручное описание менеджера");
  assert.equal(Number(service.priceFrom), 500);

  const planDisable = await buildCatalogImportPlan(repo, [
    sampleRow({ num: 31, priceFrom: 500, clientDescription: null }),
  ]);
  await applyCatalogImportPlan(repo, planDisable, {
    apply: true,
    confirmStaging: true,
    disableStaleBindings: true,
  });
  assert.equal(
    state.links.find((link) => link.masterId === alien.id)?.isEnabled,
    false,
  );
}

async function testIdempotentSecondPlan(): Promise<void> {
  const state: MemState = {
    masters: canonicalMasters(),
    categories: [],
    services: [],
    links: [],
    writes: [],
    txStarted: false,
    txCommitted: false,
  };
  const repo = createMemoryRepo(state);
  const rows = [sampleRow({ num: 31 })];
  const plan1 = await buildCatalogImportPlan(repo, rows);
  assert.equal(plan1.counters.servicesCreate, 1);
  await applyCatalogImportPlan(repo, plan1, {
    apply: true,
    confirmStaging: true,
    disableStaleBindings: false,
  });
  const afterFirst = {
    services: state.services.length,
    categories: state.categories.length,
    links: state.links.length,
  };

  state.writes = [];
  const plan2 = await buildCatalogImportPlan(repo, rows);
  assert.equal(plan2.counters.servicesCreate, 0);
  assert.ok(plan2.counters.servicesUnchanged + plan2.counters.servicesUpdate >= 1);
  assert.equal(state.writes.length, 0, "второй dry-run/plan не пишет");

  if (plan2.counters.servicesUnchanged === 1) {
    await applyCatalogImportPlan(repo, plan2, {
      apply: true,
      confirmStaging: true,
      disableStaleBindings: false,
    });
    assert.equal(state.services.length, afterFirst.services);
    assert.equal(state.categories.length, afterFirst.categories);
    assert.equal(state.links.length, afterFirst.links);
  }
}

async function testConflictRollsBackTransaction(): Promise<void> {
  const state: MemState = {
    masters: canonicalMasters(),
    categories: [],
    services: [],
    links: [],
    writes: [],
    txStarted: false,
    txCommitted: false,
  };
  const repo = createMemoryRepo(state);
  const plan = await buildCatalogImportPlan(repo, [sampleRow()]);
  assert.equal(planAllowsApply(plan), true);

  const originalTx = repo.transaction.bind(repo);
  repo.transaction = async (fn) =>
    originalTx(async (tx) => {
      const wrapped: CatalogImportTx = {
        ...tx,
        async createService(data) {
          await tx.createService(data);
          throw new Error("boom mid-apply");
        },
      };
      return fn(wrapped);
    });

  await assert.rejects(
    () =>
      applyCatalogImportPlan(repo, plan, {
        apply: true,
        confirmStaging: true,
        disableStaleBindings: false,
      }),
    /boom mid-apply/,
  );
  assert.equal(state.txCommitted, false);
  assert.equal(state.services.length, 0);
  assert.equal(state.categories.length, 0);
}

function testStaticGuarantees(): void {
  const core = stripComments(read("scripts/lib/catalog-service-import.ts"));
  const cli = stripComments(read("scripts/import-services.ts"));

  assert.doesNotMatch(core, /migrate\s+reset|db\s+push|truncate|deleteMany|deleteAll/i);
  assert.doesNotMatch(cli, /migrate\s+reset|db\s+push|truncate|deleteMany|deleteAll/i);
  assert.doesNotMatch(core, /master\.create|createMany\(\s*\{\s*data:.*Master/i);
  assert.match(core, /assertCatalogImportWriteAllowed/);
  assert.match(core, /--confirm-staging/);
  assert.match(core, /disableStaleBindings/);
  assert.match(core, /existingClientDescription|clientDescription/);
  assert.match(cli, /assertCatalogImportWriteAllowed\(flags,?\)/);
  assert.ok(
    cli.indexOf("assertCatalogImportWriteAllowed") < cli.indexOf("new PrismaClient"),
    "env gate должен срабатывать до PrismaClient",
  );

  // Импорт не создаёт мастеров
  assert.doesNotMatch(core, /createMaster|masters\.create/i);
  assert.ok(!REQUIRED_MASTERS.includes("Юлия"));

  // Нет обхода production
  assert.doesNotMatch(core + cli, /force-production|FORCE_PRODUCTION/);

  // createPrisma factory существует и не логирует DATABASE_URL
  assert.match(core, /createPrismaCatalogImportRepository/);
  assert.doesNotMatch(core + cli, /console\.(log|error|info).*DATABASE_URL/);
  void createPrismaCatalogImportRepository;

  assert.equal(IMPORT_SERVICES.length, 101);
  assert.equal(detectImportDuplicates(IMPORT_SERVICES).length, 0);
}

async function main(): Promise<void> {
  const previousAppEnv = process.env.APP_ENV;
  process.env.APP_ENV = "staging";
  try {
    testCliArgsAndEnvGate();
    testMasterMatching();
    await testDryRunDoesNotWrite();
    await testMissingAndAmbiguousService();
    await testCanonicalDuplicateBlocks();
    await testDescriptionProtectionAndStale();
    await testIdempotentSecondPlan();
    await testConflictRollsBackTransaction();
    testStaticGuarantees();
    console.log("security-catalog-import-check: OK");
  } finally {
    if (previousAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = previousAppEnv;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
