/**
 * Статический аудит production database restore — изоляция от staging.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const RESTORE_SHELL_FILES = [
  "scripts/ops/production-restore-database.sh",
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

function assertIndexOrder(source: string, earlier: string, later: string, message: string): void {
  const a = source.indexOf(earlier);
  const b = source.indexOf(later);
  assert.ok(a >= 0, `${message}: missing ${earlier}`);
  assert.ok(b > a, message);
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

function assertRestoreScript(): void {
  const source = readFile("scripts/ops/production-restore-database.sh");
  const executable = stripBashComments(source);
  const mainBody = extractFunctionBodies(source, "main") || executable;
  const switchBody = extractFunctionBodies(source, "switch_production_database");

  assert.match(executable, /ops_assert_production_checkout/);
  assert.match(executable, /ops_validate_production_env_file/);
  assert.match(executable, /--apply/);
  assert.match(executable, /--backup/);
  assert.match(executable, /--dry-run/);
  assert.match(executable, /specify --dry-run to validate safely or --apply to restore/);
  assert.match(executable, /--apply cannot be combined with --dry-run/);
  assert.match(executable, /ops_require_interactive_confirmation\s+"RESTORE PRODUCTION DATABASE"/);
  assert.match(executable, /ops_validate_backup_path/);
  assert.match(executable, /ops_is_production_backup_dump_basename/);
  assert.match(executable, /ops_production_restore_verify_source_dump/);
  assert.match(executable, /ops_create_production_postgres_backup\s+"prerestore"/);
  assert.match(executable, /restore_to_temp_database/);
  assert.match(executable, /switch_production_database/);
  assert.match(executable, /rollback_database_switch/);
  assert.match(executable, /tv_restore_fail_/);
  assert.match(
    extractFunctionBodies(source, "rollback_database_switch"),
    /ops_validate_postgres_identifier\s+"\$failed_restore_name"/,
  );
  assert.match(executable, /ops_check_http_health_production/);
  assert.match(executable, /persist_restore_manifest/);

  assert.doesNotMatch(executable, /latest/);
  assert.doesNotMatch(executable, /tvoe-vremya-staging/);
  assert.doesNotMatch(executable, /\.env\.staging/);
  assert.doesNotMatch(executable, /migrate deploy/);
  assert.doesNotMatch(executable, /db:seed|owner:create/);
  assert.doesNotMatch(executable, /git reset --hard/);
  assert.doesNotMatch(executable, /pg_restore --clean/);

  assert.match(switchBody, /ops_compose stop app/);
  assert.match(switchBody, /ops_production_restore_rename_database/);

  const dryRunExit = mainBody.indexOf('ops_info "Dry-run complete');
  const lockIdx = mainBody.indexOf("ops_acquire_production_ops_lock");
  assert.ok(dryRunExit >= 0 && lockIdx > dryRunExit, "dry-run must exit before lock");

  assertIndexOrder(mainBody, "restore_to_temp_database", "switch_production_database", "temp restore before switch");
  assertIndexOrder(mainBody, "ops_create_production_postgres_backup", "restore_to_temp_database", "pre-restore before temp restore");

  for (const secret of SECRET_KEYS) {
    assert.doesNotMatch(executable, new RegExp(`\\becho\\b[^;\\n]*${secret}`, "i"));
  }
}

function assertCommonRestoreHelpers(): void {
  const common = readFile("scripts/ops/lib/production-ops-common.sh");
  const verifyBody = extractFunctionBodies(common, "ops_production_restore_verify_temp_database");
  const renameBody = extractFunctionBodies(common, "ops_production_restore_rename_database");
  const createBody = extractFunctionBodies(common, "ops_production_restore_create_database");
  const dropBody = extractFunctionBodies(common, "ops_production_restore_drop_database");
  const tempNameBody = extractFunctionBodies(common, "ops_production_restore_generate_temp_db_name");
  const rollbackNameBody = extractFunctionBodies(
    common,
    "ops_production_restore_generate_rollback_db_name",
  );

  assert.match(common, /ops_validate_postgres_identifier/);
  assert.match(common, /ops_production_restore_generate_temp_db_name/);
  assert.match(common, /ops_production_restore_pg_restore_into_db/);
  assert.match(common, /pg_restore --exit-on-error --no-owner --no-acl/);
  assert.match(common, /ops_production_restore_verify_temp_database/);
  assert.match(common, /ops_production_restore_rename_database/);

  // Actual PostgreSQL names from prisma @@map (not Prisma model names).
  assert.match(
    verifyBody,
    /table_name IN \('users', 'appointments', 'studio_settings', '_prisma_migrations'\)/,
  );
  assert.doesNotMatch(verifyBody, /'User'|\'Appointment\'|'StudioSettings'/);
  assert.match(verifyBody, /ops_validate_postgres_identifier\s+"\$db_name"/);
  assert.match(verifyBody, /psql[^;]*-d "\$db_name"/);
  assert.doesNotMatch(verifyBody, /\$\{[^}]*\}.*FROM information_schema/);

  assert.match(tempNameBody, /tv_restore_tmp_/);
  assert.match(tempNameBody, /ops_validate_postgres_identifier/);
  assert.match(rollbackNameBody, /tv_restore_rb_/);
  assert.match(rollbackNameBody, /ops_validate_postgres_identifier/);
  assert.doesNotMatch(tempNameBody, /BACKUP_ARG/);
  assert.doesNotMatch(rollbackNameBody, /BACKUP_ARG/);

  assert.match(renameBody, /quoted_from=/);
  assert.match(renameBody, /ALTER DATABASE \$\{quoted_from\} RENAME TO \$\{quoted_to\}/);
  assert.match(createBody, /CREATE DATABASE \$\{quoted_db\}/);
  assert.match(dropBody, /DROP DATABASE IF EXISTS \$\{quoted_db\}/);
}

function assertBackupBasenamePatterns(): void {
  const common = readFile("scripts/ops/lib/production-ops-common.sh");
  const reMatch = common.match(/PRODUCTION_BACKUP_DUMP_NAME_RE='([^']+)'/);
  assert.ok(reMatch?.[1], "PRODUCTION_BACKUP_DUMP_NAME_RE must be defined");
  const pattern = new RegExp(reMatch[1]);

  const allowed = [
    "20260717T120000Z_abc1234.dump",
    "20260717T120000Z_prerestore.dump",
    "20260717T235959Z_deadbeef.dump",
  ];
  for (const name of allowed) {
    assert.match(name, pattern, `basename must be accepted: ${name}`);
  }

  const rejected = [
    "latest.dump",
    "backup.dump",
    "20260717T120000Z_prerestore.dump.bak",
    "../../../etc/passwd.dump",
    "20260717T120000Z_evil;rm.dump",
    "20260717_prerestore.dump",
    "not-a-dump.txt",
  ];
  for (const name of rejected) {
    assert.doesNotMatch(name, pattern, `basename must be rejected: ${name}`);
  }

  assert.match(
    readFile("scripts/ops/production-restore-database.sh"),
    /ops_is_production_backup_dump_basename/,
  );
}

function assertManifestSafety(): void {
  const manifestBody = extractFunctionBodies(
    readFile("scripts/ops/production-restore-database.sh"),
    "persist_restore_manifest",
  );

  assert.match(manifestBody, /SOURCE_BACKUP_PATH=/);
  assert.match(manifestBody, /PRE_RESTORE_BACKUP_PATH=/);
  assert.match(manifestBody, /ROLLBACK_DB_NAME=/);
  assert.match(manifestBody, /RESTORE_STATUS=/);

  for (const secret of SECRET_KEYS) {
    assert.doesNotMatch(
      manifestBody,
      new RegExp(`\\b${secret}=`, "i"),
      `manifest must not store ${secret}`,
    );
  }
}

function assertDocumentation(): void {
  const doc = readFile("docs/operations/production-restore.md");
  assert.match(doc, /--dry-run/);
  assert.match(doc, /--apply/);
  assert.match(doc, /RESTORE PRODUCTION DATABASE/);
  assert.match(doc, /pre-restore|prerestore/i);
  assert.match(doc, /временн/i);
  assert.match(doc, /production-backup\.md/);
  assert.match(doc, /не вызывается/i);
}

function assertShellSyntaxAndHelp(): void {
  const bash = resolveBashExecutable();
  const syntax = spawnSync(bash, ["-n", "scripts/ops/production-restore-database.sh"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(syntax.status, 0, `bash -n failed:\n${syntax.stderr}`);

  const help = spawnSync(bash, ["scripts/ops/production-restore-database.sh", "--help"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /RESTORE PRODUCTION DATABASE/);
  assert.match(help.stdout, /--apply/);
}

function run(): void {
  assertRestoreScript();
  assertCommonRestoreHelpers();
  assertBackupBasenamePatterns();
  assertManifestSafety();
  assertDocumentation();
  assertShellSyntaxAndHelp();
  console.log("security-production-restore-check: OK");
}

run();
