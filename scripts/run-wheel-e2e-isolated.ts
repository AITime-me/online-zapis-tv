import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  runPrismaMigrateDeploy,
  startEphemeralPostgres,
} from "./lib/ephemeral-postgres";
import {
  buildIsolatedBuildEnv,
  buildIsolatedPlaywrightEnv,
  buildIsolatedRuntimeEnv,
} from "./lib/wheel-isolated-env";
import {
  assertPlaywrightPassReport,
  assertPlaywrightPreflight,
  EXPECTED_PLAYWRIGHT_VERSION,
  EXPECTED_WHEEL_E2E_TEST_COUNT,
  prepareStandaloneRuntime,
  playwrightCliJs,
  projectRoot,
  WHEEL_E2E_SPEC_REL,
} from "./lib/wheel-isolated-runtime";
import {
  seedWheelIsolatedE2eData,
  WHEEL_E2E_SLUGS,
} from "./lib/wheel-isolated-seed";

const ROOT = projectRoot();

function pickAppPort(): number {
  return 38000 + (Date.now() % 2000);
}

/**
 * Strict readiness: successful /api/health, then promo page HTTP 200 with wheel marker.
 * 404 is never treated as ready.
 */
async function waitForHttpReady(baseUrl: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown";
  const promoPath = `/promo/${WHEEL_E2E_SLUGS.active}`;

  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${baseUrl}/api/health`);
      if (!health.ok) {
        lastError = `health status ${health.status}`;
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    try {
      const promo = await fetch(`${baseUrl}${promoPath}`);
      if (promo.status !== 200) {
        lastError = `promo status ${promo.status}`;
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      const html = await promo.text();
      if (!html.includes("wheel-fortune-public")) {
        lastError = "promo 200 but missing wheel-fortune-public marker in HTML";
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      return;
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
    env: buildIsolatedBuildEnv(),
  });
  if (build.status !== 0) {
    throw new Error("wheel-e2e-isolated: production build failed");
  }
}

function allocateReportPath(): string {
  const dir = path.join(ROOT, "test-results");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `wheel-e2e-isolated-${process.pid}.json`);
}

function playwrightNodeArgs(): string[] {
  return [playwrightCliJs(ROOT), "test", WHEEL_E2E_SPEC_REL];
}

/**
 * Always run Playwright in the current process/container via locked local CLI.
 * Nested Playwright Docker is intentionally unsupported (DinD mount traps).
 */
function runPlaywright(
  runtimeEnv: NodeJS.ProcessEnv,
  reportPath: string,
): Promise<number> {
  const playwrightEnv = {
    ...buildIsolatedPlaywrightEnv(runtimeEnv),
    WHEEL_E2E_JSON_REPORT: reportPath,
  };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, playwrightNodeArgs(), {
      cwd: ROOT,
      env: playwrightEnv,
      shell: false,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function stopChildProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 15_000);
    child.once("exit", () => {
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
  let seedPrisma: PrismaClient | null = null;
  let exitCode = 1;
  let reportPath: string | null = null;
  let verifiedPass = false;
  let playwrightFinished = false;

  console.log(
    `wheel-e2e-isolated: postgres ${pg.containerName} on port ${pg.port}`,
  );
  console.log(
    `wheel-e2e-isolated: Playwright ${EXPECTED_PLAYWRIGHT_VERSION} (locked local CLI in current container)`,
  );

  try {
    runPrismaMigrateDeploy(pg.databaseUrl);

    seedPrisma = new PrismaClient({
      datasources: { db: { url: pg.databaseUrl } },
    });
    const slugs = await seedWheelIsolatedE2eData(seedPrisma);
    console.log(
      `wheel-e2e-isolated: seeded catalogs ${slugs.active}, ${slugs.draft}, ${slugs.invalid}`,
    );
    // Disconnect after seed so the long build/Playwright window does not hold the client.
    // Finally still disconnects if seed failed mid-flight before this point.
    console.log("wheel-e2e-isolated: disconnecting seed Prisma after seed…");
    await seedPrisma.$disconnect();
    seedPrisma = null;

    ensureProductionBuild();
    const serverJs = prepareStandaloneRuntime(ROOT);
    console.log(`wheel-e2e-isolated: standalone server ${serverJs}`);

    const port = pickAppPort();
    const runtimeEnv = buildIsolatedRuntimeEnv(port, pg.databaseUrl);
    const baseUrl = runtimeEnv.PLAYWRIGHT_BASE_URL!;

    assertPlaywrightPreflight({
      baseUrl,
      requireStandalone: true,
    });

    console.log(`wheel-e2e-isolated: starting standalone Next.js on ${baseUrl}`);
    nextProcess = spawn(process.execPath, [serverJs], {
      cwd: path.dirname(serverJs),
      env: runtimeEnv,
      shell: false,
      stdio: "inherit",
    });

    let nextExitEarly: number | null = null;
    nextProcess.once("exit", (code) => {
      nextExitEarly = code ?? 1;
    });

    await waitForHttpReady(baseUrl);
    if (nextExitEarly !== null) {
      throw new Error(
        `wheel-e2e-isolated: standalone server exited early with code ${nextExitEarly}`,
      );
    }

    reportPath = allocateReportPath();

    console.log("wheel-e2e-isolated: running Playwright wheel E2E…");
    exitCode = await runPlaywright(runtimeEnv, reportPath);
    playwrightFinished = true;

    if (exitCode === 0) {
      assertPlaywrightPassReport(reportPath, EXPECTED_WHEEL_E2E_TEST_COUNT);
      verifiedPass = true;
    }
  } catch (error) {
    console.error(
      "wheel-e2e-isolated: error",
      error instanceof Error ? error.message : error,
    );
    exitCode = 1;
    verifiedPass = false;
  } finally {
    // Cleanup order:
    // 1) Playwright finished (or aborted)
    // 2) SIGTERM standalone Next.js and wait for exit
    // 3) Disconnect seed PrismaClient
    // 4) Remove ephemeral PostgreSQL only
    console.log(
      `wheel-e2e-isolated: cleanup — Playwright ${playwrightFinished ? "finished" : "not finished / aborted"}`,
    );

    console.log("wheel-e2e-isolated: cleanup — stopping standalone Next.js (SIGTERM)…");
    await stopChildProcess(nextProcess);
    nextProcess = null;
    console.log("wheel-e2e-isolated: cleanup — standalone Next.js stopped");

    if (seedPrisma) {
      console.log("wheel-e2e-isolated: cleanup — disconnecting seed Prisma…");
      try {
        await seedPrisma.$disconnect();
        console.log("wheel-e2e-isolated: cleanup — seed Prisma disconnected");
      } catch (error) {
        console.error(
          "wheel-e2e-isolated: cleanup — prisma disconnect error",
          error instanceof Error ? error.message : error,
        );
      }
      seedPrisma = null;
    } else {
      console.log("wheel-e2e-isolated: cleanup — seed Prisma already disconnected");
    }

    console.log(
      `wheel-e2e-isolated: cleanup — removing postgres ${pg.containerName}…`,
    );
    await pg.cleanup();
    console.log("wheel-e2e-isolated: cleanup — postgres removed");

    if (reportPath && fs.existsSync(reportPath)) {
      try {
        fs.unlinkSync(reportPath);
      } catch (error) {
        console.error(
          "wheel-e2e-isolated: cleanup — report unlink error",
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  if (verifiedPass && exitCode === 0) {
    console.log("wheel-e2e-isolated: PASS");
    console.log(
      `wheel-fortune-public-e2e: PASS (${EXPECTED_WHEEL_E2E_TEST_COUNT} tests)`,
    );
    process.exit(0);
  }

  console.error(
    `wheel-e2e-isolated: FAIL (playwright exit ${exitCode}${verifiedPass ? "" : ", report not verified"})`,
  );
  process.exit(exitCode === 0 ? 1 : exitCode);
}

void main();
