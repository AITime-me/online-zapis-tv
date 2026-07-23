/**
 * Static security/regression audit for simple internal health monitor v1.
 * Does not talk to Docker, systemd, SMTP, staging, or production.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();

const SCRIPT = "scripts/ops/internal-health-monitor.sh";
const SERVICE = "deploy/systemd/host/online-zapis-tv-internal-health-monitor.service";
const TIMER = "deploy/systemd/host/online-zapis-tv-internal-health-monitor.timer";
const LOGROTATE = "deploy/logrotate/online-zapis-tv-health-monitor";
const DOCS = "docs/operations/internal-health-monitor.md";

const REQUIRED_FILES = [SCRIPT, SERVICE, TIMER, LOGROTATE, DOCS] as const;

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
}

function main(): void {
  assertRequiredFiles();
  assertScriptSafety();
  assertUnitsAndDocs();
  assertBashSyntaxAndFixtures();
  assertPackageScript();
  console.log("security-internal-health-monitor-check: OK");
}

main();
