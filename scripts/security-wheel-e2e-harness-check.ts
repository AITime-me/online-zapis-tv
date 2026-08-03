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
  buildIsolatedMigrateEnv,
  buildIsolatedPlaywrightEnv,
  buildIsolatedRuntimeEnv,
} from "./lib/wheel-isolated-env";
import {
  CATALOG_GIFT_ID_PREFIX,
  CATALOG_IDS,
  wheelGiftId,
} from "./lib/wheel-isolated-seed";
import {
  EXPECTED_PLAYWRIGHT_IMAGE,
  EXPECTED_PLAYWRIGHT_VERSION,
  EXPECTED_WHEEL_E2E_TEST_COUNT,
  WHEEL_E2E_CONFIG_REL,
  WHEEL_E2E_SPEC_REL,
  assertPlaywrightPassReport,
  assertPlaywrightPreflight,
  prepareStandaloneRuntime,
  playwrightCliJs,
  readInstalledPlaywrightVersion,
} from "./lib/wheel-isolated-runtime";

const ROOT = path.resolve(__dirname, "..");

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
  assert.match(helper, /buildIsolatedMigrateEnv/);
  assert.match(helper, /env:\s*buildIsolatedMigrateEnv\(databaseUrl\)/);
  assert.doesNotMatch(
    helper,
    /\.\.\.process\.env/,
    "runPrismaMigrateDeploy must not spread caller process.env",
  );
  assert.doesNotMatch(
    helper,
    /process\.env\.DATABASE_URL/,
    "ephemeral postgres helper must not read caller DATABASE_URL",
  );
  assert.doesNotMatch(
    helper,
    /env:\s*\{[\s\S]*?\.\.\.process\.env[\s\S]*?DATABASE_URL/,
    "migrate child env must not inherit caller shell via process.env spread",
  );
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
  assert.match(envModule, /buildIsolatedMigrateEnv/);
  assert.match(envModule, /buildIsolatedRuntimeEnv/);
  assert.match(envModule, /WHEEL_E2E_CATALOG_SLUG/);
  assert.match(envModule, /WHEEL_E2E_DRAFT_SLUG/);
  assert.match(envModule, /WHEEL_E2E_INVALID_SLUG/);
  assert.match(envModule, /PLAYWRIGHT_BASE_URL/);
  assert.match(envModule, /buildIsolatedPlaywrightEnv/);
  assert.match(envModule, /HOSTNAME:\s*"127\.0\.0\.1"/);
  assert.match(envModule, /PORT:\s*String\(port\)/);
  assert.doesNotMatch(
    envModule,
    /process\.env\.DATABASE_URL/,
    "isolated env module must not read caller DATABASE_URL",
  );
  assert.doesNotMatch(
    envModule,
    /playwrightDockerEnvArgs/,
    "nested Playwright Docker env helpers must be removed",
  );
  assert.doesNotMatch(
    envModule,
    /WHEEL_E2E_PLAYWRIGHT_DOCKER/,
    "nested Playwright Docker env flag must be removed",
  );
  assert.doesNotMatch(
    envModule,
    /\.\.\.process\.env/,
    "isolated env builders must not spread caller process.env",
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
  assert.equal(buildEnv.NODE_ENV, "production");
  assert.doesNotMatch(
    buildEnv.DATABASE_URL ?? "",
    /staging|production|online-zapis|tvoe-vremya/i,
  );

  const ephemeralUrl =
    "postgresql://postgres:wheel-isolated-test@127.0.0.1:56432/wheel_e2e";
  const migrateEnv = buildIsolatedMigrateEnv(ephemeralUrl);
  assert.equal(
    migrateEnv.DATABASE_URL,
    ephemeralUrl,
    "migrate must use only the ephemeral DATABASE_URL argument",
  );
  assert.equal(migrateEnv.NODE_ENV, "test");
  assert.equal(
    migrateEnv.AUTH_SECRET,
    "wheel-e2e-isolated-auth-secret-32chars-min",
  );
  assert.equal(migrateEnv.MAIL_PROVIDER, "disabled");
  assert.equal(migrateEnv.PLAYWRIGHT_BASE_URL, undefined);
  assert.notEqual(migrateEnv.DATABASE_URL, ISOLATED_BUILD_DATABASE_URL);
  assert.equal(
    Object.prototype.hasOwnProperty.call(migrateEnv, "DATABASE_URL"),
    true,
  );
  // Caller secrets / staging URLs must never appear as migrate values.
  for (const [key, value] of Object.entries(migrateEnv)) {
    if (typeof value !== "string") continue;
    assert.doesNotMatch(
      value,
      /staging|production\.|online-zapis\.|tvoe-vremya/i,
      `migrate env ${key} must not contain staging/production URLs`,
    );
  }
  assert.ok(
    !("AWS_SECRET_ACCESS_KEY" in migrateEnv),
    "migrate env must not inherit caller secrets",
  );
  assert.ok(
    !("GITHUB_TOKEN" in migrateEnv),
    "migrate env must not inherit caller secrets",
  );

  const runtimeEnv = buildIsolatedRuntimeEnv(38123, ephemeralUrl);
  assert.equal(
    runtimeEnv.DATABASE_URL,
    ephemeralUrl,
    "runtime must use ephemeral DATABASE_URL only",
  );
  assert.notEqual(runtimeEnv.DATABASE_URL, ISOLATED_BUILD_DATABASE_URL);
  assert.equal(runtimeEnv.PORT, "38123");
  assert.equal(runtimeEnv.HOSTNAME, "127.0.0.1");
  assert.equal(runtimeEnv.PLAYWRIGHT_BASE_URL, "http://127.0.0.1:38123");
  assert.notEqual(
    runtimeEnv.DATABASE_URL,
    buildEnv.DATABASE_URL,
    "build and runtime DATABASE_URL must remain separated",
  );
  assert.notEqual(
    migrateEnv.NODE_ENV,
    runtimeEnv.NODE_ENV,
    "migrate and runtime NODE_ENV must remain separated",
  );

  const playwrightEnv = buildIsolatedPlaywrightEnv(runtimeEnv);
  assert.equal(playwrightEnv.DATABASE_URL, undefined);
  assert.equal(playwrightEnv.PLAYWRIGHT_BASE_URL, "http://127.0.0.1:38123");
  assert.equal(playwrightEnv.PORT, undefined);
  assert.equal(playwrightEnv.HOSTNAME, undefined);
  assert.equal(playwrightEnv.AUTH_SECRET, undefined);
  assert.ok(
    !("DATABASE_URL" in playwrightEnv),
    "Playwright must not receive DATABASE_URL",
  );
}

function assertIsolatedRuntimeHelpers(): void {
  const runtime = read("scripts/lib/wheel-isolated-runtime.ts");
  assert.match(runtime, /EXPECTED_PLAYWRIGHT_VERSION/);
  assert.match(runtime, /EXPECTED_PLAYWRIGHT_IMAGE/);
  assert.match(runtime, /prepareStandaloneRuntime/);
  assert.match(runtime, /assertStandalonePrepared/);
  assert.match(runtime, /assertPlaywrightPreflight/);
  assert.match(runtime, /assertPlaywrightPassReport/);
  assert.match(runtime, /\.next["'],\s*["']standalone/);
  assert.match(runtime, /\.next["'],\s*["']static/);
  assert.match(runtime, /["']public["']/);
  assert.match(runtime, /refusing npx\/network install/);
  assert.equal(EXPECTED_PLAYWRIGHT_VERSION, "1.61.1");
  assert.match(
    EXPECTED_PLAYWRIGHT_IMAGE,
    new RegExp(`v${EXPECTED_PLAYWRIGHT_VERSION}`),
  );
  assert.equal(
    EXPECTED_PLAYWRIGHT_IMAGE,
    "mcr.microsoft.com/playwright:v1.61.1-noble",
  );

  const installed = readInstalledPlaywrightVersion(ROOT);
  assert.equal(
    installed,
    EXPECTED_PLAYWRIGHT_VERSION,
    "node_modules @playwright/test must match locked version",
  );
  assert.ok(
    fs.existsSync(playwrightCliJs(ROOT)),
    "local Playwright CLI must exist",
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, WHEEL_E2E_SPEC_REL)),
    "wheel E2E spec must exist",
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, WHEEL_E2E_CONFIG_REL)),
    "playwright config must exist",
  );

  assert.throws(
    () =>
      assertPlaywrightPreflight({
        baseUrl: "http://localhost:3000",
        requireStandalone: false,
      }),
    /localhost:3000|127\.0\.0\.1/,
  );
  assert.throws(
    () =>
      assertPlaywrightPreflight({
        baseUrl: "https://staging.example.com",
        requireStandalone: false,
      }),
    /non-isolated|127\.0\.0\.1/,
  );
  assert.doesNotThrow(() =>
    assertPlaywrightPreflight({
      baseUrl: "http://127.0.0.1:38123",
      requireStandalone: false,
    }),
  );

  const tmpReport = path.join(ROOT, "test-results", "wheel-e2e-harness-check-tmp.json");
  fs.mkdirSync(path.dirname(tmpReport), { recursive: true });
  fs.writeFileSync(
    tmpReport,
    JSON.stringify({
      stats: {
        expected: EXPECTED_WHEEL_E2E_TEST_COUNT,
        unexpected: 0,
        skipped: 0,
        flaky: 0,
      },
    }),
  );
  assert.doesNotThrow(() =>
    assertPlaywrightPassReport(tmpReport, EXPECTED_WHEEL_E2E_TEST_COUNT),
  );
  fs.writeFileSync(
    tmpReport,
    JSON.stringify({
      stats: { expected: 12, unexpected: 0, skipped: 1, flaky: 0 },
    }),
  );
  assert.throws(
    () => assertPlaywrightPassReport(tmpReport, EXPECTED_WHEEL_E2E_TEST_COUNT),
    /skipped|expected 13/,
  );
  fs.unlinkSync(tmpReport);

  // If a prior standalone build exists, prepareStandaloneRuntime must copy assets.
  const standaloneServer = path.join(ROOT, ".next", "standalone", "server.js");
  if (fs.existsSync(standaloneServer) && fs.existsSync(path.join(ROOT, ".next", "static"))) {
    const serverJs = prepareStandaloneRuntime(ROOT);
    assert.equal(serverJs, standaloneServer);
    assert.ok(
      fs.existsSync(path.join(ROOT, ".next", "standalone", ".next", "static")),
      "prepareStandaloneRuntime must copy .next/static into standalone",
    );
  }
}

function assertIsolatedRunner(): void {
  const runner = read("scripts/run-wheel-e2e-isolated.ts");
  assert.match(runner, /startEphemeralPostgres/);
  assert.match(runner, /seedWheelIsolatedE2eData/);
  assert.match(runner, /runPrismaMigrateDeploy/);
  assert.match(runner, /buildIsolatedBuildEnv/);
  assert.match(runner, /buildIsolatedRuntimeEnv/);
  assert.match(runner, /buildIsolatedPlaywrightEnv/);
  assert.match(runner, /pickAppPort/);
  assert.match(runner, /prepareStandaloneRuntime/);
  assert.match(runner, /assertPlaywrightPreflight/);
  assert.match(runner, /assertPlaywrightPassReport/);
  assert.match(runner, /playwrightCliJs/);
  assert.match(
    runner,
    /spawn\(process\.execPath,\s*playwrightNodeArgs\(\)/,
  );
  assert.match(runner, /process\.execPath/);
  // Locked CLI path is constructed in wheel-isolated-runtime via playwrightCliJs().
  const runtimeSrc = read("scripts/lib/wheel-isolated-runtime.ts");
  assert.match(runtimeSrc, /@playwright["'],\s*["']test["'],\s*["']cli\.js/);
  assert.match(runtimeSrc, /node_modules/);
  assert.doesNotMatch(runner, /docker system prune/);
  assert.match(runner, /pg\.cleanup/);
  assert.match(runner, /stopChildProcess/);
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

  // Nested Playwright Docker mode is forbidden (DinD mount traps).
  assert.doesNotMatch(
    runner,
    /WHEEL_E2E_PLAYWRIGHT_DOCKER/,
    "nested Playwright Docker mode flag must be removed",
  );
  assert.doesNotMatch(
    runner,
    /playwrightDockerEnvArgs/,
    "nested Playwright Docker env args must be removed",
  );
  assert.doesNotMatch(
    runner,
    /runPlaywrightDocker/,
    "nested Playwright Docker runner must be removed",
  );
  assert.doesNotMatch(
    runner,
    /mcr\.microsoft\.com\/playwright[\s\S]{0,200}docker/,
    "must not docker-run nested Playwright image",
  );
  assert.doesNotMatch(
    runner,
    /docker[\s\S]{0,120}mcr\.microsoft\.com\/playwright/,
    "must not docker-run nested Playwright image",
  );
  assert.doesNotMatch(
    runner,
    /["']-v["'][\s\S]{0,80}\/work/,
    "must not mount /work into a nested Playwright container",
  );
  assert.doesNotMatch(
    runner,
    /spawn\(\s*["']docker["']/,
    "runner must not spawn docker for Playwright (socket only for ephemeral PG helper)",
  );

  // Preferred path: locked local CLI in current container/process.
  assert.match(runner, /locked local CLI/);
  assert.match(
    runner,
    /spawn\(process\.execPath,\s*playwrightNodeArgs\(\)/,
  );

  // Forbidden launch modes
  assert.doesNotMatch(
    runner,
    /["']next["'],\s*["']start["']/,
    "must not use next start with output:standalone",
  );
  assert.doesNotMatch(runner, /next start/);
  assert.doesNotMatch(runner, /next dev/);
  assert.doesNotMatch(
    runner,
    /\bnpx\b[\s\S]{0,40}\bplaywright\b/,
    "must not invoke npx playwright (auto-install risk)",
  );
  assert.doesNotMatch(
    runner,
    /["']npx["'],\s*\[?\s*["']playwright["']/,
    "must not spawn npx playwright",
  );
  assert.doesNotMatch(
    runner,
    /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD|npx playwright install|auto-?install/i,
  );

  // Strict readiness: health success then promo 200 (404 is never ready).
  assert.match(runner, /\/api\/health/);
  assert.match(runner, /health\.ok/);
  assert.match(runner, /promo\.status\s*!==\s*200|promo\.status\s*===\s*200/);
  assert.doesNotMatch(
    runner,
    /promo\.status\s*<\s*500/,
    "readiness must not treat status < 500 (including 404) as ready",
  );
  assert.match(runner, /wheel-fortune-public/);

  // Cleanup order: stop Next before prisma disconnect before postgres cleanup
  const finallyIdx = runner.indexOf("} finally {");
  assert.ok(finallyIdx > 0, "runner must have finally cleanup");
  const finallyBlock = runner.slice(finallyIdx);
  const stopIdx = finallyBlock.indexOf("stopChildProcess");
  const disconnectIdx = finallyBlock.indexOf("$disconnect");
  const pgIdx = finallyBlock.indexOf("pg.cleanup");
  assert.ok(stopIdx >= 0 && pgIdx >= 0, "finally must stop Next and cleanup postgres");
  assert.ok(
    stopIdx < pgIdx,
    "Next.js must be stopped before postgres cleanup",
  );
  assert.ok(disconnectIdx >= 0, "finally must disconnect Prisma");
  assert.ok(
    stopIdx < disconnectIdx && disconnectIdx < pgIdx,
    "cleanup order must be: stop Next → disconnect Prisma → remove postgres",
  );
  assert.match(finallyBlock, /cleanup — stopping standalone Next\.js/);
  assert.match(finallyBlock, /cleanup — removing postgres/);

  // PASS only after verified report + exit 0
  assert.match(runner, /verifiedPass/);
  assert.match(runner, /wheel-e2e-isolated: PASS/);
  assert.match(runner, /wheel-fortune-public-e2e: PASS/);
  assert.match(
    runner,
    new RegExp(
      String.raw`PASS \(\$\{EXPECTED_WHEEL_E2E_TEST_COUNT\} tests\)|PASS \(${EXPECTED_WHEEL_E2E_TEST_COUNT} tests\)`,
    ),
  );
  assert.doesNotMatch(runner, /staging/i);
  assert.doesNotMatch(runner, /production DATABASE/i);

  // Standalone launch contract
  assert.match(runner, /\.next\/standalone|prepareStandaloneRuntime/);
  assert.match(runner, /shell:\s*false/);
  assert.match(runner, /buildIsolatedRuntimeEnv\(port,\s*pg\.databaseUrl\)/);
}

function assertPlaywrightConfigIsolatedGuards(): void {
  const config = read("playwright.config.ts");
  assert.match(config, /WHEEL_E2E_ISOLATED/);
  assert.match(config, /PLAYWRIGHT_BASE_URL/);
  assert.match(config, /WHEEL_E2E_JSON_REPORT/);
  assert.match(config, /127\.0\.0\.1/);
  assert.match(config, /localhost:3000/);
  assert.match(config, /refuses default localhost:3000/);
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
  assert.match(pkg, /"@playwright\/test":\s*"\^?1\.61\.1"/);
}

function assertNextConfigStandaloneUnchangedForHarness(): void {
  const nextConfig = read("next.config.ts");
  assert.match(
    nextConfig,
    /output:\s*"standalone"/,
    "project must keep output:standalone; harness must launch node server.js",
  );
}

function main(): void {
  assertEphemeralPostgresHelper();
  assertIsolatedSeed();
  assertIsolatedEnvModule();
  assertIsolatedRuntimeHelpers();
  assertIsolatedRunner();
  assertPlaywrightConfigIsolatedGuards();
  assertWheelSpecNoSilentSkipInIsolatedMode();
  assertPackageScript();
  assertNextConfigStandaloneUnchangedForHarness();
  console.log("security-wheel-e2e-harness-check: OK");
}

main();
