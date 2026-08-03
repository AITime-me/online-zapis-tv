import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_WHEEL_PRIZE_DEFINITIONS,
  sumDefaultWheelSectors,
} from "../src/lib/game/wheel/default-prizes";
import {
  ISOLATED_BUILD_DATABASE_URL,
  buildIsolatedBuildEnv,
  buildIsolatedPlaywrightEnv,
  buildIsolatedRuntimeEnv,
} from "./lib/wheel-isolated-env";
import {
  CATALOG_GIFT_ID_PREFIX,
  CATALOG_IDS,
  wheelGiftId,
} from "./lib/wheel-isolated-seed";

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_WHEEL_E2E_TEST_COUNT = 13;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertEphemeralPostgresHelper(): void {
  const helper = read("scripts/lib/ephemeral-postgres.ts");
  assert.match(helper, /postgres:16-alpine/);
  assert.match(helper, /namePrefix/);
  assert.match(helper, /cleanup/);
  assert.doesNotMatch(helper, /docker system prune/);
  assert.match(helper, /docker", \["rm", "-f", containerName\]/);
}

function assertIsolatedSeed(): void {
  const seed = read("scripts/lib/wheel-isolated-seed.ts");
  assert.match(seed, /e2e-wheel-active/);
  assert.match(seed, /e2e-wheel-draft/);
  assert.match(seed, /e2e-wheel-invalid/);
  assert.match(seed, /publishRequiredLegalDocuments/);
  assert.match(seed, /onlyFirstGift/);
  assert.match(seed, /gameConfig\.upsert/);
  assert.match(seed, /CATALOG_GIFT_ID_PREFIX/);
  assert.match(seed, /wheelGiftId/);
  assert.doesNotMatch(seed, /gameCatalog\.upsert[\s\S]*publicPath/);

  const prefixes = Object.values(CATALOG_GIFT_ID_PREFIX);
  assert.equal(
    new Set(prefixes).size,
    prefixes.length,
    "gift id prefixes must be unique per catalog",
  );

  const allGiftIds: string[] = [];
  for (const catalogId of Object.values(CATALOG_IDS)) {
    for (let index = 0; index < DEFAULT_WHEEL_PRIZE_DEFINITIONS.length; index += 1) {
      const id = wheelGiftId(catalogId, index);
      assert.match(id, UUID_RE, `invalid UUID for catalog ${catalogId} index ${index}`);
      allGiftIds.push(id);
    }
  }
  assert.equal(
    new Set(allGiftIds).size,
    allGiftIds.length,
    "gift UUIDs must not be shared across catalogs",
  );

  const activeGiftIds = DEFAULT_WHEEL_PRIZE_DEFINITIONS.map((_, index) =>
    wheelGiftId(CATALOG_IDS.active, index),
  );
  const draftFirstGiftId = wheelGiftId(CATALOG_IDS.draft, 0);
  assert.notEqual(
    activeGiftIds[0],
    draftFirstGiftId,
    "active and draft catalogs must not share gift ids",
  );

  assert.equal(
    DEFAULT_WHEEL_PRIZE_DEFINITIONS.length,
    8,
    "expected 8 default wheel gifts for valid active catalog",
  );
  assert.equal(
    sumDefaultWheelSectors(),
    16,
    "valid active catalog must sum to 16 sectors",
  );
}

function assertIsolatedEnvModule(): void {
  const envModule = read("scripts/lib/wheel-isolated-env.ts");
  assert.match(envModule, /ISOLATED_BUILD_DATABASE_URL/);
  assert.match(envModule, /buildIsolatedBuildEnv/);
  assert.match(envModule, /buildIsolatedRuntimeEnv/);
  assert.match(envModule, /WHEEL_E2E_CATALOG_SLUG/);
  assert.match(envModule, /WHEEL_E2E_DRAFT_SLUG/);
  assert.match(envModule, /WHEEL_E2E_INVALID_SLUG/);
  assert.match(envModule, /PLAYWRIGHT_BASE_URL/);
  assert.match(envModule, /buildIsolatedPlaywrightEnv/);
  assert.doesNotMatch(
    envModule,
    /process\.env\.DATABASE_URL/,
    "isolated env module must not read caller DATABASE_URL",
  );

  const buildEnv = buildIsolatedBuildEnv();
  assert.equal(
    buildEnv.DATABASE_URL,
    ISOLATED_BUILD_DATABASE_URL,
    "build env must always use stub DATABASE_URL",
  );
  assert.equal(
    buildEnv.AUTH_SECRET,
    "wheel-e2e-isolated-auth-secret-32chars-min",
  );
  assert.equal(buildEnv.MAIL_PROVIDER, "disabled");

  const runtimeEnv = buildIsolatedRuntimeEnv(
    38123,
    "postgresql://postgres:wheel-isolated-test@127.0.0.1:56432/wheel_e2e",
  );
  assert.equal(
    runtimeEnv.DATABASE_URL,
    "postgresql://postgres:wheel-isolated-test@127.0.0.1:56432/wheel_e2e",
    "runtime must use ephemeral DATABASE_URL only",
  );
  assert.notEqual(runtimeEnv.DATABASE_URL, ISOLATED_BUILD_DATABASE_URL);

  const playwrightEnv = buildIsolatedPlaywrightEnv(runtimeEnv);
  assert.equal(playwrightEnv.DATABASE_URL, undefined);
  assert.equal(playwrightEnv.PLAYWRIGHT_BASE_URL, "http://127.0.0.1:38123");
}

function assertIsolatedRunner(): void {
  const runner = read("scripts/run-wheel-e2e-isolated.ts");
  assert.match(runner, /startEphemeralPostgres/);
  assert.match(runner, /seedWheelIsolatedE2eData/);
  assert.match(runner, /runPrismaMigrateDeploy/);
  assert.match(runner, /buildIsolatedBuildEnv/);
  assert.match(runner, /buildIsolatedRuntimeEnv/);
  assert.match(runner, /buildIsolatedPlaywrightEnv/);
  assert.match(runner, /playwrightDockerEnvArgs/);
  assert.match(runner, /pickAppPort/);
  assert.doesNotMatch(runner, /docker system prune/);
  assert.match(runner, /pg\.cleanup/);
  assert.match(runner, /stopChildProcess/);
  assert.match(runner, /WHEEL_E2E_PLAYWRIGHT_DOCKER/);
  assert.match(runner, /mcr\.microsoft\.com\/playwright/);
  assert.doesNotMatch(runner, /test\.skip/);
  assert.doesNotMatch(
    runner,
    /process\.env\.DATABASE_URL\s*\?\?/,
    "build must not inherit caller DATABASE_URL via ?? fallback",
  );
  assert.doesNotMatch(
    runner,
    /env:\s*\{[\s\S]*?\.\.\.process\.env[\s\S]*?ensureProductionBuild/,
    "build child process must not spread caller process.env",
  );
  assert.match(runner, /wheel-e2e-isolated: PASS/);
  assert.match(runner, /wheel-fortune-public-e2e: PASS/);
  assert.doesNotMatch(runner, /staging/i);
  assert.doesNotMatch(runner, /production DATABASE/i);
}

function assertWheelSpecNoSilentSkipInIsolatedMode(): void {
  const spec = read("tests/wheel-fortune-public.spec.ts");
  assert.match(spec, /WHEEL_E2E_ISOLATED/);
  assert.match(spec, /phoneForTest/);
  assert.match(spec, /wheel-promo-unavailable/);
  assert.match(spec, /wheel-promo-invalid-config/);
  assert.doesNotMatch(
    spec,
    /desktop happy path[\s\S]*?test\.skip\(!\(await wheelAvailable/,
  );

  const testCount = (spec.match(/^\s*test\(/gm) ?? []).length;
  assert.equal(
    testCount,
    EXPECTED_WHEEL_E2E_TEST_COUNT,
    `wheel-fortune-public.spec.ts must define ${EXPECTED_WHEEL_E2E_TEST_COUNT} tests`,
  );
}

function assertPackageScript(): void {
  const pkg = read("package.json");
  assert.match(pkg, /test:e2e:wheel:isolated/);
  assert.match(pkg, /run-wheel-e2e-isolated\.ts/);
  assert.match(pkg, /test:security:wheel-e2e-harness/);
}

function main(): void {
  assertEphemeralPostgresHelper();
  assertIsolatedSeed();
  assertIsolatedEnvModule();
  assertIsolatedRunner();
  assertWheelSpecNoSilentSkipInIsolatedMode();
  assertPackageScript();
  console.log("security-wheel-e2e-harness-check: OK");
}

main();
