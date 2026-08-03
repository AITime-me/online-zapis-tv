import fs from "node:fs";
import path from "node:path";

/** Locked Playwright version: package-lock + preferred outer Docker image must match. */
export const EXPECTED_PLAYWRIGHT_VERSION = "1.61.1";

/** Preferred outer container for Linux server runs (not nested by the harness). */
export const EXPECTED_PLAYWRIGHT_IMAGE =
  `mcr.microsoft.com/playwright:v${EXPECTED_PLAYWRIGHT_VERSION}-noble`;

export const WHEEL_E2E_SPEC_REL = "tests/wheel-fortune-public.spec.ts";
export const WHEEL_E2E_CONFIG_REL = "playwright.config.ts";
export const EXPECTED_WHEEL_E2E_TEST_COUNT = 13;

const ROOT = path.resolve(__dirname, "../..");

export function projectRoot(): string {
  return ROOT;
}

export function playwrightCliJs(root = ROOT): string {
  return path.join(root, "node_modules", "@playwright", "test", "cli.js");
}

export function readInstalledPlaywrightVersion(root = ROOT): string {
  const pkgPath = path.join(
    root,
    "node_modules",
    "@playwright",
    "test",
    "package.json",
  );
  if (!fs.existsSync(pkgPath)) {
    throw new Error(
      `wheel-e2e-isolated: missing local @playwright/test at ${pkgPath}`,
    );
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    version?: string;
  };
  if (!pkg.version) {
    throw new Error("wheel-e2e-isolated: @playwright/test package.json has no version");
  }
  return pkg.version;
}

/**
 * Fail-fast before spawning Playwright. Checks the current project filesystem
 * (the outer Playwright container mount), never a nested container path.
 * Never falls back to network install.
 */
export function assertPlaywrightPreflight(options: {
  root?: string;
  baseUrl: string | undefined;
  requireStandalone?: boolean;
}): void {
  const root = options.root ?? ROOT;
  const spec = path.join(root, WHEEL_E2E_SPEC_REL);
  const config = path.join(root, WHEEL_E2E_CONFIG_REL);
  const cli = playwrightCliJs(root);

  if (!fs.existsSync(spec)) {
    throw new Error(`wheel-e2e-isolated: missing test spec ${spec}`);
  }
  if (!fs.existsSync(config)) {
    throw new Error(`wheel-e2e-isolated: missing playwright config ${config}`);
  }
  if (!fs.existsSync(cli)) {
    throw new Error(
      `wheel-e2e-isolated: missing local Playwright CLI ${cli} (refusing npx/network install)`,
    );
  }

  const version = readInstalledPlaywrightVersion(root);
  if (version !== EXPECTED_PLAYWRIGHT_VERSION) {
    throw new Error(
      `wheel-e2e-isolated: Playwright version mismatch: installed ${version}, expected ${EXPECTED_PLAYWRIGHT_VERSION}`,
    );
  }

  const baseUrl = options.baseUrl?.trim();
  if (!baseUrl) {
    throw new Error("wheel-e2e-isolated: PLAYWRIGHT_BASE_URL is required");
  }
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) {
    throw new Error(
      `wheel-e2e-isolated: PLAYWRIGHT_BASE_URL must be http://127.0.0.1:<port>, got ${baseUrl}`,
    );
  }
  if (/localhost:3000/i.test(baseUrl)) {
    throw new Error(
      "wheel-e2e-isolated: refusing default localhost:3000 base URL",
    );
  }
  if (/staging|production|online-zapis|tvoe-vremya/i.test(baseUrl)) {
    throw new Error(
      `wheel-e2e-isolated: refusing non-isolated base URL ${baseUrl}`,
    );
  }

  if (options.requireStandalone !== false) {
    assertStandalonePrepared(root);
  }
}

/**
 * Verify standalone server assets on the current project root filesystem.
 */
export function assertStandalonePrepared(root = ROOT): void {
  const serverJs = path.join(root, ".next", "standalone", "server.js");
  if (!fs.existsSync(serverJs)) {
    throw new Error(
      `wheel-e2e-isolated: missing standalone server ${serverJs}`,
    );
  }

  const staticSrc = path.join(root, ".next", "static");
  if (!fs.existsSync(staticSrc)) {
    throw new Error(
      `wheel-e2e-isolated: missing build static assets ${staticSrc}`,
    );
  }

  const staticInStandalone = path.join(
    root,
    ".next",
    "standalone",
    ".next",
    "static",
  );
  if (!fs.existsSync(staticInStandalone)) {
    throw new Error(
      `wheel-e2e-isolated: standalone is missing copied .next/static at ${staticInStandalone}`,
    );
  }

  const publicSrc = path.join(root, "public");
  if (fs.existsSync(publicSrc)) {
    const publicDest = path.join(root, ".next", "standalone", "public");
    if (!fs.existsSync(publicDest)) {
      throw new Error(
        `wheel-e2e-isolated: public/ exists but was not copied to ${publicDest}`,
      );
    }
  }
}

/**
 * After `next build` with output:standalone, static + public are NOT inside
 * `.next/standalone` (see Dockerfile runner stage). Copy them so
 * `node .next/standalone/server.js` can serve assets.
 */
export function prepareStandaloneRuntime(root = ROOT): string {
  const standaloneDir = path.join(root, ".next", "standalone");
  const serverJs = path.join(standaloneDir, "server.js");
  if (!fs.existsSync(serverJs)) {
    throw new Error(
      `wheel-e2e-isolated: missing ${serverJs} — production build did not produce standalone output`,
    );
  }

  const staticSrc = path.join(root, ".next", "static");
  if (!fs.existsSync(staticSrc)) {
    throw new Error(
      `wheel-e2e-isolated: missing ${staticSrc} after production build`,
    );
  }
  const staticDest = path.join(standaloneDir, ".next", "static");
  fs.mkdirSync(path.dirname(staticDest), { recursive: true });
  fs.cpSync(staticSrc, staticDest, { recursive: true, force: true });

  const publicSrc = path.join(root, "public");
  if (fs.existsSync(publicSrc)) {
    const publicDest = path.join(standaloneDir, "public");
    fs.cpSync(publicSrc, publicDest, { recursive: true, force: true });
  }

  assertStandalonePrepared(root);
  return serverJs;
}

export type PlaywrightJsonReport = {
  stats?: {
    expected?: number;
    unexpected?: number;
    flaky?: number;
    skipped?: number;
  };
};

/**
 * Require a clean Playwright run. Playwright JSON reports have no `passed`
 * field — PASS is: stats.expected === N, unexpected/skipped/flaky === 0
 * (caller must also require Playwright process exit code 0).
 */
export function assertPlaywrightPassReport(
  reportPath: string,
  expectedTests = EXPECTED_WHEEL_E2E_TEST_COUNT,
): void {
  if (!fs.existsSync(reportPath)) {
    throw new Error(
      `wheel-e2e-isolated: missing Playwright JSON report at ${reportPath}`,
    );
  }
  const report = JSON.parse(
    fs.readFileSync(reportPath, "utf8"),
  ) as PlaywrightJsonReport;
  const expected = report.stats?.expected ?? -1;
  const unexpected = report.stats?.unexpected ?? -1;
  const skipped = report.stats?.skipped ?? -1;
  const flaky = report.stats?.flaky ?? -1;

  if (unexpected !== 0) {
    throw new Error(
      `wheel-e2e-isolated: Playwright reported ${unexpected} unexpected (failed) tests`,
    );
  }
  if (flaky !== 0) {
    throw new Error(
      `wheel-e2e-isolated: Playwright reported ${flaky} flaky tests`,
    );
  }
  if (skipped !== 0) {
    throw new Error(
      `wheel-e2e-isolated: Playwright reported ${skipped} skipped tests (isolated mode forbids skips)`,
    );
  }
  if (expected !== expectedTests) {
    throw new Error(
      `wheel-e2e-isolated: expected ${expectedTests} passed tests (stats.expected), Playwright stats.expected=${expected}`,
    );
  }
}
