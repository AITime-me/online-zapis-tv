/**
 * Regression tests for health-monitor Telegram notify (dedupe / recovery / secrets).
 * Uses Node .mjs notifier in --dry-run-dir mode (no network).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const NOTIFIER = path.join(ROOT, "scripts/ops/internal-health-monitor-telegram.mjs");
const MONITOR = path.join(ROOT, "scripts/ops/internal-health-monitor.sh");
const FAKE_TOKEN = "0000000000:FAKE-TOKEN-FOR-TESTS-ONLY-NOT-REAL";

function resolveBash(): string {
  if (process.platform === "win32") {
    const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
    if (fs.existsSync(gitBash)) {
      return gitBash;
    }
  }
  return "bash";
}

function runNotifier(
  args: string[],
  stdinPayload: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [NOTIFIER, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    input: stdinPayload,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function writeConfig(dir: string, token = FAKE_TOKEN, chatId = "123456789"): string {
  const configPath = path.join(dir, "health-monitor.env");
  fs.writeFileSync(configPath, `TELEGRAM_BOT_TOKEN=${token}\nTELEGRAM_CHAT_ID=${chatId}\n`, "utf8");
  return configPath;
}

function payload(status: string, problems: Array<Record<string, string>>): string {
  return JSON.stringify({ overallStatus: status, problems });
}

function messagePath(dryDir: string): string {
  return path.join(dryDir, "last-message.txt");
}

function readMessage(dryDir: string): string {
  return fs.readFileSync(messagePath(dryDir), "utf8");
}

function messageExists(dryDir: string): boolean {
  return fs.existsSync(messagePath(dryDir));
}

function clearMessage(dryDir: string): void {
  const p = messagePath(dryDir);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
  }
}

function assertNoSecretLeak(text: string): void {
  assert.doesNotMatch(text, /FAKE-TOKEN/);
  assert.doesNotMatch(text, /0000000000:/);
  assert.doesNotMatch(text, /TELEGRAM_BOT_TOKEN=/);
}

function main(): void {
  assert.ok(fs.existsSync(NOTIFIER), "notifier script missing");
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ihm-tg-"));

  try {
    const config = writeConfig(tmpRoot);
    const statePath = path.join(tmpRoot, "telegram-notify-state.json");
    const dryDir = path.join(tmpRoot, "dry");
    fs.mkdirSync(dryDir);

    const warningPayload = payload("warning", [
      {
        id: "disk /",
        status: "warning",
        code: "DISK_USAGE_WARNING",
        detail: "usedPercent=78",
      },
    ]);
    const warningChangedPayload = payload("warning", [
      {
        id: "disk /",
        status: "warning",
        code: "DISK_USAGE_WARNING",
        detail: "usedPercent=78",
      },
      {
        id: "staging backup age",
        status: "critical",
        code: "BACKUP_STALE",
        detail: "name=x.dump ageHours=40",
      },
    ]);
    const criticalPayload = payload("critical", [
      {
        id: "docker production app",
        status: "critical",
        code: "DOCKER_MISSING",
      },
    ]);
    const healthyPayload = payload("healthy", []);

    let res = runNotifier(
      ["--config", config, "--state", statePath, "--dry-run-dir", dryDir],
      warningPayload,
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /alert notification sent/);
    assert.ok(messageExists(dryDir));
    let msg = readMessage(dryDir);
    assert.match(msg, /WARNING/);
    assert.match(msg, /диск заполнен на 78%/);
    assertNoSecretLeak(msg + res.stdout + res.stderr);
    const firstState = fs.readFileSync(statePath, "utf8");
    assert.match(firstState, /lastFingerprint/);
    assert.doesNotMatch(firstState, /FAKE-TOKEN/);

    clearMessage(dryDir);
    res = runNotifier(
      ["--config", config, "--state", statePath, "--dry-run-dir", dryDir],
      warningPayload,
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /duplicate fingerprint/);
    assert.equal(messageExists(dryDir), false);

    res = runNotifier(
      ["--config", config, "--state", statePath, "--dry-run-dir", dryDir],
      warningChangedPayload,
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /alert notification sent/);
    assert.ok(messageExists(dryDir));
    msg = readMessage(dryDir);
    assert.match(msg, /резервная копия staging устарела/);
    assertNoSecretLeak(msg + res.stdout + res.stderr);

    clearMessage(dryDir);
    res = runNotifier(
      ["--config", config, "--state", statePath, "--dry-run-dir", dryDir],
      criticalPayload,
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /alert notification sent/);
    msg = readMessage(dryDir);
    assert.match(msg, /CRITICAL|🔴/);
    assertNoSecretLeak(msg);

    clearMessage(dryDir);
    res = runNotifier(
      ["--config", config, "--state", statePath, "--dry-run-dir", dryDir],
      criticalPayload,
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /duplicate fingerprint/);
    assert.equal(messageExists(dryDir), false);

    res = runNotifier(
      ["--config", config, "--state", statePath, "--dry-run-dir", dryDir],
      healthyPayload,
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /recovery notification sent/);
    msg = readMessage(dryDir);
    assert.match(msg, /восстановлена/);
    assertNoSecretLeak(msg);
    const recoveredState = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      lastFingerprint: string;
      lastStatus: string;
    };
    assert.equal(recoveredState.lastStatus, "healthy");
    assert.equal(recoveredState.lastFingerprint, "");

    clearMessage(dryDir);
    res = runNotifier(
      ["--config", config, "--state", statePath, "--dry-run-dir", dryDir],
      healthyPayload,
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /healthy, no notification/);
    assert.equal(messageExists(dryDir), false);

    res = runNotifier(
      [
        "--config",
        path.join(tmpRoot, "missing.env"),
        "--state",
        statePath,
        "--dry-run-dir",
        dryDir,
      ],
      warningPayload,
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /disabled/);
    assertNoSecretLeak(res.stdout + res.stderr);

    const bash = resolveBash();
    const monitorState = path.join(tmpRoot, "monitor-state");
    fs.mkdirSync(monitorState);
    const dryMonitor = path.join(tmpRoot, "monitor-dry");
    fs.mkdirSync(dryMonitor);
    const missingConfig = path.join(tmpRoot, "no-tg.env");
    const warningRun = spawnSync(
      bash,
      [MONITOR, "--fixture", "warning", "--state-dir", monitorState],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          IHM_TELEGRAM_CONFIG: missingConfig,
          IHM_TELEGRAM_DRY_RUN_DIR: dryMonitor,
        },
      },
    );
    assert.equal(warningRun.status, 10, warningRun.stdout + warningRun.stderr);
    assert.match(warningRun.stderr, /telegram: disabled|config file missing/);
    assertNoSecretLeak(warningRun.stdout + warningRun.stderr);

    const criticalState = path.join(tmpRoot, "crit-state");
    fs.mkdirSync(criticalState);
    const criticalDry = path.join(tmpRoot, "crit-dry");
    fs.mkdirSync(criticalDry);
    const criticalRun = spawnSync(
      bash,
      [MONITOR, "--fixture", "critical", "--state-dir", criticalState],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          IHM_TELEGRAM_CONFIG: config,
          IHM_TELEGRAM_DRY_RUN_DIR: criticalDry,
        },
      },
    );
    assert.equal(criticalRun.status, 20, criticalRun.stdout + criticalRun.stderr);
    assert.ok(fs.existsSync(path.join(criticalDry, "last-message.txt")));
    assertNoSecretLeak(
      criticalRun.stdout +
        criticalRun.stderr +
        fs.readFileSync(path.join(criticalDry, "last-message.txt"), "utf8"),
    );

    const badStateDir = path.join(tmpRoot, "bad-state-as-file");
    fs.writeFileSync(badStateDir, "not-a-dir");
    res = runNotifier(
      ["--config", config, "--state", path.join(badStateDir, "x.json"), "--dry-run-dir", dryDir],
      warningPayload,
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /notify failed|disabled|alert|duplicate|healthy|sent|skip/i);
    assertNoSecretLeak(res.stdout + res.stderr);

    clearMessage(dryDir);
    res = runNotifier(
      ["--config", config, "--state", statePath, "--dry-run-dir", dryDir, "--test-send"],
      "",
    );
    assert.equal(res.status, 0, res.stderr);
    msg = readMessage(dryDir);
    assert.match(msg, /тестовое сообщение/);
    assertNoSecretLeak(msg + res.stdout + res.stderr);

    const stateAfter = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, unknown>;
    assert.equal(stateAfter.schemaVersion, 1);

    const evilConfig = path.join(tmpRoot, "evil.env");
    fs.writeFileSync(
      evilConfig,
      "TELEGRAM_BOT_TOKEN=safe-token\nTELEGRAM_CHAT_ID=$(evil)\n",
      "utf8",
    );
    clearMessage(dryDir);
    const evilState = path.join(tmpRoot, "evil-state.json");
    res = runNotifier(
      ["--config", evilConfig, "--state", evilState, "--dry-run-dir", dryDir],
      warningPayload,
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /alert notification sent|disabled|invalid/);
    assertNoSecretLeak(res.stdout + res.stderr);
    assert.doesNotMatch(res.stdout + res.stderr, /\$\(evil\)/);

    console.log("internal-health-monitor-telegram-check: OK");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main();
