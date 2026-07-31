/**
 * Статический аудит: PROBLEM_REPORT_TELEGRAM_* пробрасываются в app-контейнер
 * staging/production Compose с безопасными optional defaults (`:-`).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TOKEN_LINE =
  /^\s*PROBLEM_REPORT_TELEGRAM_BOT_TOKEN:\s*\$\{PROBLEM_REPORT_TELEGRAM_BOT_TOKEN:-\}\s*$/m;
const CHAT_LINE =
  /^\s*PROBLEM_REPORT_TELEGRAM_CHAT_ID:\s*\$\{PROBLEM_REPORT_TELEGRAM_CHAT_ID:-\}\s*$/m;

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function serviceBlock(compose: string, name: string): string {
  const match = compose.match(
    new RegExp(`^ {2}${name}:[\\s\\S]*?(?=^ {2}[a-z]|^networks:|^volumes:)`, "m"),
  );
  assert.ok(match, `service ${name} найден в compose`);
  return match[0]!;
}

function assertAppPassesTelegramEnv(composePath: string): void {
  const compose = read(composePath);
  const app = serviceBlock(compose, "app");
  const postgres = serviceBlock(compose, "postgres");
  const migrator = serviceBlock(compose, "migrator");

  assert.match(
    app,
    TOKEN_LINE,
    `${composePath}: app передаёт PROBLEM_REPORT_TELEGRAM_BOT_TOKEN с optional default :-`,
  );
  assert.match(
    app,
    CHAT_LINE,
    `${composePath}: app передаёт PROBLEM_REPORT_TELEGRAM_CHAT_ID с optional default :-`,
  );

  assert.equal(
    (app.match(/^\s*PROBLEM_REPORT_TELEGRAM_BOT_TOKEN:/gm) ?? []).length,
    1,
    `${composePath}: ровно одна строка BOT_TOKEN в app`,
  );
  assert.equal(
    (app.match(/^\s*PROBLEM_REPORT_TELEGRAM_CHAT_ID:/gm) ?? []).length,
    1,
    `${composePath}: ровно одна строка CHAT_ID в app`,
  );

  assert.doesNotMatch(
    postgres,
    /PROBLEM_REPORT_TELEGRAM_/,
    `${composePath}: postgres не получает PROBLEM_REPORT_TELEGRAM_*`,
  );
  assert.doesNotMatch(
    migrator,
    /PROBLEM_REPORT_TELEGRAM_/,
    `${composePath}: migrator не получает PROBLEM_REPORT_TELEGRAM_*`,
  );

  // Секреты не захардкожены: только ${VAR:-}, без литеральных значений.
  assert.doesNotMatch(
    compose,
    /^\s*PROBLEM_REPORT_TELEGRAM_BOT_TOKEN:\s*["']?[0-9]+:/m,
    `${composePath}: не должно быть захардкоженного Telegram token`,
  );
  assert.doesNotMatch(
    compose,
    /^\s*PROBLEM_REPORT_TELEGRAM_(?:BOT_TOKEN|CHAT_ID):\s*["']?-?\d{5,}["']?\s*$/m,
    `${composePath}: не должно быть захардкоженного chat id / token`,
  );
  assert.doesNotMatch(
    compose,
    /^\s*PROBLEM_REPORT_TELEGRAM_(?:BOT_TOKEN|CHAT_ID):\s*[^$\s#]/m,
    `${composePath}: значение должно быть только через \${...}, без литерала`,
  );
}

function main(): void {
  assertAppPassesTelegramEnv("docker-compose.staging.yml");
  assertAppPassesTelegramEnv("docker-compose.production.yml");
  console.log("security-problem-report-compose-env-check: ok");
}

main();
