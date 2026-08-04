/**
 * CURSOR-15 Stage 4E — BOT_INTERNAL_API_TOKEN runtime Compose wiring.
 *
 * Proves staging/production app services map the optional token at runtime only,
 * without committed values, env_file, build args, postgres/migrator leak, or
 * WHEEL_E2E_ISOLATED runtime mapping.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TOKEN_KEY = "BOT_INTERNAL_API_TOKEN";
const TOKEN_MAPPING_LINE =
  /^\s*BOT_INTERNAL_API_TOKEN:\s*\$\{BOT_INTERNAL_API_TOKEN:-\}\s*$/m;

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Top-level compose service block (two-space indent under `services:`). */
function serviceBlock(compose: string, name: string): string {
  const match = compose.match(
    new RegExp(`^ {2}${name}:[\\s\\S]*?(?=^ {2}[a-z]|^networks:|^volumes:)`, "m"),
  );
  assert.ok(match, `service ${name} must exist in compose`);
  return match[0]!;
}

/** `environment:` mapping block inside a service (four-space indent keys). */
function environmentBlock(service: string): string {
  const start = service.search(/^\s{4}environment:\s*$/m);
  assert.ok(start >= 0, "environment: block must exist on service");
  const lines = service.slice(start).split(/\r?\n/);
  const out: string[] = [lines[0]!];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    // Allow blank lines inside environment; stop at next non-nested key.
    if (line.trim() === "" || /^\s{6}/.test(line)) {
      out.push(line);
      continue;
    }
    break;
  }
  return `${out.join("\n")}\n`;
}

function countActiveKeyLines(block: string, key: string): number {
  const re = new RegExp(`^\\s*${key}:`, "gm");
  return (block.match(re) ?? []).length;
}

function assertAppTokenMapping(composePath: string): void {
  const compose = read(composePath);
  const app = serviceBlock(compose, "app");
  const appEnv = environmentBlock(app);
  const postgres = serviceBlock(compose, "postgres");
  const migrator = serviceBlock(compose, "migrator");

  assert.match(
    appEnv,
    TOKEN_MAPPING_LINE,
    `${composePath}: app environment must map ${TOKEN_KEY}: \${${TOKEN_KEY}:-}`,
  );
  assert.equal(
    countActiveKeyLines(appEnv, TOKEN_KEY),
    1,
    `${composePath}: app environment must declare ${TOKEN_KEY} exactly once`,
  );

  assert.doesNotMatch(
    environmentBlock(postgres),
    new RegExp(`^\\s*${TOKEN_KEY}:`, "m"),
    `${composePath}: postgres must not receive ${TOKEN_KEY}`,
  );
  assert.doesNotMatch(
    environmentBlock(migrator),
    new RegExp(`^\\s*${TOKEN_KEY}:`, "m"),
    `${composePath}: migrator must not receive ${TOKEN_KEY}`,
  );

  // No committed literal value (only ${...} interpolation).
  assert.doesNotMatch(
    compose,
    new RegExp(`^\\s*${TOKEN_KEY}:\\s*[^$\\s#]`, "m"),
    `${composePath}: ${TOKEN_KEY} must not have a committed literal value`,
  );

  // No env_file expansion on app (allowlist contract).
  assert.doesNotMatch(
    app,
    /^\s*env_file:/m,
    `${composePath}: app must not use env_file`,
  );

  // build.args must not carry the token.
  const buildBlock =
    app.match(/^\s{4}build:[\s\S]*?(?=^\s{4}[a-z]|^ {2}[a-z]|^networks:|^volumes:)/m)?.[0] ??
    "";
  assert.doesNotMatch(
    buildBlock,
    new RegExp(TOKEN_KEY),
    `${composePath}: build/args must not reference ${TOKEN_KEY}`,
  );

  assert.doesNotMatch(
    compose,
    /^\s*WHEEL_E2E_ISOLATED:/m,
    `${composePath}: WHEEL_E2E_ISOLATED must not be mapped in runtime compose`,
  );
  assert.doesNotMatch(
    compose,
    /NEXT_PUBLIC_BOT_INTERNAL_API_TOKEN/,
    `${composePath}: must not expose NEXT_PUBLIC_BOT_INTERNAL_API_TOKEN`,
  );
}

function assertEnvExample(rel: string): void {
  const text = read(rel);
  const active = text
    .split(/\r?\n/)
    .filter((line) => /^\s*BOT_INTERNAL_API_TOKEN=/.test(line));
  assert.equal(
    active.length,
    1,
    `${rel}: exactly one active BOT_INTERNAL_API_TOKEN= line`,
  );
  const line = active[0]!.trim();
  assert.equal(
    line,
    "BOT_INTERNAL_API_TOKEN=",
    `${rel}: key must be present with empty value (no committed secret)`,
  );
  const afterEq = line.slice("BOT_INTERNAL_API_TOKEN=".length);
  assert.equal(afterEq.length, 0, `${rel}: no value after =`);
  assert.doesNotMatch(
    text,
    /NEXT_PUBLIC_BOT_INTERNAL_API_TOKEN/,
    `${rel}: must not define NEXT_PUBLIC_BOT_INTERNAL_API_TOKEN`,
  );
}

function assertDockerfileClean(): void {
  const dockerfile = read("Dockerfile");
  assert.doesNotMatch(
    dockerfile,
    /BOT_INTERNAL_API_TOKEN/,
    "Dockerfile must not reference BOT_INTERNAL_API_TOKEN",
  );
}

function assertEnvContractOptional(): void {
  const envTs = read("src/lib/env.ts");
  assert.match(
    envTs,
    /BOT_INTERNAL_API_TOKEN\?:\s*string/,
    "src/lib/env.ts must keep BOT_INTERNAL_API_TOKEN optional",
  );

  const auth = read("src/lib/auth/bot-internal-auth.ts");
  assert.match(auth, /import\s+"server-only"/, "auth helper must be server-only");
  assert.match(
    auth,
    /BOT_INTERNAL_API_TOKEN_MIN_LENGTH\s*=\s*32/,
    "auth helper must enforce min length 32",
  );
}

/**
 * Fail-closed spoof cases: comments / wrong service / build args / docs text
 * must not satisfy TOKEN_MAPPING_LINE against a real app block extractor.
 */
function assertSpoofResistance(): void {
  const commentOnly = `
services:
  app:
    environment:
      # BOT_INTERNAL_API_TOKEN: \${BOT_INTERNAL_API_TOKEN:-}
      AUTH_SECRET: \${AUTH_SECRET}
  postgres:
    environment:
      POSTGRES_DB: \${POSTGRES_DB}
  migrator:
    environment:
      DATABASE_URL: postgresql://x
networks:
  x:
`;
  const wrongService = `
services:
  app:
    environment:
      AUTH_SECRET: \${AUTH_SECRET}
  postgres:
    environment:
      BOT_INTERNAL_API_TOKEN: \${BOT_INTERNAL_API_TOKEN:-}
  migrator:
    environment:
      DATABASE_URL: postgresql://x
networks:
  x:
`;
  const buildArg = `
services:
  app:
    build:
      context: .
      args:
        BOT_INTERNAL_API_TOKEN: \${BOT_INTERNAL_API_TOKEN:-}
    environment:
      AUTH_SECRET: \${AUTH_SECRET}
  postgres:
    environment:
      POSTGRES_DB: db
  migrator:
    environment:
      DATABASE_URL: postgresql://x
networks:
  x:
`;
  const duplicate = `
services:
  app:
    environment:
      BOT_INTERNAL_API_TOKEN: \${BOT_INTERNAL_API_TOKEN:-}
      BOT_INTERNAL_API_TOKEN: \${BOT_INTERNAL_API_TOKEN:-}
  postgres:
    environment:
      POSTGRES_DB: db
  migrator:
    environment:
      DATABASE_URL: postgresql://x
networks:
  x:
`;

  const commentEnv = environmentBlock(serviceBlock(commentOnly, "app"));
  assert.doesNotMatch(
    commentEnv,
    TOKEN_MAPPING_LINE,
    "comment spoof must not match active mapping",
  );

  const wrongEnv = environmentBlock(serviceBlock(wrongService, "app"));
  assert.doesNotMatch(
    wrongEnv,
    TOKEN_MAPPING_LINE,
    "postgres mapping must not satisfy app environment contract",
  );

  const buildApp = serviceBlock(buildArg, "app");
  const buildEnv = environmentBlock(buildApp);
  assert.doesNotMatch(
    buildEnv,
    TOKEN_MAPPING_LINE,
    "build.args mapping must not satisfy runtime environment contract",
  );
  assert.match(
    buildApp,
    /args:[\s\S]*BOT_INTERNAL_API_TOKEN/,
    "build-arg fixture sanity",
  );

  const dupEnv = environmentBlock(serviceBlock(duplicate, "app"));
  assert.equal(
    countActiveKeyLines(dupEnv, TOKEN_KEY),
    2,
    "duplicate fixture sanity",
  );
  assert.notEqual(
    countActiveKeyLines(dupEnv, TOKEN_KEY),
    1,
    "duplicate/shadow keys must fail exact-once contract",
  );
}

function main(): void {
  assertAppTokenMapping("docker-compose.staging.yml");
  assertAppTokenMapping("docker-compose.production.yml");
  assertEnvExample(".env.example");
  assertEnvExample(".env.production.example");
  assertDockerfileClean();
  assertEnvContractOptional();
  assertSpoofResistance();
  console.log("security-bot-internal-compose-wiring-check: ok");
}

main();
