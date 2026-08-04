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
  assertPlaywrightBrowsersPreflight,
  assertPlaywrightPassReport,
  assertPlaywrightPreflight,
  prepareStandaloneRuntime,
  playwrightCliJs,
  readInstalledPlaywrightVersion,
} from "./lib/wheel-isolated-runtime";
import { shouldBypassRateLimitForIsolatedWheelE2e } from "../src/lib/security/rate-limit/enforce-policy";

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
  assert.match(envModule, /PLAYWRIGHT_SYSTEM_ENV_KEYS/);
  assert.match(envModule, /PLAYWRIGHT_BROWSERS_PATH/);
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
  assert.match(
    envModule,
    /PLAYWRIGHT_SYSTEM_ENV_KEYS\s*=\s*\[[\s\S]*?PLAYWRIGHT_BROWSERS_PATH/,
    "PLAYWRIGHT_BROWSERS_PATH must be in Playwright-only system allowlist",
  );
  const pathKeysMatch = envModule.match(
    /function isolatedProcessPathEnv\([\s\S]*?const keys = \[([\s\S]*?)\] as const/,
  );
  assert.ok(pathKeysMatch, "isolatedProcessPathEnv keys allowlist must exist");
  assert.doesNotMatch(
    pathKeysMatch[1],
    /PLAYWRIGHT_BROWSERS_PATH/,
    "PLAYWRIGHT_BROWSERS_PATH must not be in shared process path allowlist",
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
  assert.equal(migrateEnv.PLAYWRIGHT_BROWSERS_PATH, undefined);
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
  assert.equal(runtimeEnv.AUTH_URL, "http://127.0.0.1:38123");
  assert.equal(runtimeEnv.WHEEL_E2E_ISOLATED, "1");
  assert.equal(runtimeEnv.NODE_ENV, "production");
  assert.equal(runtimeEnv.PLAYWRIGHT_BROWSERS_PATH, undefined);
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
  assert.equal(buildEnv.PLAYWRIGHT_BROWSERS_PATH, undefined);

  const previousBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH = "/ms-playwright";
  let playwrightEnv: NodeJS.ProcessEnv;
  try {
    playwrightEnv = buildIsolatedPlaywrightEnv(runtimeEnv);
  } finally {
    if (previousBrowsersPath === undefined) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsersPath;
    }
  }
  assert.equal(playwrightEnv.DATABASE_URL, undefined);
  assert.equal(playwrightEnv.PLAYWRIGHT_BASE_URL, "http://127.0.0.1:38123");
  assert.equal(playwrightEnv.PLAYWRIGHT_BROWSERS_PATH, "/ms-playwright");
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
  assert.match(runtime, /assertPlaywrightBrowsersPreflight/);
  assert.match(runtime, /assertPlaywrightPassReport/);
  assert.match(runtime, /chromium\.executablePath/);
  assert.match(runtime, /PLAYWRIGHT_BROWSERS_PATH/);
  assert.match(runtime, /Chromium executable not found under PLAYWRIGHT_BROWSERS_PATH/);
  assert.match(runtime, /from "@playwright\/test"/);
  assert.doesNotMatch(runtime, /["']npx["'][\s\S]{0,40}playwright[\s\S]{0,20}install/);
  assert.doesNotMatch(runtime, /spawnSync\(\s*["']npx["']/);
  assert.doesNotMatch(
    runtime,
    /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD/,
  );
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
        requireBrowsers: false,
      }),
    /localhost:3000|127\.0\.0\.1/,
  );
  assert.throws(
    () =>
      assertPlaywrightPreflight({
        baseUrl: "https://staging.example.com",
        requireStandalone: false,
        requireBrowsers: false,
      }),
    /non-isolated|127\.0\.0\.1/,
  );
  assert.doesNotThrow(() =>
    assertPlaywrightPreflight({
      baseUrl: "http://127.0.0.1:38123",
      requireStandalone: false,
      requireBrowsers: false,
    }),
  );

  const previousBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  try {
    assert.throws(
      () => assertPlaywrightBrowsersPreflight(),
      /PLAYWRIGHT_BROWSERS_PATH is required/,
    );
  } finally {
    if (previousBrowsersPath === undefined) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsersPath;
    }
  }

  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
    ROOT,
    "test-results",
    "missing-ms-playwright-dir",
  );
  try {
    assert.throws(
      () => assertPlaywrightBrowsersPreflight(),
      /PLAYWRIGHT_BROWSERS_PATH does not exist|Chromium executable not found/,
    );
  } finally {
    if (previousBrowsersPath === undefined) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsersPath;
    }
  }

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
  assert.match(runner, /assertPlaywrightBrowsersPreflight/);
  assert.match(runner, /assertPlaywrightPreflight/);
  assert.match(runner, /assertPlaywrightPassReport/);
  assert.match(runner, /playwrightCliJs/);
  assert.doesNotMatch(runner, /npx playwright install/);
  assert.doesNotMatch(runner, /playwright install/);
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
  assert.match(spec, /getByTestId\(["']wheel-phone-input["']\)/);
  assert.match(spec, /getByTestId\(["']legal-personal-data-consent["']\)/);
  assert.match(spec, /getByTestId\(["']legal-offer-acknowledgement["']\)/);
  assert.match(spec, /getByTestId\(["']wheel-error-alert["']\)/);
  assert.match(spec, /assertNoWheelGameError/);
  assert.match(spec, /__next-route-announcer__|role="alert"/);
  assert.match(
    spec,
    /Fail only on the game error region|must not be treated as a game error/,
  );
  assert.doesNotMatch(
    spec,
    /gameErrorCount > 0 \|\| alertCount > 0/,
    "assertNoWheelGameError must not fail on unrelated role=alert (Next.js route announcer)",
  );
  assert.match(spec, /waitForResponse/);
  assert.match(spec, /\/api\/game\/wheel\/start/);
  assert.match(spec, /wheel start failed/);
  assert.match(spec, /phoneE164/);
  assert.match(spec, /getByTestId\(["']wheel-prize-name["']\)/);
  assert.match(spec, /getByTestId\(["']wheel-submitted["']\)/);
  assert.match(spec, /startPostCount\)\.toBe\(1\)/);

  // Test #4 — contact validation before spin (React contact step, not native HTML submit).
  assert.match(spec, /contact-continue/);
  assert.match(spec, /Введите имя|Укажите имя/);
  assert.match(
    spec,
    /name, phone and consents are required[\s\S]*?startPostCount\)\.toBe\(0\)/,
  );
  assert.match(
    spec,
    /name, phone and consents are required[\s\S]*?wheel-spin-button[\s\S]*?toHaveCount\(0\)/,
  );
  assert.match(
    spec,
    /name, phone and consents are required[\s\S]*?getByText\(\/соглас/,
  );
  assert.match(spec, /reachReady|choosePrimaryLipsPreferences|fillContactForm/);
  assert.match(spec, /wheel-spin-button/);
  assert.match(spec, /preferences-continue/);
  assert.match(
    spec,
    /startResponse\.request\(\)\.postData\(\)|startRequestText/,
  );
  assert.match(
    spec,
    /startRequestText[\s\S]*?interest[\s\S]*?confirmedZone|postData\(\)[\s\S]*?interest[\s\S]*?confirmedZone/,
  );

  // Session API must use in-page fetch (Secure cookies on HTTP loopback).
  assert.match(spec, /fetchJsonInPage/);
  assert.match(spec, /assertWheelResultInPage/);
  assert.match(spec, /assertAllowlistedWheelApiPath|WHEEL_IN_PAGE_API_PATH/);
  assert.match(
    spec,
    /\/\^\\\/api\\\/game\\\/wheel\\\/\(start\|result\|complete\)\(\?:\\\?\|\$\)\//,
  );
  assert.match(spec, /credentials:\s*["']include["']/);
  assert.match(
    spec,
    /Node-side page\.request cookie jar|page\.request Node jar/,
  );
  assert.match(spec, /hasVisitorCookie/);
  assert.match(spec, /hasSessionCookie/);
  assert.match(spec, /wheel result request failed/);
  assert.match(spec, /HTTP \$\{result\.status\}|HTTP \$\{retry\.status\}/);
  assert.match(
    spec,
    /wheel in-page fetch rejected:\s*path outside wheel API allowlist|outside wheel API allowlist/,
  );
  assert.match(
    spec,
    /wheel in-page fetch rejected:\s*non-relative or unsafe path|non-relative or unsafe path/,
  );
  assert.doesNotMatch(
    spec,
    /page\.request\.(get|post|fetch)\s*\(/,
    "wheel session API must not use page.request (Secure cookie jar mismatch on HTTP loopback)",
  );
  assert.doesNotMatch(
    spec,
    /request\.newContext|apiRequestContext|browser\.newContext\(\)[\s\S]{0,80}request/,
    "must not create a detached APIRequestContext without browser cookies",
  );
  assert.doesNotMatch(
    spec,
    /new URL\(\s*path\s*,/,
    "fetchJsonInPage must not resolve path against an external base URL",
  );
  assert.doesNotMatch(
    spec,
    /Origin:\s*origin/,
    "must not set forbidden Origin header manually; browser supplies same-origin Origin",
  );

  // Allowlist must run before browser fetch (page.evaluate).
  {
    const allowlistConstPos = spec.search(
      /WHEEL_IN_PAGE_API_PATH_RE\s*=\s*\/\^\\\/api\\\/game\\\/wheel\\\/\(start\|result\|complete\)\(\?:\\\?\|\$\)\//,
    );
    assert.ok(
      allowlistConstPos >= 0,
      "WHEEL_IN_PAGE_API_PATH_RE must allowlist only start|result|complete",
    );

    const fetchFnStart = spec.indexOf("async function fetchJsonInPage");
    assert.ok(fetchFnStart >= 0, "fetchJsonInPage must be defined");
    assert.ok(
      allowlistConstPos < fetchFnStart,
      "path allowlist regex must be defined before fetchJsonInPage",
    );

    const fetchFnSlice = spec.slice(fetchFnStart, fetchFnStart + 1_200);
    const guardPos = fetchFnSlice.search(
      /assertAllowlistedWheelApiPath\s*\(\s*path\s*\)/,
    );
    const evaluatePos = fetchFnSlice.indexOf("page.evaluate");
    assert.ok(
      guardPos >= 0,
      "fetchJsonInPage must call assertAllowlistedWheelApiPath(path)",
    );
    assert.ok(evaluatePos >= 0, "fetchJsonInPage must use page.evaluate");
    assert.ok(
      guardPos < evaluatePos,
      "path allowlist must run before page.evaluate / browser fetch",
    );
    assert.doesNotMatch(
      fetchFnSlice.slice(0, evaluatePos),
      /\bfetch\s*\(/,
      "browser fetch must not run before path allowlist succeeds",
    );
  }

  // Test #5 — one start POST after dblclick + in-page readable result (not DB row count).
  assert.match(spec, /dblclick/);
  assert.match(
    spec,
    /double-click sends one start request[\s\S]*?startPostCount\)\.toBe\(1\)/,
  );
  assert.match(
    spec,
    /double-click sends one start request[\s\S]*?assertWheelResultInPage/,
  );
  assert.match(
    spec,
    /double-click sends one start request[\s\S]*?hasSessionCookie\)\.toBe\(true\)/,
  );
  assert.doesNotMatch(
    spec,
    /double-click start creates one session result/,
    "test #5 title must not claim DB session-result uniqueness",
  );

  // Test #6 — result restore after reload + PII reset + session cookies.
  assert.match(
    spec,
    /refresh restores[\s\S]*?isWheelResultGet|refresh restores[\s\S]*?\/api\/game\/wheel\/result/,
  );
  assert.match(
    spec,
    /refresh restores[\s\S]*?toHaveValue\(["']["']\)/,
  );
  assert.match(
    spec,
    /refresh restores[\s\S]*?hasSessionCookie\)\.toBe\(true\)/,
  );

  // Test #7/#9 — complete count / idempotency key reuse + session continuity.
  assert.match(
    spec,
    /retry complete[\s\S]*?completePostCount\)\.toBe\(1\)/,
  );
  assert.match(
    spec,
    /retry complete[\s\S]*?hasSessionCookie\)\.toBe\(true\)/,
  );
  assert.match(
    spec,
    /network retry on complete[\s\S]*?idempotencyKeys\[1\]\)\.toBe\(idempotencyKeys\[0\]\)/,
  );
  assert.match(
    spec,
    /network retry on complete[\s\S]*?completeCalls\)\.toBe\(2\)/,
  );

  // Test #8 — E164 + same-origin in-page result/complete (no page.request, no manual Origin).
  assert.match(
    spec,
    /different interest after success[\s\S]*?phoneE164\(phone\)/,
  );
  assert.match(
    spec,
    /different interest after success[\s\S]*?assertWheelResultInPage/,
  );
  assert.match(
    spec,
    /different interest after success[\s\S]*?fetchJsonInPage[\s\S]*?\/api\/game\/wheel\/complete/,
  );
  assert.match(
    spec,
    /different interest after success[\s\S]*?credentials:\s*["']include["']|different interest after success[\s\S]*?fetchJsonInPage/,
  );
  assert.doesNotMatch(
    spec,
    /different interest after success[\s\S]*?Origin:\s*origin/,
    "test #8 must rely on browser same-origin Origin, not a manual header",
  );

  // Test #10/#11 — distinct blocked states.
  assert.match(
    spec,
    /DRAFT catalog blocked[\s\S]*?wheel-promo-unavailable[\s\S]*?wheel-promo-invalid-config[\s\S]*?toHaveCount\(0\)/,
  );
  assert.match(
    spec,
    /ACTIVE invalid config blocked[\s\S]*?wheel-promo-invalid-config[\s\S]*?wheel-promo-unavailable[\s\S]*?toHaveCount\(0\)/,
  );

  // Test #13 — real Catch-Time marker, not generic body/HTTP<500.
  assert.match(spec, /\.poimay-game/);
  assert.match(spec, /#screen-start/);
  assert.match(
    spec,
    /procedure-gift page still loads[\s\S]*?status\(\)\)\.toBe\(200\)/,
  );
  assert.doesNotMatch(
    spec,
    /procedure-gift page still loads[\s\S]*?locator\(["']body["']\)/,
    "Catch-Time must assert a real game marker, not only body visibility",
  );

  assert.doesNotMatch(
    spec,
    /if \(\(await personal\.count\(\)\) > 0\)/,
    "acceptConsents must not silently skip missing consent checkboxes",
  );
  assert.doesNotMatch(
    spec,
    /getByLabel\(["']Телефон["']\)/,
    "phone fill must not target the ambiguous Телефон label (country-code button)",
  );
  assert.doesNotMatch(
    spec,
    /desktop happy path[\s\S]*?test\.skip\(!\(await wheelAvailable/,
  );
  assert.doesNotMatch(
    spec,
    /getByRole\(["']alert["']\)[\s\S]{0,80}toBeVisible/,
    "tests must not assert visibility via generic role=alert",
  );

  const phonesUsed = [
    ...spec.matchAll(/phoneForTest\((\d+)\)/g),
  ].map((match) => Number(match[1]));
  assert.ok(phonesUsed.length >= 6, "independent tests must use phoneForTest");
  assert.equal(
    new Set(phonesUsed).size,
    phonesUsed.length,
    "phoneForTest numbers must be unique across the suite",
  );

  const testCount = (spec.match(/^\s*test\(/gm) ?? []).length;
  assert.equal(
    testCount,
    EXPECTED_WHEEL_E2E_TEST_COUNT,
    `wheel-fortune-public.spec.ts must define ${EXPECTED_WHEEL_E2E_TEST_COUNT} tests`,
  );

  const wheelUi = read("src/components/game/wheel-fortune-public.tsx");
  assert.match(wheelUi, /data-testid=["']wheel-phone-input["']/);
  assert.match(wheelUi, /aria-label=["']Номер телефона["']/);
  assert.match(wheelUi, /type=["']tel["']/);
  assert.match(wheelUi, /WheelFortuneView/);
  assert.match(wheelUi, /mapUiPreferencesToCompletePayload/);
  assert.match(wheelUi, /startRequestSerial/);
  assert.match(wheelUi, /startSucceededRef/);
  assert.match(wheelUi, /spinningLock/);
  assert.match(wheelUi, /\/api\/game\/wheel\/start/);
  assert.match(wheelUi, /\/api\/game\/wheel\/complete/);
  assert.doesNotMatch(
    wheelUi,
    /wheel_lead_draft_|writeLeadDraft|readLeadDraft/,
    "must not persist lead PII in sessionStorage",
  );

  const wheelResultStep = read(
    "src/components/game/wheel-ui/wheel-result-step.tsx",
  );
  assert.match(wheelResultStep, /data-testid=["']wheel-prize-name["']/);
  assert.match(wheelResultStep, /data-testid=["']wheel-complete-button["']/);

  const wheelSubmittedStep = read(
    "src/components/game/wheel-ui/wheel-submitted-step.tsx",
  );
  assert.match(wheelSubmittedStep, /data-testid=["']wheel-submitted["']/);

  const wheelIntroStep = read(
    "src/components/game/wheel-ui/wheel-intro-step.tsx",
  );
  assert.match(wheelIntroStep, /data-testid=["']wheel-start-button["']/);

  const legalFields = read("src/components/booking/booking-legal-links.tsx");
  assert.match(legalFields, /type=["']checkbox["']/);
  assert.doesNotMatch(
    legalFields,
    /type=["']checkbox["'][\s\S]{0,120}required/,
    "consent checkboxes must remain React-validated (not native required)",
  );

  const catchTime = read("src/components/game/procedure-gift-game-vanilla.tsx");
  assert.match(catchTime, /poimay-game/);
  assert.match(catchTime, /id=["']screen-start["']/);

  const countrySelect = read("src/components/booking/phone-country-select.tsx");
  assert.match(countrySelect, /aria-label=["']Код страны["']/);

  const rateLimitEnforce = read("src/lib/security/rate-limit/enforce-policy.ts");
  assert.match(rateLimitEnforce, /shouldBypassRateLimitForIsolatedWheelE2e/);
  assert.match(
    rateLimitEnforce,
    /WHEEL_E2E_ISOLATED\s*===\s*["']1["']/,
    "rate-limit bypass must require WHEEL_E2E_ISOLATED=1",
  );
  assert.match(
    rateLimitEnforce,
    /if \(shouldBypassRateLimitForIsolatedWheelE2e\(\)\)\s*\{\s*return null;/,
  );

  assert.equal(
    shouldBypassRateLimitForIsolatedWheelE2e({}),
    false,
    "rate-limit bypass must be off without WHEEL_E2E_ISOLATED",
  );
  assert.equal(
    shouldBypassRateLimitForIsolatedWheelE2e({ WHEEL_E2E_ISOLATED: "1" }),
    true,
  );
  assert.equal(
    shouldBypassRateLimitForIsolatedWheelE2e({ WHEEL_E2E_ISOLATED: "0" }),
    false,
  );

  const envSource = read("src/lib/env.ts");
  assert.match(
    envSource,
    /allowIsolatedE2eLoopbackHttp:\s*process\.env\.WHEEL_E2E_ISOLATED\s*===\s*["']1["']/,
    "production AUTH_URL loopback bypass must require WHEEL_E2E_ISOLATED=1",
  );
  const authPolicy = read("src/lib/auth-url-policy.ts");
  assert.match(authPolicy, /allowIsolatedE2eLoopbackHttp/);
  assert.match(authPolicy, /isLoopbackHostname/);
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
