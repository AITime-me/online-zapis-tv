import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

export type EphemeralPostgres = {
  databaseUrl: string;
  containerName: string;
  port: number;
  cleanup: () => Promise<void>;
};

export async function canReachPostgres(databaseUrl: string): Promise<boolean> {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

function dockerAvailable(): boolean {
  const probe = spawnSync("docker", ["info"], {
    encoding: "utf8",
    timeout: 15_000,
  });
  return probe.status === 0;
}

export type StartEphemeralPostgresInput = {
  /** Prefix for container name, e.g. wheel-complete-pg or wheel-e2e-pg */
  namePrefix: string;
  databaseName?: string;
  password?: string;
};

/**
 * Starts a dedicated postgres:16-alpine container on a free local port.
 * Caller must call cleanup() in finally.
 */
export async function startEphemeralPostgres(
  input: StartEphemeralPostgresInput,
): Promise<EphemeralPostgres | null> {
  if (!dockerAvailable()) {
    return null;
  }

  const containerName = `${input.namePrefix}-${Date.now()}`;
  const password = input.password ?? "wheel-isolated-test";
  const databaseName = input.databaseName ?? "wheel_isolated";
  const port = 56432 + (Date.now() % 1000);

  const run = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      `POSTGRES_DB=${databaseName}`,
      "-p",
      `${port}:5432`,
      "postgres:16-alpine",
    ],
    { encoding: "utf8", timeout: 120_000 },
  );

  if (run.status !== 0) {
    return null;
  }

  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/${databaseName}`;

  const cleanup = async (): Promise<void> => {
    spawnSync("docker", ["rm", "-f", containerName], {
      encoding: "utf8",
      timeout: 30_000,
    });
  };

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await canReachPostgres(databaseUrl)) {
      return { databaseUrl, containerName, port, cleanup };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  await cleanup();
  return null;
}

export function runPrismaMigrateDeploy(databaseUrl: string): void {
  const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    encoding: "utf8",
    timeout: 300_000,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    shell: true,
  });
  if (migrate.status !== 0) {
    throw new Error(
      `prisma migrate deploy failed: ${migrate.stderr || migrate.stdout}`,
    );
  }
}
