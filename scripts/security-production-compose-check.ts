/**
 * Статический аудит production Docker Compose — изоляция от staging.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const COMPOSE_FILE = "docker-compose.production.yml";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function testProductionComposeStructure(): void {
  const compose = read(COMPOSE_FILE);

  assert.match(compose, /name:\s*tvoe-vremya-production/);
  assert.match(compose, /container_name:\s*tvoe-vremya-production-postgres/);
  assert.match(compose, /container_name:\s*tvoe-vremya-production-app/);
  assert.match(compose, /postgres_production_data:/);
  assert.match(compose, /emergency_exports_production:/);
  assert.match(compose, /production_internal:/);
  assert.match(compose, /image:\s*online-zapis-tv-production-app:current/);
  assert.match(compose, /APP_ENV:\s*production/);
  assert.match(compose, /127\.0\.0\.1:\$\{APP_PORT:-3100\}:3000/);
  assert.match(compose, /profiles:\s*\n\s*- ops/);
  assert.match(compose, /target:\s*migrator/);
  assert.match(compose, /\/api\/health/);
}

function testNoStagingLeakage(): void {
  const compose = read(COMPOSE_FILE);

  assert.doesNotMatch(compose, /tvoe-vremya-staging/);
  assert.doesNotMatch(compose, /staging_internal/);
  assert.doesNotMatch(compose, /postgres_staging_data/);
  assert.doesNotMatch(compose, /\bemergency_exports:\b/);
  assert.doesNotMatch(compose, /APP_PORT:-3000/);
  assert.doesNotMatch(compose, /\.env\.staging/);
  assert.doesNotMatch(compose, /db:seed|owner:create|seed\.production/i);
}

function testPostgresNotPublished(): void {
  const compose = read(COMPOSE_FILE);
  const postgresBlock = compose.match(/postgres:[\s\S]*?(?=\n  app:)/)?.[0] ?? "";

  assert.doesNotMatch(postgresBlock, /ports:/);
}

function testEnvProductionExample(): void {
  const example = read(".env.production.example");
  const gitignore = read(".gitignore");

  assert.match(example, /APP_ENV=production/);
  assert.match(example, /APP_PORT=3100/);
  assert.match(example, /docker-compose\.production\.yml/);
  assert.match(example, /\.env\.production/);
  assert.match(example, /AUTH_URL=https:\/\/your-domain\.example/);
  assert.match(example, /generate-with-openssl-rand-base64-32-or-longer/);
  assert.match(example, /POSTGRES_PASSWORD=change-me-strong-password/);
  assert.doesNotMatch(example, /^POSTGRES_PASSWORD=password123/m);
  assert.match(gitignore, /^\.env\.production$/m);
}

function testRunbookDocumentsIsolation(): void {
  const runbook = read("docs/operations/production-compose.md");

  assert.match(runbook, /изолирован/i);
  assert.match(runbook, /127\.0\.0\.1:3100/);
  assert.match(runbook, /reverse proxy/i);
  assert.match(runbook, /не является разрешением/i);
  assert.match(runbook, /отдельные этапы/);
  assert.match(runbook, /автоматическ.*seed/i);
}

function testDockerComposeConfig(): void {
  const docker = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env.production.example",
      "-f",
      COMPOSE_FILE,
      "config",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );

  if (docker.error?.code === "ENOENT") {
    console.log("docker compose config: SKIP (Docker недоступен)");
    return;
  }

  assert.equal(
    docker.status,
    0,
    `docker compose config failed:\n${docker.stderr || docker.stdout}`,
  );

  const rendered = docker.stdout;
  assert.match(rendered, /tvoe-vremya-production-app/);
  assert.match(rendered, /tvoe-vremya-production-postgres/);
  assert.doesNotMatch(rendered, /tvoe-vremya-staging/);
  assert.match(rendered, /host_ip:\s*127\.0\.0\.1/);
  assert.match(rendered, /published:\s*"3100"/);
  assert.match(rendered, /target:\s*3000/);
}

function main(): void {
  testProductionComposeStructure();
  testNoStagingLeakage();
  testPostgresNotPublished();
  testEnvProductionExample();
  testRunbookDocumentsIsolation();
  testDockerComposeConfig();
  console.log("security-production-compose-check: OK");
}

main();
