/**
 * Static security/regression audit for simple internal health monitor v1.
 * Does not talk to Docker, systemd, SMTP, staging, or production.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();

const SCRIPT = "scripts/ops/internal-health-monitor.sh";
const TELEGRAM_PY = "scripts/ops/internal-health-monitor-telegram.py";
const TELEGRAM_MJS_REMOVED = "scripts/ops/internal-health-monitor-telegram.mjs";
const SERVICE = "deploy/systemd/host/online-zapis-tv-internal-health-monitor.service";
const TIMER = "deploy/systemd/host/online-zapis-tv-internal-health-monitor.timer";
const LOGROTATE = "deploy/logrotate/online-zapis-tv-health-monitor";
const DOCS = "docs/operations/internal-health-monitor.md";
const N8N_TARGETS_EXAMPLE = "deploy/config/health-monitor-targets.env.example";

const REQUIRED_FILES = [
  SCRIPT,
  TELEGRAM_PY,
  SERVICE,
  TIMER,
  LOGROTATE,
  DOCS,
  N8N_TARGETS_EXAMPLE,
] as const;

const CONTAINERS = [
  "tvoe-vremya-production-app",
  "tvoe-vremya-production-postgres",
  "tvoe-vremya-staging-app",
  "tvoe-vremya-staging-postgres",
] as const;

const HEALTH_URLS = [
  "http://127.0.0.1:3000/api/health",
  "http://127.0.0.1:3100/api/health",
] as const;

const BACKUP_TIMERS = [
  "online-zapis-tv-production-backup.timer",
  "online-zapis-tv-staging-backup.timer",
] as const;

const BACKUP_DIRS = [
  "/opt/online-zapis-tv-production/backups/production/postgres",
  "/opt/online-zapis-tv/backups/postgres",
] as const;

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function stripBashComments(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let inHeredoc = false;
  let heredocMarker = "";

  for (const line of lines) {
    if (inHeredoc) {
      out.push(line);
      if (line.trim() === heredocMarker) {
        inHeredoc = false;
      }
      continue;
    }
    const heredocMatch = line.match(/<<-?\s*['"]?(\w+)['"]?/);
    if (heredocMatch) {
      inHeredoc = true;
      heredocMarker = heredocMatch[1] ?? "";
      out.push(line);
      continue;
    }
    if (/^\s*#/.test(line)) {
      continue;
    }
    out.push(line.replace(/(^|[^\\])#.*$/, "$1"));
  }
  return out.join("\n");
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

function runBash(args: string[], env?: NodeJS.ProcessEnv): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const bash = resolveBashExecutable();
  const result = spawnSync(bash, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function assertRequiredFiles(): void {
  for (const rel of REQUIRED_FILES) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing ${rel}`);
  }
  assert.ok(
    !fs.existsSync(path.join(ROOT, TELEGRAM_MJS_REMOVED)),
    `${TELEGRAM_MJS_REMOVED} must be removed (Python-only notifier)`,
  );
}

function assertScriptSafety(): void {
  const source = readFile(SCRIPT);
  const executable = stripBashComments(source);

  assert.match(source, /^set -Eeuo pipefail/m);
  assert.match(executable, /IHM_DISK_WARN_PERCENT=75/);
  assert.match(executable, /IHM_DISK_CRIT_PERCENT=90/);
  assert.match(executable, /IHM_INODE_WARN_PERCENT=80/);
  assert.match(executable, /IHM_INODE_CRIT_PERCENT=95/);
  assert.match(executable, /IHM_BACKUP_MAX_AGE_HOURS=30/);
  assert.match(executable, /isolated-restore-test-policy\.sh/);
  assert.match(executable, /IRT_SUCCESS_MAX_AGE_HOURS/);
  assert.match(executable, /IRT_DUMP_LAG_MAX_HOURS/);
  assert.match(executable, /check_restore_test_evidence/);
  assert.match(executable, /not_enforced/);
  assert.match(executable, /control not enabled/);
  assert.match(executable, /ihm_validate_referenced_dump/);
  assert.doesNotMatch(executable, /enforce=off lastSuccess/);
  assert.doesNotMatch(executable, /IHM_RESTORE_TEST_MAX_AGE_HOURS\s*=\s*\d+/);

  for (const name of CONTAINERS) {
    assert.match(executable, new RegExp(name.replace(/\./g, "\\.")));
  }
  for (const url of HEALTH_URLS) {
    assert.match(executable, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const timer of BACKUP_TIMERS) {
    assert.match(executable, new RegExp(timer.replace(/\./g, "\\.")));
  }
  for (const dir of BACKUP_DIRS) {
    assert.match(executable, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(executable, /systemctl --failed/);
  assert.match(executable, /df -P/);
  assert.match(executable, /df -Pi/);
  assert.match(executable, /pg_restore -l/);
  assert.match(executable, /--network none/);
  assert.match(executable, /--pull=never/);
  assert.match(executable, /--read-only/);
  assert.match(executable, /:ro/);
  assert.match(executable, /flock -n/);
  assert.match(executable, /journal\.jsonl/);
  assert.match(executable, /internal-health-monitor-telegram\.py/);
  assert.match(executable, /maybe_notify_telegram/);
  assert.match(executable, /ihm_python3_bin/);
  assert.match(executable, /IHM_TELEGRAM_CONFIG/);
  assert.match(executable, /check_n8n_external_health/);
  assert.match(executable, /IHM_N8N_TARGETS_DEFAULT/);
  assert.match(executable, /n8n-external-probe-state\.json/);
  assert.match(executable, /IHM_N8N_FAILURE_THRESHOLD_DEFAULT=2/);
  assert.match(executable, /N8N_LIVENESS_UNHEALTHY/);
  assert.match(executable, /N8N_READINESS_UNHEALTHY/);
  assert.match(executable, /N8N_CONFIG_INVALID/);
  assert.match(executable, /--proto '=https'/);
  assert.match(executable, /IHM_N8N_PROBE_MOCK/);
  assert.match(executable, /IHM_ONLY_N8N_EXTERNAL" -eq 1/);
  assert.match(executable, /probe mock ignored \(live path\)/);
  assert.match(executable, /curl bin override ignored \(live path\)/);
  assert.match(
    executable,
    /IHM_ONLY_N8N_EXTERNAL" -eq 1 && -n "\$\{IHM_N8N_CURL_BIN:-\}"/,
  );
  assert.match(
    executable,
    /IHM_ONLY_N8N_EXTERNAL" -eq 1 && "\$\{IHM_N8N_STATE_WRITE_FAIL:-\}" == "1"/,
  );
  assert.match(executable, /IHM_N8N_HARNESS_FORCE_LIVE_GATES/);
  assert.match(executable, /IHM_N8N_HARNESS_ENTRY=1/);
  assert.match(executable, /IHM_N8N_HARNESS_PATH_CURL/);
  assert.match(executable, /os\.fsync|os\.replace/);
  assert.match(executable, /acquire_lock_or_skip/);
  assert.match(executable, /ihm_n8n_validate_https_url "\$live_url" "\/healthz"/);
  assert.match(executable, /ihm_n8n_validate_https_url "\$ready_url" "\/healthz\/readiness"/);
  assert.doesNotMatch(executable, /aimytime\.app\.n8n\.cloud/);
  assert.doesNotMatch(executable, /tv_n8n/);
  assert.doesNotMatch(executable, /curl\s+-v\b/);
  assert.doesNotMatch(executable, /curl\s+--verbose\b/);
  assert.doesNotMatch(executable, /internal-health-monitor-telegram\.mjs/);
  assert.doesNotMatch(executable, /ihm_telegram_runner/);
  assert.doesNotMatch(executable, /source\s+[\"']?\$\{?IHM_TELEGRAM_CONFIG/);
  assert.doesNotMatch(executable, /TELEGRAM_BOT_TOKEN=/);

  assert.doesNotMatch(executable, /pg_restore\s+--clean/);
  assert.doesNotMatch(executable, /\bpsql\b/);
  assert.doesNotMatch(executable, /docker\s+restart/);
  assert.doesNotMatch(executable, /docker\s+system\s+prune/);
  assert.doesNotMatch(executable, /docker\s+image\s+prune/);
  assert.doesNotMatch(executable, /docker\s+cp\b/);
  assert.doesNotMatch(executable, /rm\s+-rf/);
  assert.doesNotMatch(executable, /systemctl\s+(restart|start|enable|disable)\b/);
  assert.doesNotMatch(executable, /SMTP/i);
  assert.doesNotMatch(executable, /sendmail/i);
  assert.doesNotMatch(executable, /nodemailer/i);
  assert.doesNotMatch(executable, /OPS_ALERT_EMAIL/);
  assert.doesNotMatch(executable, /printenv/);
  assert.doesNotMatch(executable, /env\s*\|/);
  assert.doesNotMatch(executable, /\.env\.production/);
  assert.doesNotMatch(executable, /\.env\.staging/);
  assert.doesNotMatch(executable, /AUTH_SECRET/);
  assert.doesNotMatch(executable, /DATABASE_URL/);
  assert.doesNotMatch(executable, /SCHEDULE_VIEW_TOKEN/);
  assert.doesNotMatch(executable, /SMTP_PASSWORD/);
}

function assertUnitsAndDocs(): void {
  const service = readFile(SERVICE);
  const timer = readFile(TIMER);
  const docs = readFile(DOCS);
  const logrotate = readFile(LOGROTATE);

  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, /^User=deploy$/m);
  assert.match(service, /^SuccessExitStatus=10 20$/m);
  assert.match(service, /^Restart=no$/m);
  assert.match(service, /internal-health-monitor\.sh/);
  assert.doesNotMatch(service, /^Environment=/m);
  assert.doesNotMatch(service, /AUTH_SECRET|DATABASE_URL|SMTP/i);

  assert.match(timer, /^OnCalendar=\*-\*-\* \*:0\/15:00 Asia\/Yekaterinburg$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^RandomizedDelaySec=120$/m);

  assert.match(logrotate, /journal\.jsonl/);
  assert.match(logrotate, /copytruncate/);

  assert.match(docs, /What it checks|Что проверяет/i);
  assert.match(docs, /never does|никогда не делает/i);
  assert.match(docs, /Copy files manually|скопировать файлы/i);
  assert.match(docs, /bash -n/);
  assert.match(docs, /Manual|ручн/i);
  assert.match(docs, /daemon-reload/);
  assert.match(docs, /enable --now/);
  assert.match(docs, /list-timers|Inspect timer|посмотреть timer/i);
  assert.match(docs, /systemctl start online-zapis-tv-internal-health-monitor\.service/);
  assert.match(docs, /journalctl/);
  assert.match(docs, /disable --now/);
  assert.match(docs, /Remove units|удалить units/i);
  assert.match(docs, /Confirm removal|удаление завершено/i);
  assert.match(docs, /Interpreting OK|интерпретировать OK/i);
  assert.match(docs, /What a human should do|Что делать человеку/i);
  assert.match(docs, /Telegram|telegram/);
  assert.match(docs, /health-monitor\.env/);
  assert.match(docs, /TELEGRAM_BOT_TOKEN/);
  assert.match(docs, /root:deploy/);
  assert.match(docs, /--test-send/);
  assert.match(docs, /internal-health-monitor-telegram\.py/);
  assert.match(docs, /python3/);
  assert.doesNotMatch(docs, /internal-health-monitor-telegram\.mjs/);
  assert.doesNotMatch(docs, /Node fallback|If only Node/i);
  assert.match(docs, /Independent n8n|n8n external HTTPS/i);
  assert.match(docs, /health-monitor-targets\.env/);
  assert.match(docs, /IHM_N8N_LIVENESS_URL/);
  assert.match(docs, /IHM_N8N_READINESS_URL/);
  assert.match(docs, /IHM_N8N_FAILURE_THRESHOLD/);
  assert.match(docs, /n8n-external-probe-state\.json/);
  assert.match(docs, /not its own only monitor|не.*единственн/i);
  assert.match(docs, /No response body|без тела ответа|No response body/i);
  assert.match(docs, /debounc|consecutive|порог/i);
  assert.match(docs, /exactly `\/healthz`|path is \*\*exactly\*\* `\/healthz`/i);
  assert.match(docs, /trailing slash|Trailing slash/i);
  assert.match(docs, /probe mock ignored|IHM_N8N_PROBE_MOCK/);
  assert.match(docs, /run\.lock|same.*flock|acquire/i);
  assert.doesNotMatch(docs, /```bash\s*\n```bash/);

  const targetsExample = readFile(N8N_TARGETS_EXAMPLE);
  assert.match(targetsExample, /IHM_N8N_TARGET_ID=/);
  assert.match(targetsExample, /IHM_N8N_LIVENESS_URL=https:\/\//);
  assert.match(targetsExample, /IHM_N8N_READINESS_URL=https:\/\//);
  assert.match(targetsExample, /IHM_N8N_FAILURE_THRESHOLD=2/);
  const targetsActive = targetsExample
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith("#");
    })
    .join("\n");
  assert.doesNotMatch(targetsActive, /TOKEN|PASSWORD|SECRET/i);
  assert.doesNotMatch(targetsActive, /https:\/\/[^/\s]+:[^/\s]+@/);
  assert.doesNotMatch(targetsActive, /\?|#/);

  const telegramPy = readFile(TELEGRAM_PY);
  assert.match(telegramPy, /urllib\.request/);
  assert.match(telegramPy, /api\.telegram\.org/);
  assert.match(telegramPy, /TELEGRAM_BOT_TOKEN/);
  assert.match(telegramPy, /TELEGRAM_CHAT_ID/);
  assert.match(telegramPy, /os\.replace/);
  assert.match(telegramPy, /N8N_LIVENESS_UNHEALTHY/);
  assert.match(telegramPy, /N8N_READINESS_UNHEALTHY/);
  assert.doesNotMatch(telegramPy, /\bsmtplib\b/i);
  assert.doesNotMatch(telegramPy, /nodemailer/i);
}

function assertBashSyntaxAndFixtures(): void {
  const syntax = runBash(["-n", SCRIPT]);
  assert.equal(syntax.status, 0, `bash -n failed: ${syntax.stderr}`);

  const help = runBash([SCRIPT, "--help"]);
  assert.equal(help.status, 0, ` --help failed: ${help.stderr}`);
  assert.match(help.stdout, /Exit codes/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ihm-sec-"));
  try {
    const healthy = runBash([SCRIPT, "--fixture", "healthy", "--state-dir", tmp]);
    assert.equal(healthy.status, 0, healthy.stdout + healthy.stderr);
    assert.match(healthy.stdout, /INTERNAL_HEALTH_MONITOR OK/);

    const warning = runBash([SCRIPT, "--fixture", "warning", "--state-dir", tmp]);
    assert.equal(warning.status, 10, warning.stdout + warning.stderr);
    assert.match(warning.stdout, /INTERNAL_HEALTH_MONITOR WARNING/);

    const critical = runBash([SCRIPT, "--fixture", "critical", "--state-dir", tmp]);
    assert.equal(critical.status, 20, critical.stdout + critical.stderr);
    assert.match(critical.stdout, /INTERNAL_HEALTH_MONITOR FAILED/);

    const technical = runBash([SCRIPT, "--fixture", "technical_error", "--state-dir", tmp]);
    assert.equal(technical.status, 30, technical.stdout + technical.stderr);
    assert.match(technical.stdout, /INTERNAL_HEALTH_MONITOR FAILED/);

    const journalPath = path.join(tmp, "journal.jsonl");
    assert.ok(fs.existsSync(journalPath), "fixture should append journal.jsonl");
    const lastLine = fs.readFileSync(journalPath, "utf8").trim().split(/\n/).at(-1) ?? "";
    const parsed = JSON.parse(lastLine) as {
      schemaVersion: number;
      overallStatus: string;
      problemCodes: string[];
      checks: unknown[];
      commits: { production: string; staging: string };
    };
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.overallStatus, "technical_error");
    assert.ok(Array.isArray(parsed.problemCodes));
    assert.ok(Array.isArray(parsed.checks));
    assert.ok(parsed.commits);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function assertPackageScript(): void {
  const pkg = JSON.parse(readFile("package.json")) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    pkg.scripts["test:security:internal-health-monitor"],
    "tsx scripts/security-internal-health-monitor-check.ts",
  );
  assert.equal(
    pkg.scripts["test:internal-health-monitor-telegram"],
    "tsx scripts/internal-health-monitor-telegram-check.ts",
  );
}

function toBashPath(winPath: string): string {
  if (process.platform !== "win32") {
    return winPath;
  }
  const normalized = path.resolve(winPath).replace(/\\/g, "/");
  return normalized.replace(/^([A-Za-z]):/, "/$1");
}

function writeN8nTargets(
  filePath: string,
  overrides: Record<string, string> = {},
): void {
  const base: Record<string, string> = {
    IHM_N8N_TARGET_ID: "n8n-test-dev",
    IHM_N8N_LIVENESS_URL: "https://n8n-test.example.invalid/healthz",
    IHM_N8N_READINESS_URL: "https://n8n-test.example.invalid/healthz/readiness",
    IHM_N8N_TIMEOUT_SEC: "10",
    IHM_N8N_FAILURE_THRESHOLD: "2",
    ...overrides,
  };
  const body = Object.entries(base)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  fs.writeFileSync(filePath, `${body}\n`, "utf8");
}

function runN8nOnly(
  stateDir: string,
  env: NodeJS.ProcessEnv,
): { status: number | null; stdout: string; stderr: string } {
  return runBash(
    [SCRIPT, "--only-n8n-external", "--state-dir", toBashPath(stateDir)],
    {
      ...env,
      IHM_N8N_TARGETS_FILE:
        env.IHM_N8N_TARGETS_FILE ??
        toBashPath(path.join(stateDir, "missing-targets.env")),
    },
  );
}

function assertNoLeak(text: string): void {
  assert.doesNotMatch(text, /password|passwd|secret|token=/i);
  assert.doesNotMatch(text, /user:pass@/);
  assert.doesNotMatch(text, /"ok"\s*:\s*true/);
  assert.doesNotMatch(text, /response body|BODY=/i);
  assert.doesNotMatch(text, /aimytime\.app\.n8n\.cloud/);
}

function assertN8nExternalProbe(): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ihm-n8n-"));
  const bash = resolveBashExecutable();
  try {
    // Missing config => disabled INFO, healthy, no regression.
    const missingState = path.join(tmp, "missing");
    fs.mkdirSync(missingState);
    const missing = runN8nOnly(missingState, {
      IHM_N8N_TARGETS_FILE: toBashPath(path.join(tmp, "no-such-targets.env")),
    });
    assert.equal(missing.status, 0, missing.stdout + missing.stderr);
    assert.match(missing.stdout, /INFO n8n external: disabled/);
    assert.match(missing.stdout, /INTERNAL_HEALTH_MONITOR OK/);
    assertNoLeak(missing.stdout + missing.stderr);

    // Empty file (no keys) => disabled.
    const emptyCfg = path.join(tmp, "empty-targets.env");
    fs.writeFileSync(emptyCfg, "# comment only\n", "utf8");
    const emptyState = path.join(tmp, "empty");
    fs.mkdirSync(emptyState);
    const empty = runN8nOnly(emptyState, {
      IHM_N8N_TARGETS_FILE: toBashPath(emptyCfg),
    });
    assert.equal(empty.status, 0, empty.stdout + empty.stderr);
    assert.match(empty.stdout, /disabled \(no IHM_N8N_\* keys\)/);

    // Malformed / incomplete => technical_error N8N_CONFIG_INVALID
    const badCfg = path.join(tmp, "bad-targets.env");
    fs.writeFileSync(badCfg, "IHM_N8N_TARGET_ID=only-id\n", "utf8");
    const badState = path.join(tmp, "bad");
    fs.mkdirSync(badState);
    const bad = runN8nOnly(badState, {
      IHM_N8N_TARGETS_FILE: toBashPath(badCfg),
    });
    assert.equal(bad.status, 30, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /N8N_CONFIG_INVALID|incomplete targets config/);

    // non-HTTPS rejected
    const httpCfg = path.join(tmp, "http-targets.env");
    writeN8nTargets(httpCfg, {
      IHM_N8N_LIVENESS_URL: "http://n8n-test.example.invalid/healthz",
    });
    const httpState = path.join(tmp, "http");
    fs.mkdirSync(httpState);
    const httpReject = runN8nOnly(httpState, {
      IHM_N8N_TARGETS_FILE: toBashPath(httpCfg),
    });
    assert.equal(httpReject.status, 30, httpReject.stdout + httpReject.stderr);
    assert.match(httpReject.stdout, /N8N_CONFIG_INVALID|non-canonical|non-HTTPS|unsafe/);

    // query / fragment / userinfo / trailing slash / wrong path rejected
    for (const [name, overrides] of [
      ["query", { IHM_N8N_LIVENESS_URL: "https://n8n-test.example.invalid/healthz?x=1" }],
      ["fragment", { IHM_N8N_LIVENESS_URL: "https://n8n-test.example.invalid/healthz#x" }],
      ["userinfo", { IHM_N8N_LIVENESS_URL: "https://user:pass@n8n-test.example.invalid/healthz" }],
      ["trail-live", { IHM_N8N_LIVENESS_URL: "https://n8n-test.example.invalid/healthz/" }],
      ["trail-ready", { IHM_N8N_READINESS_URL: "https://n8n-test.example.invalid/healthz/readiness/" }],
      ["wrong-live", { IHM_N8N_LIVENESS_URL: "https://n8n-test.example.invalid/health" }],
      ["wrong-ready", { IHM_N8N_READINESS_URL: "https://n8n-test.example.invalid/healthz/ready" }],
    ] as const) {
      const cfg = path.join(tmp, `${name}-targets.env`);
      writeN8nTargets(cfg, overrides);
      const st = path.join(tmp, name);
      fs.mkdirSync(st);
      const res = runN8nOnly(st, { IHM_N8N_TARGETS_FILE: toBashPath(cfg) });
      assert.equal(res.status, 30, `${name}: ${res.stdout}\n${res.stderr}`);
      assert.match(res.stdout, /N8N_CONFIG_INVALID|unsafe|non-canonical/);
      assertNoLeak(res.stdout + res.stderr);
    }

    const goodCfg = path.join(tmp, "good-targets.env");
    writeN8nTargets(goodCfg);

    // Static contract: only-n8n path acquires the same monitor lock.
    const source = readFile(SCRIPT);
    assert.match(
      source,
      /run_n8n_external_only\(\) \{[\s\S]*?IHM_SKIP_TELEGRAM=1[\s\S]*?acquire_lock_or_skip/,
    );
    assert.match(
      source,
      /IHM_N8N_PROBE_MOCK" && "\$IHM_ONLY_N8N_EXTERNAL" -eq 1 && "\$\{IHM_N8N_HARNESS_AS_LIVE:-\}" != "1"/,
    );
    assert.match(source, /os\.fsync/);
    assert.match(source, /os\.replace/);

    // liveness + readiness success via mock (no network) under --only-n8n-external
    const okState = path.join(tmp, "ok");
    fs.mkdirSync(okState);
    const ok = runN8nOnly(okState, {
      IHM_N8N_TARGETS_FILE: toBashPath(goodCfg),
      IHM_N8N_PROBE_MOCK: "liveness:200:40,readiness:200:50",
    });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /OK n8n liveness/);
    assert.match(ok.stdout, /OK n8n readiness/);
    assert.match(ok.stdout, /INTERNAL_HEALTH_MONITOR OK/);
    assertNoLeak(ok.stdout + ok.stderr);
    const okStatePath = path.join(okState, "n8n-external-probe-state.json");
    assert.ok(fs.existsSync(okStatePath));
    const okJson = JSON.parse(fs.readFileSync(okStatePath, "utf8")) as {
      schemaVersion: number;
      targetId: string;
      liveness: { consecutiveFailures: number; lastHttpCode: number };
      readiness: { consecutiveFailures: number; lastHttpCode: number };
    };
    assert.equal(okJson.schemaVersion, 1);
    assert.equal(okJson.targetId, "n8n-test-dev");
    assert.equal(okJson.liveness.consecutiveFailures, 0);
    assert.equal(okJson.readiness.consecutiveFailures, 0);
    assert.equal(okJson.liveness.lastHttpCode, 200);
    assert.doesNotMatch(fs.readFileSync(okStatePath, "utf8"), /user:pass|token|password/i);

    // Live-path mock guard (no Docker / no live network): HARNESS_AS_LIVE keeps
    // only-mode (CURL_BIN allowed) but forces mock ignore; fake curl proves mock
    // 503 is NOT used. Threshold=1 so mock would escalate immediately if honored.
    const liveGateState = path.join(tmp, "live-gate");
    fs.mkdirSync(liveGateState);
    const liveGateCfg = path.join(tmp, "live-gate-targets.env");
    writeN8nTargets(liveGateCfg, { IHM_N8N_FAILURE_THRESHOLD: "1" });
    const binDir = path.join(tmp, "fake-bin");
    fs.mkdirSync(binDir);
    const curlMarker = path.join(tmp, "curl-called.txt");
    const fakeCurl = path.join(binDir, "curl");
    fs.writeFileSync(
      fakeCurl,
      `#!/usr/bin/env bash
echo called >> "${toBashPath(curlMarker)}"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then
    shift
    : >"$1"
  fi
  shift || true
done
printf '200 0.01'
`,
      "utf8",
    );
    spawnSync(bash, ["-c", `chmod 755 "${toBashPath(fakeCurl)}"`], { encoding: "utf8" });
    const liveGate = runN8nOnly(liveGateState, {
      IHM_N8N_TARGETS_FILE: toBashPath(liveGateCfg),
      IHM_N8N_PROBE_MOCK: "liveness:503:1,readiness:503:1",
      IHM_N8N_HARNESS_AS_LIVE: "1",
      // Harness curl stub — only-mode still honors CURL_BIN under HARNESS_AS_LIVE.
      IHM_N8N_CURL_BIN: toBashPath(fakeCurl),
    });
    assert.equal(liveGate.status, 0, liveGate.stdout + liveGate.stderr);
    assert.match(liveGate.stdout, /probe mock ignored \(live path\)/);
    assert.match(liveGate.stdout, /OK n8n liveness/);
    assert.match(liveGate.stdout, /OK n8n readiness/);
    assert.doesNotMatch(liveGate.stdout, /N8N_LIVENESS_UNHEALTHY|N8N_READINESS_UNHEALTHY/);
    assert.ok(fs.existsSync(curlMarker), "only-mode HARNESS_AS_LIVE must invoke CURL_BIN stub");
    assertNoLeak(liveGate.stdout + liveGate.stderr);

    // Normal live gates ignore CURL_BIN (no network): FORCE_LIVE_GATES drops only-mode
    // so override stub must NOT run; entry-gated HARNESS_PATH_CURL stands in for PATH curl.
    const curlIgnoreState = path.join(tmp, "curl-ignore");
    fs.mkdirSync(curlIgnoreState);
    const curlIgnoreCfg = path.join(tmp, "curl-ignore-targets.env");
    writeN8nTargets(curlIgnoreCfg, { IHM_N8N_FAILURE_THRESHOLD: "1" });
    const pathCurlMarker = path.join(tmp, "path-curl-called.txt");
    const overrideCurlMarker = path.join(tmp, "override-curl-called.txt");
    const pathCurl = path.join(tmp, "path-curl");
    const overrideCurl = path.join(tmp, "override-curl");
    const curlStub = (marker: string) => `#!/usr/bin/env bash
echo called >> "${toBashPath(marker)}"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then
    shift
    : >"$1"
  fi
  shift || true
done
printf '200 0.01'
`;
    fs.writeFileSync(pathCurl, curlStub(pathCurlMarker), "utf8");
    fs.writeFileSync(overrideCurl, curlStub(overrideCurlMarker), "utf8");
    spawnSync(bash, ["-c", `chmod 755 "${toBashPath(pathCurl)}" "${toBashPath(overrideCurl)}"`], {
      encoding: "utf8",
    });
    const curlIgnore = runN8nOnly(curlIgnoreState, {
      IHM_N8N_TARGETS_FILE: toBashPath(curlIgnoreCfg),
      IHM_N8N_PROBE_MOCK: "liveness:503:1,readiness:503:1",
      IHM_N8N_HARNESS_FORCE_LIVE_GATES: "1",
      IHM_N8N_CURL_BIN: toBashPath(overrideCurl),
      IHM_N8N_HARNESS_PATH_CURL: toBashPath(pathCurl),
    });
    assert.equal(curlIgnore.status, 0, curlIgnore.stdout + curlIgnore.stderr);
    assert.match(curlIgnore.stdout, /curl bin override ignored \(live path\)/);
    assert.match(curlIgnore.stdout, /probe mock ignored \(live path\)/);
    assert.match(curlIgnore.stdout, /OK n8n liveness/);
    assert.ok(
      fs.existsSync(pathCurlMarker),
      "live gates must select harness PATH curl stand-in, not CURL_BIN",
    );
    assert.equal(
      fs.existsSync(overrideCurlMarker),
      false,
      "IHM_N8N_CURL_BIN stub must not run when only-mode gates are dropped",
    );
    assertNoLeak(curlIgnore.stdout + curlIgnore.stderr);

    // --only-n8n-external uses normal monitor lock (SKIP when held).
    // Behavioral only when flock(1) exists (Ubuntu/prod); Windows Git Bash may lack it.
    const flockProbe = spawnSync(bash, ["-c", "command -v flock"], { encoding: "utf8" });
    if (flockProbe.status === 0) {
      const lockState = path.join(tmp, "lock");
      fs.mkdirSync(lockState);
      const lockFileBash = toBashPath(path.join(lockState, "run.lock"));
      const lockDirBash = toBashPath(lockState);
      const holderProc = spawn(
        bash,
        [
          "-c",
          `mkdir -p "${lockDirBash}" && exec 9>"${lockFileBash}" && flock -n 9 || exit 41; sleep 30`,
        ],
        { stdio: "ignore" },
      );
      spawnSync(bash, ["-c", "sleep 0.4"], { encoding: "utf8" });
      const locked = runN8nOnly(lockState, {
        IHM_N8N_TARGETS_FILE: toBashPath(goodCfg),
        IHM_N8N_PROBE_MOCK: "liveness:200:10,readiness:200:10",
      });
      try {
        holderProc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      assert.equal(locked.status, 0, locked.stdout + locked.stderr);
      assert.match(locked.stdout, /INTERNAL_HEALTH_MONITOR SKIP concurrent run/);
    } else {
      assert.match(
        source,
        /run_n8n_external_only\(\) \{[\s\S]*?IHM_SKIP_TELEGRAM=1[\s\S]*?acquire_lock_or_skip/,
      );
    }

    // non-200
    const non200State = path.join(tmp, "non200");
    fs.mkdirSync(non200State);
    const non200 = runN8nOnly(non200State, {
      IHM_N8N_TARGETS_FILE: toBashPath(goodCfg),
      IHM_N8N_PROBE_MOCK: "liveness:503:30,readiness:200:40",
    });
    assert.equal(non200.status, 0, non200.stdout + non200.stderr);
    assert.match(non200.stdout, /INFO n8n liveness:.*debounced/);
    assert.match(non200.stdout, /OK n8n readiness/);
    assert.match(non200.stdout, /INTERNAL_HEALTH_MONITOR OK/);

    // timeout / transport / tls via mock
    for (const klass of ["timeout", "transport", "tls"] as const) {
      const st = path.join(tmp, `class-${klass}`);
      fs.mkdirSync(st);
      const res = runN8nOnly(st, {
        IHM_N8N_TARGETS_FILE: toBashPath(goodCfg),
        IHM_N8N_PROBE_MOCK: `liveness:${klass}:10000,readiness:200:40`,
      });
      assert.equal(res.status, 0, `${klass}: ${res.stdout}\n${res.stderr}`);
      assert.match(res.stdout, new RegExp(`errorClass=${klass}`));
      assert.match(res.stdout, /debounced/);
      assertNoLeak(res.stdout + res.stderr);
    }

    // First transient below threshold => no critical; second consecutive => critical
    const streakState = path.join(tmp, "streak");
    fs.mkdirSync(streakState);
    const firstFail = runN8nOnly(streakState, {
      IHM_N8N_TARGETS_FILE: toBashPath(goodCfg),
      IHM_N8N_PROBE_MOCK: "liveness:timeout:10000,readiness:200:40",
    });
    assert.equal(firstFail.status, 0, firstFail.stdout + firstFail.stderr);
    assert.match(firstFail.stdout, /debounced/);
    assert.doesNotMatch(firstFail.stdout, /N8N_LIVENESS_UNHEALTHY/);

    const secondFail = runN8nOnly(streakState, {
      IHM_N8N_TARGETS_FILE: toBashPath(goodCfg),
      IHM_N8N_PROBE_MOCK: "liveness:timeout:10000,readiness:200:40",
    });
    assert.equal(secondFail.status, 20, secondFail.stdout + secondFail.stderr);
    assert.match(secondFail.stdout, /N8N_LIVENESS_UNHEALTHY|FAIL n8n liveness/);
    assert.match(secondFail.stdout, /streak=2\/2/);
    const streakJson = JSON.parse(
      fs.readFileSync(path.join(streakState, "n8n-external-probe-state.json"), "utf8"),
    ) as { liveness: { consecutiveFailures: number } };
    assert.equal(streakJson.liveness.consecutiveFailures, 2);

    const journalPath = path.join(streakState, "journal.jsonl");
    const lastLine =
      fs.readFileSync(journalPath, "utf8").trim().split(/\n/).at(-1) ?? "";
    const parsed = JSON.parse(lastLine) as {
      overallStatus: string;
      problemCodes: string[];
    };
    assert.equal(parsed.overallStatus, "critical");
    assert.ok(parsed.problemCodes.includes("N8N_LIVENESS_UNHEALTHY"));

    // Recovery clears streak after prior unhealthy state
    const recovered = runN8nOnly(streakState, {
      IHM_N8N_TARGETS_FILE: toBashPath(goodCfg),
      IHM_N8N_PROBE_MOCK: "liveness:200:40,readiness:200:50",
    });
    assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
    assert.match(recovered.stdout, /OK n8n liveness/);
    const recoveredJson = JSON.parse(
      fs.readFileSync(path.join(streakState, "n8n-external-probe-state.json"), "utf8"),
    ) as {
      liveness: { consecutiveFailures: number };
      readiness: { consecutiveFailures: number };
    };
    assert.equal(recoveredJson.liveness.consecutiveFailures, 0);
    assert.equal(recoveredJson.readiness.consecutiveFailures, 0);

    // readiness-only failures reaching threshold => N8N_READINESS_UNHEALTHY
    const readyState = path.join(tmp, "ready-streak");
    fs.mkdirSync(readyState);
    const readyFirst = runN8nOnly(readyState, {
      IHM_N8N_TARGETS_FILE: toBashPath(goodCfg),
      IHM_N8N_PROBE_MOCK: "liveness:200:20,readiness:timeout:10000",
    });
    assert.equal(readyFirst.status, 0, readyFirst.stdout + readyFirst.stderr);
    assert.match(readyFirst.stdout, /INFO n8n readiness:.*debounced/);
    const readySecond = runN8nOnly(readyState, {
      IHM_N8N_TARGETS_FILE: toBashPath(goodCfg),
      IHM_N8N_PROBE_MOCK: "liveness:200:20,readiness:timeout:10000",
    });
    assert.equal(readySecond.status, 20, readySecond.stdout + readySecond.stderr);
    assert.match(readySecond.stdout, /N8N_READINESS_UNHEALTHY|FAIL n8n readiness/);
    const readyJournal =
      fs.readFileSync(path.join(readyState, "journal.jsonl"), "utf8").trim().split(/\n/).at(-1) ??
      "";
    const readyParsed = JSON.parse(readyJournal) as { problemCodes: string[] };
    assert.ok(readyParsed.problemCodes.includes("N8N_READINESS_UNHEALTHY"));

    // targetId change resets prior streak safely
    const idState = path.join(tmp, "target-id");
    fs.mkdirSync(idState);
    const idCfg1 = path.join(tmp, "id1.env");
    writeN8nTargets(idCfg1, { IHM_N8N_TARGET_ID: "n8n-old" });
    runN8nOnly(idState, {
      IHM_N8N_TARGETS_FILE: toBashPath(idCfg1),
      IHM_N8N_PROBE_MOCK: "liveness:timeout:1,readiness:200:1",
    });
    const afterOld = JSON.parse(
      fs.readFileSync(path.join(idState, "n8n-external-probe-state.json"), "utf8"),
    ) as { targetId: string; liveness: { consecutiveFailures: number } };
    assert.equal(afterOld.targetId, "n8n-old");
    assert.equal(afterOld.liveness.consecutiveFailures, 1);
    const idCfg2 = path.join(tmp, "id2.env");
    writeN8nTargets(idCfg2, { IHM_N8N_TARGET_ID: "n8n-new" });
    const idChanged = runN8nOnly(idState, {
      IHM_N8N_TARGETS_FILE: toBashPath(idCfg2),
      IHM_N8N_PROBE_MOCK: "liveness:timeout:1,readiness:200:1",
    });
    assert.equal(idChanged.status, 0, idChanged.stdout + idChanged.stderr);
    assert.match(idChanged.stdout, /debounced/);
    assert.doesNotMatch(idChanged.stdout, /N8N_LIVENESS_UNHEALTHY/);
    const afterNew = JSON.parse(
      fs.readFileSync(path.join(idState, "n8n-external-probe-state.json"), "utf8"),
    ) as { targetId: string; liveness: { consecutiveFailures: number } };
    assert.equal(afterNew.targetId, "n8n-new");
    assert.equal(afterNew.liveness.consecutiveFailures, 1);

    // Failed state write preserves previous valid state (deterministic harness hook).
    const writeFailState = path.join(tmp, "write-fail");
    fs.mkdirSync(writeFailState);
    const writeOk = runN8nOnly(writeFailState, {
      IHM_N8N_TARGETS_FILE: toBashPath(goodCfg),
      IHM_N8N_PROBE_MOCK: "liveness:200:10,readiness:200:10",
    });
    assert.equal(writeOk.status, 0, writeOk.stdout + writeOk.stderr);
    const priorStatePath = path.join(writeFailState, "n8n-external-probe-state.json");
    const priorBody = fs.readFileSync(priorStatePath, "utf8");
    const writeFail = runN8nOnly(writeFailState, {
      IHM_N8N_TARGETS_FILE: toBashPath(goodCfg),
      IHM_N8N_PROBE_MOCK: "liveness:timeout:1,readiness:200:1",
      IHM_N8N_STATE_WRITE_FAIL: "1",
    });
    assert.equal(writeFail.status, 30, writeFail.stdout + writeFail.stderr);
    assert.match(writeFail.stdout, /FAIL n8n external:.*probe state write failed/);
    const writeFailJournal =
      fs.readFileSync(path.join(writeFailState, "journal.jsonl"), "utf8").trim().split(/\n/).at(-1) ??
      "";
    const writeFailParsed = JSON.parse(writeFailJournal) as {
      overallStatus: string;
      problemCodes: string[];
    };
    assert.equal(writeFailParsed.overallStatus, "technical_error");
    assert.ok(writeFailParsed.problemCodes.includes("N8N_STATE_WRITE_FAILED"));
    assert.equal(fs.readFileSync(priorStatePath, "utf8"), priorBody);
    const leftoverTemps = fs
      .readdirSync(writeFailState)
      .filter((name) => name.startsWith(".n8n-probe-state."));
    assert.deepEqual(leftoverTemps, [], "failed write must clean up temp state files");
    assertNoLeak(writeFail.stdout + writeFail.stderr);

    // Booking HEALTH_URLS remain hardcoded and unchanged in script.
    for (const url of HEALTH_URLS) {
      assert.match(source, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(source, /IHM_PROD_HEALTH_URL="http:\/\/127\.0\.0\.1:3100\/api\/health"/);
    assert.match(source, /IHM_STAGING_HEALTH_URL="http:\/\/127\.0\.0\.1:3000\/api\/health"/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main(): void {
  assertRequiredFiles();
  assertScriptSafety();
  assertUnitsAndDocs();
  assertBashSyntaxAndFixtures();
  assertN8nExternalProbe();
  assertPackageScript();
  console.log("security-internal-health-monitor-check: OK");
}

main();
