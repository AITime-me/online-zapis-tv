import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  runPrismaMigrateDeploy,
  startEphemeralPostgres,
} from "./lib/ephemeral-postgres";
import {
  seedWheelIsolatedE2eData,
  WHEEL_E2E_SLUGS,
} from "./lib/wheel-isolated-seed";

const ROOT = path.resolve(__dirname, "..");

const ISOLATED_AUTH_SECRET = "wheel-e2e-isolated-auth-secret-32chars-min";
const ISOLATED_VIEW_TOKEN = "wheel-e2e-schedule-view-token-32chars";

function pickAppPort(): number {
  return 38000 + (Date.now() % 2000);
}

async function waitForHttpReady(baseUrl: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown";

  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${baseUrl}/api/health`);
      if (health.ok) {
        return;
      }
      lastError = `health status ${health.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    try {
      const promo = await fetch(`${baseUrl}/promo/${WHEEL_E2E_SLUGS.active}`);
      if (promo.status < 500) {
        return;
      }
      lastError = `promo status ${promo.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`App not ready at ${baseUrl}: ${lastError}`);
}

function ensureProductionBuild(): void {
  const nextDir = path.join(ROOT, ".next");
  if (process.env.WHEEL_E2E_SKIP_BUILD === "1" && fs.existsSync(nextDir)) {
    console.log("wheel-e2e-isolated: using existing .next build");
    return;
  }

  console.log("wheel-e2e-isolated: running production build…");
  const build = spawnSync("npm", ["run", "build"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 900_000,
    shell: true,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://postgres:build@127.0.0.1:65534/wheel_e2e_build_stub",
      AUTH_SECRET: ISOLATED_AUTH_SECRET,
      AUTH_URL: "http://127.0.0.1:3000",
      SCHEDULE_VIEW_TOKEN: ISOLATED_VIEW_TOKEN,
      MAIL_PROVIDER: "disabled",
    },
  });
  if (build.status !== 0) {
    throw new Error("wheel-e2e-isolated: production build failed");
  }
}

function buildAppEnv(port: number, databaseUrl: string): NodeJS.ProcessEnv {
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: ISOLATED_AUTH_SECRET,
    AUTH_URL: baseUrl,
    SCHEDULE_VIEW_TOKEN: ISOLATED_VIEW_TOKEN,
    MAIL_PROVIDER: "disabled",
    PLAYWRIGHT_BASE_URL: baseUrl,
    WHEEL_E2E_ISOLATED: "1",
    WHEEL_E2E_CATALOG_SLUG: WHEEL_E2E_SLUGS.active,
    WHEEL_E2E_DRAFT_SLUG: WHEEL_E2E_SLUGS.draft,
    WHEEL_E2E_INVALID_SLUG: WHEEL_E2E_SLUGS.invalid,
  };
}

function playwrightEnvVars(appEnv: NodeJS.ProcessEnv): string[] {
  const keys = [
    "PLAYWRIGHT_BASE_URL",
    "WHEEL_E2E_ISOLATED",
    "WHEEL_E2E_CATALOG_SLUG",
    "WHEEL_E2E_DRAFT_SLUG",
    "WHEEL_E2E_INVALID_SLUG",
  ] as const;
  const args: string[] = [];
  for (const key of keys) {
    const value = appEnv[key];
    if (value) {
      args.push("-e", `${key}=${value}`);
    }
  }
  return args;
}

function runPlaywrightHost(appEnv: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["playwright", "test", "tests/wheel-fortune-public.spec.ts"],
      {
        cwd: ROOT,
        env: appEnv,
        shell: true,
        stdio: "inherit",
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function runPlaywrightDocker(appEnv: NodeJS.ProcessEnv): Promise<number> {
  const image =
    process.env.WHEEL_E2E_PLAYWRIGHT_IMAGE ??
    "mcr.microsoft.com/playwright:v1.61.1-noble";
  const mountPath =
    process.platform === "win32"
      ? ROOT.replace(/\\/g, "/")
      : ROOT;

  return new Promise((resolve) => {
    const args = [
      "run",
      "--rm",
      "--network",
      "host",
      "-v",
      `${mountPath}:/work`,
      "-w",
      "/work",
      ...playwrightEnvVars(appEnv),
      image,
      "npx",
      "playwright",
      "test",
      "tests/wheel-fortune-public.spec.ts",
    ];
    const child = spawn("docker", args, { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function stopChildProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.killed) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 10_000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const pg = await startEphemeralPostgres({
    namePrefix: "wheel-e2e-pg",
    databaseName: "wheel_e2e",
  });
  if (!pg) {
    console.error("wheel-e2e-isolated: FAIL — docker postgres unavailable");
    process.exit(1);
  }

  let nextProcess: ChildProcess | null = null;
  let exitCode = 1;

  console.log(
    `wheel-e2e-isolated: postgres ${pg.containerName} on port ${pg.port}`,
  );

  try {
    runPrismaMigrateDeploy(pg.databaseUrl);

    const prisma = new PrismaClient({
      datasources: { db: { url: pg.databaseUrl } },
    });
    const slugs = await seedWheelIsolatedE2eData(prisma);
    await prisma.$disconnect();
    console.log(
      `wheel-e2e-isolated: seeded catalogs ${slugs.active}, ${slugs.draft}, ${slugs.invalid}`,
    );

    ensureProductionBuild();

    const port = pickAppPort();
    const appEnv = buildAppEnv(port, pg.databaseUrl);
    const baseUrl = appEnv.PLAYWRIGHT_BASE_URL!;

    console.log(`wheel-e2e-isolated: starting Next.js on ${baseUrl}`);
    nextProcess = spawn("npx", ["next", "start", "-p", String(port)], {
      cwd: ROOT,
      env: appEnv,
      shell: true,
      stdio: "inherit",
    });

    await waitForHttpReady(baseUrl);

    console.log("wheel-e2e-isolated: running Playwright wheel E2E…");
    exitCode =
      process.env.WHEEL_E2E_PLAYWRIGHT_DOCKER === "1"
        ? await runPlaywrightDocker(appEnv)
        : await runPlaywrightHost(appEnv);
  } catch (error) {
    console.error(
      "wheel-e2e-isolated: error",
      error instanceof Error ? error.message : error,
    );
    exitCode = 1;
  } finally {
    console.log("wheel-e2e-isolated: stopping Next.js…");
    await stopChildProcess(nextProcess);
    console.log(`wheel-e2e-isolated: removing postgres ${pg.containerName}…`);
    await pg.cleanup();
  }

  if (exitCode === 0) {
    console.log("wheel-e2e-isolated: PASS");
    console.log("wheel-fortune-public-e2e: PASS");
  } else {
    console.error(`wheel-e2e-isolated: FAIL (playwright exit ${exitCode})`);
  }

  process.exit(exitCode);
}

void main();
