/**
 * Статический аудит production bootstrap канонических рабочих данных.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  BOOTSTRAP_EXPECTED_COUNTS,
  CANONICAL_CATEGORIES,
  CANONICAL_COLD_PLASMA_SERVICE_IDS,
  CANONICAL_GAME_GIFTS,
  CANONICAL_MASTERS,
  CANONICAL_SERVICES,
  CATEGORY_STABLE_BY_NAME,
  MASTER_STABLE_BY_NAME,
  PREMIUM_GIFT_ID,
  SHOWCASE_DISCOUNT_PROMOTION,
  assertCanonicalBootstrapIntegrity,
  assertUniqueImportNums,
  bootstrapServiceId,
  buildCanonicalCategories,
  buildCanonicalMasters,
  categoryIdsByNameFromOrder,
  masterIdsByNameFromOrder,
} from "./ops/lib/production-bootstrap-canonical";
import { CATEGORY_ORDER, IMPORT_SERVICES, REQUIRED_MASTERS } from "./data/import-services-data";
import {
  CANONICAL_GAME_GIFTS as SHARED_GIFTS,
  SHOWCASE_DISCOUNT_PROMOTION as SHARED_PROMO,
} from "./ops/lib/game-promotions-canonical";
import {
  CANONICAL_GAME_GIFTS as STAGING_GIFTS,
  SHOWCASE_DISCOUNT_PROMOTION as STAGING_PROMO,
} from "./ops/lib/staging-game-promotions-canonical";
import { PREMIUM_TIERS_ENABLED } from "../src/lib/game/tier/server-tier-policy";
import { PROMO_RULES } from "../src/lib/promo/promo-engine";

const ROOT = process.cwd();

const SECRET_KEYS = [
  "AUTH_SECRET",
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "SMTP_PASSWORD",
  "PGPASSWORD",
] as const;

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripBashComments(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let inHeredoc = false;
  let heredocMarker = "";
  for (const line of lines) {
    if (inHeredoc) {
      out.push(line);
      if (line.trim() === heredocMarker) inHeredoc = false;
      continue;
    }
    const heredocMatch = line.match(/<<-?\s*['"]?(\w+)['"]?/);
    if (heredocMatch) {
      inHeredoc = true;
      heredocMarker = heredocMatch[1] ?? "";
      out.push(line);
      continue;
    }
    if (/^\s*#/.test(line)) continue;
    out.push(line.replace(/(^|[^\\])#.*$/, "$1"));
  }
  return out.join("\n");
}

function resolveBashExecutable(): string {
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "bash",
  ];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-c", "echo ok"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return "bash";
}

function assertShellScript(): void {
  const source = read("scripts/ops/production-bootstrap-data.sh");
  const executable = stripBashComments(source);

  assert.match(executable, /ops_assert_production_checkout/);
  assert.match(executable, /ops_validate_production_env_file/);
  assert.match(executable, /--dry-run/);
  assert.match(executable, /--apply/);
  assert.match(executable, /BOOTSTRAP PRODUCTION DATA/);
  assert.match(executable, /ops_acquire_production_ops_lock/);
  assert.match(executable, /ops_create_production_postgres_backup\s+"prebootstrap"/);
  assert.match(executable, /production-bootstrap-data-cli\.ts/);
  assert.match(executable, /BOOTSTRAP_STATUS/);
  assert.match(executable, /GAME_REMAINS_DISABLED=1/);

  assert.doesNotMatch(executable, /tvoe-vremya-staging/);
  assert.doesNotMatch(executable, /\.env\.staging/);
  assert.doesNotMatch(executable, /\/opt\/online-zapis-tv[^-]/);
  assert.doesNotMatch(executable, /db:seed(?!:production)/);
  assert.doesNotMatch(executable, /prisma\/seed\.ts/);
  assert.doesNotMatch(executable, /git reset --hard/);
  assert.doesNotMatch(executable, /migrate deploy/);

  const dryIdx = executable.indexOf('ops_info "Dry-run complete');
  const lockIdx = executable.indexOf("ops_acquire_production_ops_lock");
  assert.ok(dryIdx >= 0 && lockIdx > dryIdx, "dry-run must exit before lock");

  const backupIdx = executable.indexOf('ops_create_production_postgres_backup "prebootstrap"');
  const applyCliIdx = executable.indexOf('run_bootstrap_cli --apply');
  assert.ok(backupIdx >= 0 && applyCliIdx > backupIdx, "backup before apply writes");

  for (const secret of SECRET_KEYS) {
    assert.doesNotMatch(executable, new RegExp(`\\becho\\b[^;\\n]*${secret}`, "i"));
  }
}

function assertCliAndCanonical(): void {
  assertCanonicalBootstrapIntegrity();
  assert.equal(BOOTSTRAP_EXPECTED_COUNTS.masters, 5);
  assert.equal(BOOTSTRAP_EXPECTED_COUNTS.categories, 11);
  assert.equal(BOOTSTRAP_EXPECTED_COUNTS.services, 101);
  assert.equal(BOOTSTRAP_EXPECTED_COUNTS.masterServices, 101);
  assert.equal(BOOTSTRAP_EXPECTED_COUNTS.gifts, 4);
  assert.equal(BOOTSTRAP_EXPECTED_COUNTS.promotions, 1);
  assert.equal(BOOTSTRAP_EXPECTED_COUNTS.promotionServices, 13);

  assert.equal(CANONICAL_MASTERS.length, 5);
  assert.equal(CANONICAL_CATEGORIES.length, 11);
  assert.equal(CANONICAL_SERVICES.length, 101);
  assert.equal(REQUIRED_MASTERS.length, 5);
  assert.equal(IMPORT_SERVICES.length, 101);
  assert.equal(CANONICAL_GAME_GIFTS.length, 4);
  assert.equal(CANONICAL_COLD_PLASMA_SERVICE_IDS.length, 13);
  assert.equal(bootstrapServiceId(14), "a3000001-0000-4000-8000-000000000014");
  assert.equal(
    CANONICAL_SERVICES.find((s) => s.importNum === 14)?.publicName,
    "Холодная плазма лица",
  );

  const formula = CANONICAL_GAME_GIFTS.find((g) => g.id === PREMIUM_GIFT_ID);
  assert.ok(formula);
  assert.equal(formula!.requiredPremiumLevel, 2);
  assert.equal(formula!.name, "Формула сияния");

  assert.equal(SHOWCASE_DISCOUNT_PROMOTION.ctaLink, "/booking");
  assert.equal(SHOWCASE_DISCOUNT_PROMOTION.status, "ACTIVE");

  // Bindings always resolve to stable master/service IDs — orphan impossible in plan.
  const masterIds = new Set(CANONICAL_MASTERS.map((m) => m.id));
  const serviceIds = new Set(CANONICAL_SERVICES.map((s) => s.id));
  for (const service of CANONICAL_SERVICES) {
    assert.ok(masterIds.has(service.masterId), `binding master missing for ${service.id}`);
    assert.ok(serviceIds.has(service.id));
    assert.equal(service.masterId, MASTER_STABLE_BY_NAME[service.masterName as keyof typeof MASTER_STABLE_BY_NAME].id);
    assert.equal(
      service.categoryId,
      CATEGORY_STABLE_BY_NAME[service.categoryName as keyof typeof CATEGORY_STABLE_BY_NAME],
    );
  }
  for (const promoServiceId of CANONICAL_COLD_PLASMA_SERVICE_IDS) {
    assert.ok(serviceIds.has(promoServiceId), `promo link orphan ${promoServiceId}`);
  }

  const cli = read("scripts/ops/lib/production-bootstrap-data-cli.ts");
  assert.match(cli, /\$transaction/);
  assert.match(cli, /fail-fast/);
  assert.match(cli, /conflict/);
  assert.match(cli, /noop/);
  assert.match(cli, /gameCatalogId:\s*catalog\.id/);
  assert.match(cli, /isActive=false/);
  assert.match(cli, /@example\.local/);
  assert.doesNotMatch(cli, /appointment\.create/);
  assert.doesNotMatch(cli, /client\.create/);
  assert.doesNotMatch(cli, /bookingRequest\.create/);
  assert.doesNotMatch(cli, /user\.create/);

  const canonical = read("scripts/ops/lib/production-bootstrap-canonical.ts");
  assert.match(canonical, /import-services-data/);
  assert.match(canonical, /game-promotions-canonical/);
  assert.doesNotMatch(canonical, /staging-game-promotions-canonical/);
  assert.doesNotMatch(canonical, /00000000-0000-4000-8000/);
  assert.match(canonical, /MASTER_STABLE_BY_NAME/);
  assert.match(canonical, /CATEGORY_STABLE_BY_NAME/);
}

function assertSharedCanonicalSource(): void {
  assert.equal(SHARED_GIFTS, STAGING_GIFTS);
  assert.equal(SHARED_PROMO, STAGING_PROMO);
  assert.equal(CANONICAL_GAME_GIFTS, SHARED_GIFTS);
  assert.equal(SHOWCASE_DISCOUNT_PROMOTION, SHARED_PROMO);

  const productionCanonical = read("scripts/ops/lib/production-bootstrap-canonical.ts");
  assert.match(productionCanonical, /from "\.\/game-promotions-canonical"/);
  assert.doesNotMatch(productionCanonical, /from "\.\/staging-game-promotions-canonical"/);

  const stagingWrapper = read("scripts/ops/lib/staging-game-promotions-canonical.ts");
  assert.match(stagingWrapper, /from "\.\/game-promotions-canonical"/);
  assert.match(stagingWrapper, /FORBIDDEN_PROMOTION_MARKERS/);
  assert.match(stagingWrapper, /collectRestorePostCheckErrors/);
}

function assertStableUuidReorderAndDuplicates(): void {
  const baselineMasters = masterIdsByNameFromOrder(REQUIRED_MASTERS);
  const reversedMasters = masterIdsByNameFromOrder([...REQUIRED_MASTERS].reverse());
  const rotatedMasters = masterIdsByNameFromOrder([
    REQUIRED_MASTERS[2]!,
    REQUIRED_MASTERS[4]!,
    REQUIRED_MASTERS[0]!,
    REQUIRED_MASTERS[3]!,
    REQUIRED_MASTERS[1]!,
  ]);

  for (const name of REQUIRED_MASTERS) {
    assert.equal(reversedMasters[name], baselineMasters[name], `master id shifted for ${name}`);
    assert.equal(rotatedMasters[name], baselineMasters[name], `master id rotated for ${name}`);
    assert.equal(baselineMasters[name], MASTER_STABLE_BY_NAME[name as keyof typeof MASTER_STABLE_BY_NAME].id);
  }

  const baselineCategories = categoryIdsByNameFromOrder(CATEGORY_ORDER);
  const reversedCategoryOrder = Object.fromEntries(
    Object.entries(CATEGORY_ORDER).reverse(),
  );
  const reversedCategories = categoryIdsByNameFromOrder(reversedCategoryOrder);
  for (const name of Object.keys(CATEGORY_ORDER)) {
    assert.equal(
      reversedCategories[name],
      baselineCategories[name],
      `category id shifted for ${name}`,
    );
    assert.equal(
      baselineCategories[name],
      CATEGORY_STABLE_BY_NAME[name as keyof typeof CATEGORY_STABLE_BY_NAME],
    );
  }

  assert.throws(
    () => buildCanonicalMasters(["Ксения Вайзер", "Ксения Вайзер", ...REQUIRED_MASTERS.slice(1)]),
    /duplicate master name/,
  );
  assert.throws(
    () => buildCanonicalMasters(REQUIRED_MASTERS.slice(0, 4)),
    /canonical master missing/,
  );
  assert.throws(
    () =>
      buildCanonicalCategories({
        ...CATEGORY_ORDER,
        "Холодная плазма": CATEGORY_ORDER["Аппаратная и эстетическая безинъекционная косметология"]!,
      }),
    /duplicate category sortOrder/,
  );
  assert.throws(
    () =>
      assertUniqueImportNums([
        IMPORT_SERVICES[0]!,
        { ...IMPORT_SERVICES[1]!, num: IMPORT_SERVICES[0]!.num },
      ]),
    /duplicate import num/,
  );

  // Building from reversed order still yields same IDs (not array-index identity).
  const rebuilt = buildCanonicalMasters([...REQUIRED_MASTERS].reverse());
  assert.equal(rebuilt.length, 5);
  assert.deepEqual(
    new Set(rebuilt.map((m) => m.id)),
    new Set(CANONICAL_MASTERS.map((m) => m.id)),
  );
}

function assertPromoEngineUntouched(): void {
  assert.equal(PREMIUM_TIERS_ENABLED, false);

  const coldPlasma = PROMO_RULES.find((rule) => rule.id === "cold-plasma-first-visit-30");
  assert.ok(coldPlasma);
  assert.equal(coldPlasma!.discountPercent, 30);
  assert.equal(coldPlasma!.categoryName, "Холодная плазма");

  const engine = read("src/lib/promo/promo-engine.ts");
  assert.match(engine, /cold-plasma-first-visit-30/);
  assert.doesNotMatch(engine, /skidka-30-holodnaya-plazma/);
  assert.doesNotMatch(engine, /SHOWCASE_DISCOUNT_PROMOTION/);
  assert.doesNotMatch(engine, /promotionService|promotion_services/i);

  const cli = read("scripts/ops/lib/production-bootstrap-data-cli.ts");
  assert.doesNotMatch(cli, /from ["'].*promo-engine/);
  assert.doesNotMatch(cli, /PROMO_RULES/);
  assert.match(cli, /promotionService\.create/);
}

function assertDockerfileAndDeployIsolation(): void {
  const dockerfile = read("Dockerfile");
  assert.match(dockerfile, /game-promotions-canonical\.ts/);
  assert.match(dockerfile, /production-bootstrap-data-cli\.ts/);
  assert.match(dockerfile, /production-bootstrap-canonical\.ts/);
  assert.match(dockerfile, /import-services-data\.ts/);
  assert.doesNotMatch(dockerfile, /prisma\/seed\.ts/);
  assert.doesNotMatch(dockerfile, /CMD.*seed|ENTRYPOINT.*seed/i);

  const deploy = read("scripts/ops/production-deploy.sh");
  assert.doesNotMatch(deploy, /bootstrap-data/);
  assert.doesNotMatch(deploy, /BOOTSTRAP PRODUCTION DATA/);
}

function assertDocumentation(): void {
  const doc = read("docs/operations/production-bootstrap.md");
  assert.match(doc, /--dry-run/);
  assert.match(doc, /--apply/);
  assert.match(doc, /BOOTSTRAP PRODUCTION DATA/);
  assert.match(doc, /import-services-data/);
  assert.match(doc, /выключен/i);
  assert.match(doc, /promo-engine/);
  assert.match(doc, /owner:create/);
  assert.match(doc, /вызывается из deploy/i);

  const deployDoc = read("docs/operations/production-deploy.md");
  assert.match(deployDoc, /production-bootstrap\.md/);
}

function assertShellSyntaxAndHelp(): void {
  const bash = resolveBashExecutable();
  const syntax = spawnSync(bash, ["-n", "scripts/ops/production-bootstrap-data.sh"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(syntax.status, 0, `bash -n failed:\n${syntax.stderr}`);

  const help = spawnSync(bash, ["scripts/ops/production-bootstrap-data.sh", "--help"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /BOOTSTRAP PRODUCTION DATA/);
  assert.match(help.stdout, /--apply/);
}

function run(): void {
  assertShellScript();
  assertCliAndCanonical();
  assertSharedCanonicalSource();
  assertStableUuidReorderAndDuplicates();
  assertPromoEngineUntouched();
  assertDockerfileAndDeployIsolation();
  assertDocumentation();
  assertShellSyntaxAndHelp();
  console.log("security-production-bootstrap-check: OK");
}

run();
