import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

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
}

function assertIsolatedRunner(): void {
  const runner = read("scripts/run-wheel-e2e-isolated.ts");
  assert.match(runner, /startEphemeralPostgres/);
  assert.match(runner, /seedWheelIsolatedE2eData/);
  assert.match(runner, /runPrismaMigrateDeploy/);
  assert.match(runner, /WHEEL_E2E_CATALOG_SLUG/);
  assert.match(runner, /WHEEL_E2E_DRAFT_SLUG/);
  assert.match(runner, /WHEEL_E2E_INVALID_SLUG/);
  assert.match(runner, /PLAYWRIGHT_BASE_URL/);
  assert.match(runner, /pickAppPort/);
  assert.doesNotMatch(runner, /docker system prune/);
  assert.match(runner, /pg\.cleanup/);
  assert.match(runner, /stopChildProcess/);
  assert.match(runner, /WHEEL_E2E_PLAYWRIGHT_DOCKER/);
  assert.match(runner, /mcr\.microsoft\.com\/playwright/);
  assert.doesNotMatch(runner, /test\.skip/);
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
  assertIsolatedRunner();
  assertWheelSpecNoSilentSkipInIsolatedMode();
  assertPackageScript();
  console.log("security-wheel-e2e-harness-check: OK");
}

main();
