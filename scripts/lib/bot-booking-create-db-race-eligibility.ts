/**
 * Race-suite eligibility: disposable-DB guard before any connectivity probe.
 */
import {
  assertDisposableBotBookingTestDatabase,
  BotBookingCreateTestDbGuardError,
} from "./bot-booking-create-test-db-guard";

export type BotBookingCreateRaceEligibility =
  | { kind: "skip"; detail: string }
  | { kind: "fail"; detail: string; code: string }
  | { kind: "proceed"; databaseUrl: string };

export type BotBookingCreateRaceEligibilityInput = {
  databaseUrl: string | undefined | null;
  requirePostgres: boolean;
  env?: NodeJS.ProcessEnv;
  /** Injected — must not be called before guard succeeds. */
  canQuery: (databaseUrl: string) => Promise<boolean>;
};

/**
 * Decide whether races may run. Never calls canQuery until the disposable-DB
 * guard accepts the URL (no Prisma / TCP before that).
 */
export async function resolveBotBookingCreateRaceEligibility(
  input: BotBookingCreateRaceEligibilityInput,
): Promise<BotBookingCreateRaceEligibility> {
  const env = input.env ?? process.env;
  const databaseUrl = input.databaseUrl?.trim() ?? "";

  if (!databaseUrl) {
    if (input.requirePostgres) {
      return {
        kind: "fail",
        code: "MISSING_DATABASE_URL",
        detail: "DATABASE_URL missing",
      };
    }
    return { kind: "skip", detail: "DATABASE_URL missing" };
  }

  try {
    assertDisposableBotBookingTestDatabase(databaseUrl, env);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : String(error);
    const code =
      error instanceof BotBookingCreateTestDbGuardError
        ? error.code
        : "TEST_DATABASE_GUARD";
    if (input.requirePostgres) {
      return { kind: "fail", code, detail };
    }
    return { kind: "skip", detail };
  }

  const reachable = await input.canQuery(databaseUrl);
  if (!reachable) {
    if (input.requirePostgres) {
      return {
        kind: "fail",
        code: "POSTGRES_UNREACHABLE",
        detail: "PostgreSQL unreachable",
      };
    }
    return { kind: "skip", detail: "PostgreSQL unreachable" };
  }

  return { kind: "proceed", databaseUrl };
}
