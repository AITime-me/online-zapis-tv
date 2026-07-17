/**
 * Статический аудит production backup — изоляция от staging.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const BACKUP_SHELL_FILES = [
  "scripts/ops/production-backup.sh",
  "scripts/ops/install-production-backup-timer.sh",
  "scripts/ops/lib/production-ops-common.sh",
] as const;

const SECRET_KEYS = [
  "AUTH_SECRET",
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "SMTP_PASSWORD",
  "PGPASSWORD",
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

function extractFunctionBodies(source: string, fnName: string): string {
  const stripped = stripBashComments(source);
  const regex = new RegExp(`\\n${fnName}\\s*\\(\\)\\s*\\{`, "m");
  const startMatch = stripped.match(regex);
  if (!startMatch || startMatch.index === undefined) {
    return "";
  }
  let depth = 0;
  let started = false;
  let body = "";
  for (let i = startMatch.index; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (ch === "{") {
      depth += 1;
      started = true;
    } else if (ch === "}") {
      depth -= 1;
      if (started && depth === 0) {
        body = stripped.slice(startMatch.index, i + 1);
        break;
      }
    }
  }
  return body;
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

function assertIndexOrder(source: string, earlier: string, later: string, message: string): void {
  const a = source.indexOf(earlier);
  const b = source.indexOf(later);
  assert.ok(a >= 0, `${message}: missing ${earlier}`);
  assert.ok(b > a, message);
}

function assertBackupScript(): void {
  const source = readFile("scripts/ops/production-backup.sh");
  const executable = stripBashComments(source);
  const mainBody = extractFunctionBodies(source, "main") || executable;

  assert.match(executable, /ops_assert_production_checkout/);
  assert.match(executable, /ops_validate_production_env_file/);
  assert.match(executable, /ops_create_production_postgres_backup/);
  assert.match(executable, /ops_acquire_production_ops_lock/);
  assert.match(executable, /ops_purge_expired_production_backups/);
  assert.match(executable, /PRODUCTION_BACKUP_RETENTION_DAYS/);
  assert.doesNotMatch(executable, /ops_require_interactive_confirmation/);
  assert.doesNotMatch(executable, /tvoe-vremya-staging/);
  assert.doesNotMatch(executable, /\.env\.staging/);
  assert.doesNotMatch(executable, /backups\/deploy-state/);
  assert.doesNotMatch(executable, /"backups\/postgres"/);

  const dryRunExit = mainBody.indexOf('ops_info "Dry-run complete');
  const lockIdx = mainBody.indexOf("ops_acquire_production_ops_lock");

  assert.ok(dryRunExit >= 0 && lockIdx > dryRunExit, "dry-run must exit before lock");

  const afterLock = mainBody.slice(lockIdx);
  assertIndexOrder(
    afterLock,
    "ops_create_production_postgres_backup",
    "ops_purge_expired_production_backups",
    "retention after successful backup",
  );

  for (const secret of SECRET_KEYS) {
    assert.doesNotMatch(executable, new RegExp(`\\becho\\b[^;\\n]*${secret}`, "i"));
  }
}

function assertRetentionSafety(): void {
  const purgeBody = extractFunctionBodies(
    readFile("scripts/ops/lib/production-ops-common.sh"),
    "ops_purge_expired_production_backups",
  );

  assert.match(purgeBody, /PRODUCTION_BACKUPS_POSTGRES_DIR/);
  assert.match(purgeBody, /ops_is_production_backup_dump_basename/);
  assert.match(purgeBody, /readlink -f|realpath/);
  assert.match(purgeBody, /rm -f -- "\$file_resolved"/);
  assert.doesNotMatch(purgeBody, /rm -rf/);
  assert.doesNotMatch(purgeBody, /backups\/postgres\//);
  assert.doesNotMatch(purgeBody, /staging/);
}

function assertAtomicBackup(): void {
  const body = extractFunctionBodies(
    readFile("scripts/ops/lib/production-ops-common.sh"),
    "ops_create_production_postgres_backup",
  );

  assert.match(body, /pg_dump -U.*-Fc/);
  assert.match(body, /ops_verify_pg_dump_file/);
  assert.match(body, /chmod 600/);
  assert.match(body, /mv -f -- "\$tmp_path" "\$backup_path"/);
}

function assertSystemdUnits(): void {
  const service = readFile("deploy/systemd/production/online-zapis-tv-production-backup.service");
  const timer = readFile("deploy/systemd/production/online-zapis-tv-production-backup.timer");

  assert.match(service, /WorkingDirectory=\/opt\/online-zapis-tv-production/);
  assert.match(service, /production-backup\.sh/);
  assert.match(timer, /Asia\/Yekaterinburg/);
  assert.match(timer, /02:30:00/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /online-zapis-tv-production-backup\.service/);
  assert.doesNotMatch(service, /online-zapis-tv-staging/);
  assert.doesNotMatch(service, /\/opt\/online-zapis-tv[^-]/);

  for (const unit of [service, timer]) {
    for (const secret of [...SECRET_KEYS, ".env.production", "Environment="]) {
      assert.doesNotMatch(unit, new RegExp(secret, "i"), `unit must not contain ${secret}`);
    }
  }
}

function assertInstaller(): void {
  const source = stripBashComments(readFile("scripts/ops/install-production-backup-timer.sh"));
  assert.match(source, /--dry-run/);
  assert.match(source, /online-zapis-tv-production-backup/);
  assert.match(source, /ops_assert_production_checkout/);
  assert.doesNotMatch(source, /systemctl start.*--dry-run/);
}

function assertDocumentation(): void {
  const doc = readFile("docs/operations/production-backup.md");
  assert.match(doc, /30 дней|30/);
  assert.match(doc, /PRODUCTION_BACKUP_RETENTION_DAYS|retention/i);
  assert.match(doc, /restore базы в этой задаче не реализован/i);
  assert.match(doc, /\.production-ops\.lock/);
  assert.match(doc, /Asia\/Yekaterinburg/);
  assert.match(doc, /02:30/);
}

function assertShellSyntaxAndHelp(): void {
  const bash = resolveBashExecutable();
  for (const rel of [
    "scripts/ops/production-backup.sh",
    "scripts/ops/install-production-backup-timer.sh",
  ] as const) {
    const syntax = spawnSync(bash, ["-n", rel], { cwd: ROOT, encoding: "utf8" });
    assert.equal(syntax.status, 0, `bash -n ${rel} failed:\n${syntax.stderr}`);
  }

  const help = spawnSync(bash, ["scripts/ops/production-backup.sh", "--help"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /production-backup\.sh/);
  assert.match(help.stdout, /30/);
}

function assertExecutableBits(): void {
  for (const rel of BACKUP_SHELL_FILES) {
    const result = spawnSync("git", ["ls-files", "-s", rel], { cwd: ROOT, encoding: "utf8" });
    if (result.status !== 0 || !result.stdout.trim()) {
      continue;
    }
    const mode = result.stdout.trim().split(/\s+/)[0] ?? "";
    if (rel.endsWith(".sh")) {
      assert.match(mode, /^1007[0-5]{2}$/, `${rel}: executable bit required (mode ${mode})`);
    }
  }
}

function run(): void {
  assertBackupScript();
  assertRetentionSafety();
  assertAtomicBackup();
  assertSystemdUnits();
  assertInstaller();
  assertDocumentation();
  assertShellSyntaxAndHelp();
  assertExecutableBits();
  console.log("security-production-backup-check: OK");
}

run();
