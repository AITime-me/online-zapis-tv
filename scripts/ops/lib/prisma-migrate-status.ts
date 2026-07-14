/**
 * Классификация вывода `prisma migrate status` (Prisma 6.19.x).
 * Используется в security-тестах и CLI для deploy-скриптов.
 */

export type MigrateStatusKind = "up_to_date" | "pending" | "error";

export type MigrateStatusErrorReason =
  | "connection"
  | "diverged"
  | "failed"
  | "no_migration_table"
  | "unknown_success_output"
  | "unknown";

export type MigrateStatusResult =
  | { kind: "up_to_date" }
  | { kind: "pending"; migrationNames: string[] }
  | { kind: "error"; reason: MigrateStatusErrorReason; safeSummary: string };

const PENDING_HEADER =
  /Following migrations? have not yet been applied:/i;

const CONNECTION_PATTERNS = [
  /can't reach database server/i,
  /P1001/i,
  /P1017/i,
  /connection refused/i,
  /Error:\s*P\d{4}/i,
  /ECONNREFUSED/i,
];

export function extractPendingMigrationNames(output: string): string[] {
  const lines = output.split(/\r?\n/);
  const names: string[] = [];
  let inBlock = false;

  for (const line of lines) {
    if (PENDING_HEADER.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      const trimmed = line.trim();
      if (!trimmed) {
        break;
      }
      if (/^To apply migrations/i.test(trimmed)) {
        break;
      }
      if (/^During development/i.test(trimmed)) {
        break;
      }
      names.push(trimmed);
    }
  }

  return names;
}

export function classifyPrismaMigrateStatus(
  exitCode: number,
  output: string,
): MigrateStatusResult {
  const text = output.trim();

  if (exitCode === 0) {
    if (/Database schema is up to date!/i.test(text)) {
      return { kind: "up_to_date" };
    }
    return {
      kind: "error",
      reason: "unknown_success_output",
      safeSummary: "unexpected migrate status output with exit code 0",
    };
  }

  for (const pattern of CONNECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        kind: "error",
        reason: "connection",
        safeSummary: "database connection error during migrate status",
      };
    }
  }

  if (
    /Your local migration history and the migrations table from your database are different/i.test(
      text,
    )
  ) {
    return {
      kind: "error",
      reason: "diverged",
      safeSummary: "migration history diverged between filesystem and database",
    };
  }

  if (/Following migrations? have failed:/i.test(text)) {
    return {
      kind: "error",
      reason: "failed",
      safeSummary: "failed migrations detected in database",
    };
  }

  if (/not managed by Prisma Migrate/i.test(text)) {
    return {
      kind: "error",
      reason: "no_migration_table",
      safeSummary: "database is not managed by Prisma Migrate",
    };
  }

  if (PENDING_HEADER.test(text)) {
    const migrationNames = extractPendingMigrationNames(text);
    if (migrationNames.length === 0) {
      return {
        kind: "error",
        reason: "unknown",
        safeSummary: "pending migration header without migration names",
      };
    }
    return { kind: "pending", migrationNames };
  }

  return {
    kind: "error",
    reason: "unknown",
    safeSummary: "unrecognized migrate status output with non-zero exit code",
  };
}

export function formatMigrateStatusResult(result: MigrateStatusResult): string {
  if (result.kind === "up_to_date") {
    return "up_to_date";
  }
  if (result.kind === "pending") {
    return "pending";
  }
  return `error:${result.reason}`;
}
