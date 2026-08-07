/**
 * Fail-closed guard: CURSOR-24 required DB suite may mutate only disposable test DBs.
 */
export class BotBookingCreateTestDbGuardError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BotBookingCreateTestDbGuardError";
    this.code = code;
  }
}

const FORBIDDEN_EXACT_NAMES = new Set([
  "tvoe_vremya",
  "postgres",
  "template0",
  "template1",
]);

/**
 * Test marker in database name (CI uses bot_booking_create_gate).
 */
export function databaseNameHasTestMarker(databaseName: string): boolean {
  const name = databaseName.trim().toLowerCase();
  if (!name) return false;
  if (name.includes("c24test")) return true;
  if (name.includes("c26test")) return true;
  if (name.includes("bot_booking_create")) return true;
  if (name.includes("master_command")) return true;
  if (/(^|_)test(_|$)/.test(name)) return true;
  if (name.startsWith("test_")) return true;
  if (name.endsWith("_test")) return true;
  return false;
}

export function parseDatabaseNameFromUrl(databaseUrl: string): string | null {
  try {
    const normalized = databaseUrl
      .trim()
      .replace(/^postgresql:/i, "http:")
      .replace(/^postgres:/i, "http:");
    const url = new URL(normalized);
    const name = decodeURIComponent(url.pathname.replace(/^\//, "")).split(
      "/",
    )[0];
    if (!name) return null;
    return name;
  } catch {
    return null;
  }
}

function hostLooksProduction(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h.includes("prod") ||
    h.includes("production") ||
    h.endsWith(".rds.amazonaws.com")
  );
}

/**
 * Throws BotBookingCreateTestDbGuardError unless DB is disposable test DB.
 *
 * Allowed when:
 * - DATABASE_URL parses;
 * - database name has an explicit test marker;
 * - name is not a known working/prod name;
 * - AND either CI=true OR BOT_BOOKING_CREATE_ALLOW_TEST_DB_MUTATION=true
 *   (flag alone is insufficient without test marker).
 */
export function assertDisposableBotBookingTestDatabase(
  databaseUrl: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): { databaseName: string } {
  if (databaseUrl == null || !databaseUrl.trim()) {
    throw new BotBookingCreateTestDbGuardError(
      "MISSING_DATABASE_URL",
      "DATABASE_URL required for bot booking create DB mutations",
    );
  }

  const databaseName = parseDatabaseNameFromUrl(databaseUrl);
  if (!databaseName) {
    throw new BotBookingCreateTestDbGuardError(
      "UNPARSEABLE_DATABASE_URL",
      "DATABASE_URL database name could not be determined",
    );
  }

  const lower = databaseName.toLowerCase();
  if (FORBIDDEN_EXACT_NAMES.has(lower)) {
    throw new BotBookingCreateTestDbGuardError(
      "FORBIDDEN_DATABASE_NAME",
      `Database "${databaseName}" is not a disposable test database`,
    );
  }
  if (lower.includes("production") || /(^|_)prod($|_)/.test(lower)) {
    throw new BotBookingCreateTestDbGuardError(
      "PRODUCTION_DATABASE_NAME",
      `Database "${databaseName}" looks like production`,
    );
  }

  try {
    const normalized = databaseUrl
      .trim()
      .replace(/^postgresql:/i, "http:")
      .replace(/^postgres:/i, "http:");
    const url = new URL(normalized);
    if (hostLooksProduction(url.hostname)) {
      throw new BotBookingCreateTestDbGuardError(
        "PRODUCTION_HOST",
        "DATABASE_URL host looks like production",
      );
    }
  } catch (error) {
    if (error instanceof BotBookingCreateTestDbGuardError) throw error;
    throw new BotBookingCreateTestDbGuardError(
      "UNPARSEABLE_DATABASE_URL",
      "DATABASE_URL could not be parsed",
    );
  }

  if (!databaseNameHasTestMarker(databaseName)) {
    throw new BotBookingCreateTestDbGuardError(
      "MISSING_TEST_MARKER",
      `Database "${databaseName}" lacks test marker (_test/test_/c24test/bot_booking_create)`,
    );
  }

  const allowFlag = env.BOT_BOOKING_CREATE_ALLOW_TEST_DB_MUTATION === "true";
  const ci = env.CI === "true" || env.CI === "1";
  if (!allowFlag && !ci) {
    throw new BotBookingCreateTestDbGuardError(
      "MUTATION_NOT_ALLOWED",
      "Set BOT_BOOKING_CREATE_ALLOW_TEST_DB_MUTATION=true (with test DB name) or run under CI",
    );
  }

  return { databaseName };
}
