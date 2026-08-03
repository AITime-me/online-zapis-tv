import { WHEEL_E2E_SLUGS } from "./wheel-isolated-seed";

/**
 * Stub DATABASE_URL for `next build` only. Never a real/staging database.
 * Build must not read DATABASE_URL from the caller shell.
 */
export const ISOLATED_BUILD_DATABASE_URL =
  "postgresql://postgres:build@127.0.0.1:65534/wheel_e2e_build_stub";

export const ISOLATED_AUTH_SECRET =
  "wheel-e2e-isolated-auth-secret-32chars-min";

export const ISOLATED_VIEW_TOKEN =
  "wheel-e2e-schedule-view-token-32chars";

const ISOLATED_BUILD_AUTH_URL = "http://127.0.0.1:3000";

/** Process vars required for npm/spawn; excludes secrets and DATABASE_URL. */
function isolatedProcessPathEnv(): NodeJS.ProcessEnv {
  const keys = [
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "NODE_OPTIONS",
    "NODE_PATH",
    "TEMP",
    "TMP",
    "ComSpec",
    "LANG",
    "LC_ALL",
  ] as const;

  const out: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value) {
      out[key] = value;
    }
  }
  return out;
}

/** Safe isolated defaults shared by build and runtime child processes. */
export function buildIsolatedBaseEnv(): NodeJS.ProcessEnv {
  return {
    ...isolatedProcessPathEnv(),
    AUTH_SECRET: ISOLATED_AUTH_SECRET,
    SCHEDULE_VIEW_TOKEN: ISOLATED_VIEW_TOKEN,
    MAIL_PROVIDER: "disabled",
  };
}

/** Env for `npm run build` — always stub DATABASE_URL, never caller shell. */
export function buildIsolatedBuildEnv(): NodeJS.ProcessEnv {
  return {
    ...buildIsolatedBaseEnv(),
    NODE_ENV: "production",
    DATABASE_URL: ISOLATED_BUILD_DATABASE_URL,
    AUTH_URL: ISOLATED_BUILD_AUTH_URL,
  };
}

/**
 * Env for `prisma migrate deploy` against ephemeral postgres.
 * Never spreads caller process.env; never reads the caller-shell database URL.
 */
export function buildIsolatedMigrateEnv(
  ephemeralDatabaseUrl: string,
): NodeJS.ProcessEnv {
  return {
    ...buildIsolatedBaseEnv(),
    NODE_ENV: "test",
    DATABASE_URL: ephemeralDatabaseUrl,
  };
}

/**
 * Env for standalone `node .next/standalone/server.js`.
 * Only ephemeral DATABASE_URL from harness postgres — never caller shell.
 */
export function buildIsolatedRuntimeEnv(
  port: number,
  ephemeralDatabaseUrl: string,
): NodeJS.ProcessEnv {
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    ...buildIsolatedBaseEnv(),
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: ephemeralDatabaseUrl,
    AUTH_URL: baseUrl,
    PLAYWRIGHT_BASE_URL: baseUrl,
    WHEEL_E2E_ISOLATED: "1",
    WHEEL_E2E_CATALOG_SLUG: WHEEL_E2E_SLUGS.active,
    WHEEL_E2E_DRAFT_SLUG: WHEEL_E2E_SLUGS.draft,
    WHEEL_E2E_INVALID_SLUG: WHEEL_E2E_SLUGS.invalid,
  };
}

const PLAYWRIGHT_ENV_KEYS = [
  "PLAYWRIGHT_BASE_URL",
  "WHEEL_E2E_ISOLATED",
  "WHEEL_E2E_CATALOG_SLUG",
  "WHEEL_E2E_DRAFT_SLUG",
  "WHEEL_E2E_INVALID_SLUG",
] as const;

/**
 * Playwright-only system allowlist. Not copied into migrate/build/runtime.
 * Official image sets PLAYWRIGHT_BROWSERS_PATH=/ms-playwright.
 */
const PLAYWRIGHT_SYSTEM_ENV_KEYS = ["PLAYWRIGHT_BROWSERS_PATH"] as const;

/** Minimal env passed to Playwright in the current process/container. No DATABASE_URL. */
export function buildIsolatedPlaywrightEnv(
  runtimeEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...isolatedProcessPathEnv() };
  for (const key of PLAYWRIGHT_ENV_KEYS) {
    const value = runtimeEnv[key];
    if (value) {
      out[key] = value;
    }
  }
  for (const key of PLAYWRIGHT_SYSTEM_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      out[key] = value;
    }
  }
  return out;
}
