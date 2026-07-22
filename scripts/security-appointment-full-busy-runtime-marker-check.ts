/** Runtime and deploy-flow checks for the full-busy writes feature marker. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const RUNTIME_MARKER = path.join(
  ROOT,
  "src/lib/schedule/appointment-full-busy-writes-runtime.mjs",
);

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function resolveBashExecutable(): string {
  if (process.platform === "win32") {
    const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
    if (fs.existsSync(gitBash)) {
      return gitBash;
    }
  }
  return "bash";
}

function runRuntimeMarker(
  value: string | undefined,
): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env };
  if (value === undefined) {
    delete env.APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED;
  } else {
    env.APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED = value;
  }
  const result = spawnSync(process.execPath, [RUNTIME_MARKER], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function testRuntimeExecutable(): void {
  const enabled = runRuntimeMarker("true");
  assert.equal(enabled.status, 0, enabled.stderr);
  assert.equal(enabled.stdout, "FULL_BUSY_WRITES_ON");

  for (const value of [undefined, "", "false", "TRUE", "1"]) {
    const disabled = runRuntimeMarker(value);
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.equal(disabled.stdout, "FULL_BUSY_WRITES_OFF");
  }
}

type VerifyRun = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function runShellVerification(options: {
  common: string;
  envValue?: string;
  containerMarker: string;
  dockerStatus?: number;
}): VerifyRun {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "full-busy-marker-"));
  try {
    const envFile = path.join(tempDir, "runtime.env");
    fs.writeFileSync(
      envFile,
      options.envValue === undefined
        ? "# flag intentionally absent\n"
        : `APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED=${options.envValue}\n`,
    );
    const commonPath = path.join(ROOT, options.common).replace(/\\/g, "/");
    const script = `
      set -Eeuo pipefail
      source ${JSON.stringify(commonPath)}
      MOCK_MARKER=${JSON.stringify(options.containerMarker)}
      MOCK_DOCKER_STATUS=${options.dockerStatus ?? 0}
      docker() {
        if [[ "$1" != "exec" ]]; then
          return 99
        fi
        if [[ "$MOCK_DOCKER_STATUS" -ne 0 ]]; then
          return "$MOCK_DOCKER_STATUS"
        fi
        printf '%s' "$MOCK_MARKER"
      }
      ops_verify_full_busy_writes_runtime_marker \
        app-container \
        ${JSON.stringify(envFile.replace(/\\/g, "/"))}
    `;
    const result = spawnSync(resolveBashExecutable(), ["-c", script], {
      cwd: ROOT,
      encoding: "utf8",
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function testOpsRuntimeVerification(common: string): void {
  const on = runShellVerification({
    common,
    envValue: "true",
    containerMarker: "FULL_BUSY_WRITES_ON",
  });
  assert.equal(on.status, 0, on.stderr);
  assert.equal(on.stdout.trim(), "FULL_BUSY_WRITES_ON");

  const off = runShellVerification({
    common,
    containerMarker: "FULL_BUSY_WRITES_OFF",
  });
  assert.equal(off.status, 0, off.stderr);
  assert.equal(off.stdout.trim(), "FULL_BUSY_WRITES_OFF");

  for (const invalid of [
    runShellVerification({
      common,
      envValue: "true",
      containerMarker: "FULL_BUSY_WRITES_OFF",
    }),
    runShellVerification({
      common,
      envValue: "false",
      containerMarker: "unexpected output",
    }),
    runShellVerification({
      common,
      envValue: "false",
      containerMarker: "",
      dockerStatus: 1,
    }),
  ]) {
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.stdout, "");
    assert.doesNotMatch(
      invalid.stderr,
      /APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED|unexpected output/,
    );
  }
}

function testStaticWiring(): void {
  const composePattern =
    /APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED:\s*\$\{APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED:-false\}/;
  assert.match(read("docker-compose.staging.yml"), composePattern);
  assert.match(read("docker-compose.production.yml"), composePattern);

  const dockerfile = read("Dockerfile");
  assert.match(
    dockerfile,
    /appointment-full-busy-writes-runtime\.mjs\s+\.\/scripts\/ops\/full-busy-writes-runtime-marker\.mjs/,
  );

  for (const deploy of [
    "scripts/ops/staging-deploy.sh",
    "scripts/ops/production-deploy.sh",
  ]) {
    const source = read(deploy);
    const healthStart = source.indexOf("verify_health() {");
    const healthEnd = source.indexOf("\n}", healthStart);
    const health = source.slice(healthStart, healthEnd + 2);
    assert.match(health, /ops_verify_full_busy_writes_runtime_marker/);
    assert.ok(
      health.indexOf("ops_check_http_health") <
        health.indexOf("ops_verify_full_busy_writes_runtime_marker"),
      `${deploy}: runtime marker must be part of post-health verification`,
    );
  }

  for (const common of [
    "scripts/ops/lib/staging-ops-common.sh",
    "scripts/ops/lib/production-ops-common.sh",
  ]) {
    const source = read(common);
    assert.match(
      source,
      /docker exec "\$app_container"[\s\S]{0,150}full-busy-writes-runtime-marker\.mjs/,
    );
    assert.match(
      source,
      /FULL_BUSY_WRITES_ON\|FULL_BUSY_WRITES_OFF/,
    );
  }
}

testRuntimeExecutable();
for (const common of [
  "scripts/ops/lib/staging-ops-common.sh",
  "scripts/ops/lib/production-ops-common.sh",
]) {
  testOpsRuntimeVerification(common);
}
testStaticWiring();

console.log("security-appointment-full-busy-runtime-marker-check: OK");
