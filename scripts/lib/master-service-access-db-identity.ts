import { isIP } from "node:net";

export const STAGING_DB_HOSTNAME = "tvoe-vremya-staging-postgres";
export const STAGING_DATABASE_NAME = "tvoe_vremya_staging";
export const STAGING_DB_PORT = 5432;

const KNOWN_PRODUCTION_HOSTNAMES = new Set([
  "tvoe-vremya-production-postgres",
  "postgres",
  "tvoe-vremya-production_production_internal",
]);
const KNOWN_PRODUCTION_DATABASES = new Set(["tvoe_vremya"]);

export type ExpectedStagingDbIdentity = {
  hostname: string;
  databaseName: string;
  port: number;
};

function identityError(reason: string): Error {
  return new Error(`DB integration refused: ${reason}`);
}

/** Fail-closed URL check. Error messages never contain URL credentials. */
export function assertExpectedStagingDatabaseUrl(
  databaseUrl: string | undefined,
): ExpectedStagingDbIdentity {
  if (!databaseUrl) {
    throw identityError("DATABASE_URL identity is missing");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw identityError("DATABASE_URL identity is invalid");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw identityError("DATABASE_URL protocol is not PostgreSQL");
  }

  const hostname = parsed.hostname.toLowerCase();
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  const port = parsed.port ? Number(parsed.port) : STAGING_DB_PORT;

  if (
    KNOWN_PRODUCTION_HOSTNAMES.has(hostname) ||
    KNOWN_PRODUCTION_DATABASES.has(databaseName)
  ) {
    throw identityError("known production database identity detected");
  }
  if (
    hostname !== STAGING_DB_HOSTNAME ||
    databaseName !== STAGING_DATABASE_NAME
  ) {
    throw identityError("database identity is not the approved staging target");
  }
  if (port !== STAGING_DB_PORT) {
    throw identityError("database port is not the approved staging port");
  }

  return { hostname, databaseName, port };
}

/**
 * Post-connect staging identity. Does not compare inet_server_addr() to Node
 * DNS results: Docker bridge addresses are not stable across resolvers.
 */
export function assertConnectedStagingDatabaseIdentity(
  expected: ExpectedStagingDbIdentity,
  actual: {
    currentDatabase: string | null;
    serverAddress: string | null;
    serverPort: number | null;
  },
): void {
  if (actual.currentDatabase !== expected.databaseName) {
    throw identityError("connected database name does not match staging");
  }
  if (actual.serverPort !== expected.port) {
    throw identityError("connected server port does not match staging");
  }
  if (!actual.serverAddress || isIP(actual.serverAddress) === 0) {
    throw identityError("connected server address is missing or invalid");
  }
}
