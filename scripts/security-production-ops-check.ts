/**
 * Статический аудит production ops-скриптов — изоляция от staging.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const PRODUCTION_OPS_SHELL_FILES = [
  "scripts/ops/production-deploy.sh",
  "scripts/ops/production-rollback-app.sh",
  "scripts/ops/production-backup.sh",
  "scripts/ops/production-restore-database.sh",
  "scripts/ops/install-production-backup-timer.sh",
  "scripts/ops/lib/production-ops-common.sh",
] as const;

const SECRET_MANIFEST_KEYS = [
  "AUTH_SECRET",
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "SMTP_PASSWORD",
] as const;

const FORBIDDEN_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  excludeFiles?: readonly string[];
}> = [
  { name: "set -x", pattern: /^\s*set\s+-x/m },
  { name: "docker compose down", pattern: /docker\s+compose\b[^;\n]*\bdown\b/ },
  { name: "git reset --hard", pattern: /git\s+reset\s+--hard/ },
  { name: "git clean -fd", pattern: /git\s+clean\s+-fd/ },
  { name: "prisma migrate reset", pattern: /prisma\s+migrate\s+reset/ },
  { name: "prisma db push", pattern: /prisma\s+db\s+push/ },
  { name: "prisma db seed", pattern: /prisma\s+db\s+seed|db:seed/ },
  { name: "owner:create", pattern: /owner:create/ },
  {
    name: "pg_restore restore",
    pattern: /pg_restore\s+--exit-on-error/,
    excludeFiles: [
      "scripts/ops/lib/production-ops-common.sh",
      "scripts/ops/production-restore-database.sh",
    ],
  },
  { name: "source .env.production", pattern: /\bsource\b[^;\n]*\.env\.production/ },
  { name: "cat .env.production", pattern: /\bcat\b[^;\n]*\.env\.production/ },
  { name: "staging checkout path", pattern: /\/opt\/online-zapis-tv[^-]/ },
  { name: "staging lock", pattern: /\.deploy\.lock/ },
  { name: "staging backups dir", pattern: /backups\/postgres\/(?!production)/ },
];

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

    const withoutInline = line.replace(/(^|[^\\])#.*$/, "$1");
    out.push(withoutInline);
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

function assertShellBasics(): void {
  for (const rel of PRODUCTION_OPS_SHELL_FILES) {
    const source = readFile(rel);
    assert.match(source, /^#!\/usr\/bin\/env bash/m, `${rel}: bash shebang required`);
    if (rel !== "scripts/ops/lib/production-ops-common.sh") {
      assert.match(source, /set -Eeuo pipefail/, `${rel}: must use set -Eeuo pipefail`);
    }
  }
}

function assertExecutableBitsInGit(): void {
  for (const rel of PRODUCTION_OPS_SHELL_FILES) {
    const result = spawnSync("git", ["ls-files", "-s", rel], { cwd: ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, `git ls-files failed for ${rel}`);
    const mode = result.stdout.trim().split(/\s+/)[0] ?? "";
    assert.match(mode, /^1007[0-5]{2}$/, `${rel}: executable bit required in git (mode ${mode})`);
  }
}

function assertProductionCommonConstants(): void {
  const common = readFile("scripts/ops/lib/production-ops-common.sh");

  assert.match(common, /PRODUCTION_EXPECTED_REPO_ROOT="\/opt\/online-zapis-tv-production"/);
  assert.match(common, /PRODUCTION_STAGING_REPO_ROOT="\/opt\/online-zapis-tv"/);
  assert.match(common, /PRODUCTION_COMPOSE_FILE="docker-compose\.production\.yml"/);
  assert.match(common, /PRODUCTION_ENV_FILE="\.env\.production"/);
  assert.match(common, /PRODUCTION_APP_CONTAINER="tvoe-vremya-production-app"/);
  assert.match(common, /PRODUCTION_POSTGRES_CONTAINER="tvoe-vremya-production-postgres"/);
  assert.match(common, /PRODUCTION_BACKUPS_POSTGRES_DIR="backups\/production\/postgres"/);
  assert.match(common, /PRODUCTION_DEPLOY_STATE_DIR="backups\/production\/deploy-state"/);
  assert.match(common, /PRODUCTION_LOCK_FILE="backups\/production\/deploy-state\/\.production-ops\.lock"/);
  assert.match(common, /PRODUCTION_HEALTH_URL="http:\/\/127\.0\.0\.1:3100\/api\/health"/);
  assert.match(common, /PRODUCTION_APP_IMAGE_REF="online-zapis-tv-production-app:current"/);
  assert.match(common, /PRODUCTION_BACKUP_RETENTION_DAYS=30/);
  assert.doesNotMatch(stripBashComments(common), /source[^;\n]*staging-ops-common/);
  assert.doesNotMatch(common, /tvoe-vremya-staging-app/);
  assert.doesNotMatch(common, /\.env\.staging/);
}

function assertProductionGuard(): void {
  const guardBody = extractFunctionBodies(
    readFile("scripts/ops/lib/production-ops-common.sh"),
    "ops_assert_production_checkout",
  );
  const deploy = stripBashComments(readFile("scripts/ops/production-deploy.sh"));
  const rollback = stripBashComments(readFile("scripts/ops/production-rollback-app.sh"));

  assert.match(guardBody, /PRODUCTION_STAGING_REPO_ROOT/);
  assert.match(guardBody, /PRODUCTION_EXPECTED_REPO_ROOT/);
  assert.match(guardBody, /PRODUCTION_COMPOSE_FILE/);
  assert.match(guardBody, /PRODUCTION_ENV_FILE/);
  assert.match(deploy, /ops_assert_production_checkout/);
  assert.match(rollback, /ops_assert_production_checkout/);
}

function assertProductionEnvValidation(): void {
  const body = extractFunctionBodies(
    readFile("scripts/ops/lib/production-ops-common.sh"),
    "ops_validate_production_env_file",
  );

  assert.match(body, /APP_ENV must be exactly production/);
  assert.match(body, /AUTH_URL must be a public HTTPS URL/);
  assert.match(body, /TRUST_PROXY_HEADERS must be true/);
}

function assertNoStagingContainerUsage(): void {
  for (const rel of [
    "scripts/ops/production-deploy.sh",
    "scripts/ops/production-rollback-app.sh",
    "scripts/ops/production-backup.sh",
    "scripts/ops/production-restore-database.sh",
    "scripts/ops/install-production-backup-timer.sh",
  ] as const) {
    const executable = stripBashComments(readFile(rel));
    assert.doesNotMatch(executable, /tvoe-vremya-staging/);
    assert.doesNotMatch(executable, /\.env\.staging/);
  }
}

function assertForbiddenPatterns(): void {
  for (const rel of PRODUCTION_OPS_SHELL_FILES) {
    const executable = stripBashComments(readFile(rel));
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.excludeFiles?.includes(rel)) {
        continue;
      }
      if (rule.name === "staging checkout path") {
        if (rel === "scripts/ops/lib/production-ops-common.sh") {
          continue;
        }
        assert.doesNotMatch(
          executable,
          /[^-]\/opt\/online-zapis-tv"/,
          `${rel}: must not reference staging checkout as production root`,
        );
        continue;
      }
      if (rule.name === "staging backups dir") {
        assert.doesNotMatch(executable, /backups\/deploy-state/, `${rel}: staging deploy-state dir`);
        assert.doesNotMatch(executable, /"backups\/postgres"/, `${rel}: staging postgres backup dir`);
        continue;
      }
      assert.doesNotMatch(executable, rule.pattern, `${rel}: forbidden (${rule.name})`);
    }
  }
}

function assertProductionLock(): void {
  const common = readFile("scripts/ops/lib/production-ops-common.sh");
  const lockBody = extractFunctionBodies(common, "ops_acquire_production_ops_lock");
  const deployMain = extractFunctionBodies(readFile("scripts/ops/production-deploy.sh"), "main");
  const rollbackMain = extractFunctionBodies(readFile("scripts/ops/production-rollback-app.sh"), "main");

  assert.match(lockBody, /flock -n 9/);
  assert.match(lockBody, /PRODUCTION_LOCK_FILE/);
  assert.match(deployMain, /ops_acquire_production_ops_lock/);
  assert.match(
    deployMain,
    /\[\[\s*"\$OPS_DRY_RUN"\s*-eq\s*0\s*\]\][\s\S]*ops_acquire_production_ops_lock/,
    "deploy must acquire lock only when not dry-run",
  );

  const deployDryRunExit = deployMain.indexOf('ops_info "Dry-run complete');
  const deployLockIdx = deployMain.indexOf("ops_acquire_production_ops_lock");
  assert.ok(deployDryRunExit > deployLockIdx, "dry-run must not hold production lock through mutating path");

  const rollbackDryRunExit = rollbackMain.indexOf('ops_info "Dry-run complete');
  const rollbackLockIdx = rollbackMain.indexOf("ops_acquire_production_ops_lock");
  assert.ok(rollbackDryRunExit > rollbackLockIdx, "rollback dry-run must exit after plan");
}

function assertDeployScript(): void {
  const source = readFile("scripts/ops/production-deploy.sh");
  const executable = stripBashComments(source);
  const mainBody = extractFunctionBodies(source, "main") || executable;
  const migrationsBody = extractFunctionBodies(source, "run_migrations");

  assert.match(executable, /ops_require_interactive_confirmation\s+"DEPLOY PRODUCTION"/);
  assert.match(executable, /git merge --ff-only origin\/main/);
  assert.match(executable, /git working tree is not clean/);
  assert.match(executable, /fast-forward only/);
  assert.match(executable, /--redeploy-current/);
  assert.match(executable, /ops_create_production_postgres_backup/);
  assert.match(executable, /ops_check_http_health_production/);
  assert.match(executable, /ops_run_prisma_migrate_status\s+"pre"/);
  assert.match(executable, /ops_run_prisma_migrate_status\s+"post"/);
  assert.doesNotMatch(migrationsBody, /\|\|\s*true/);

  assertIndexOrder(mainBody, "ops_create_production_postgres_backup", "prepare_rollback_tag", "backup before rollback tag");
  assertIndexOrder(mainBody, "prepare_rollback_tag", "init_state_manifest", "rollback tag before manifest");
  assertIndexOrder(mainBody, "init_state_manifest", "build_images", "manifest before build");
  assertIndexOrder(mainBody, "build_images", "run_migrations", "build before migrations");
  assertIndexOrder(mainBody, "run_migrations", "restart_app_only", "migrations before restart");

  const dryRunExit = mainBody.indexOf('ops_info "Dry-run complete');
  for (const token of [
    "ops_create_production_postgres_backup",
    "init_state_manifest",
    "build_images",
    "run_migrations",
    "restart_app_only",
    "fast_forward_git",
    "ops_acquire_production_ops_lock",
  ]) {
    const idx = mainBody.indexOf(token);
    if (token === "ops_acquire_production_ops_lock") {
      assert.ok(idx >= 0 && dryRunExit > idx, "dry-run must exit before lock-dependent mutations");
      continue;
    }
    if (idx >= 0 && dryRunExit >= 0) {
      assert.ok(dryRunExit < idx, `dry-run must exit before ${token}`);
    }
  }
}

function assertAtomicBackup(): void {
  const body = extractFunctionBodies(
    readFile("scripts/ops/lib/production-ops-common.sh"),
    "ops_create_production_postgres_backup",
  );

  assert.match(body, /\.tmp\.\$\$/);
  assert.match(body, /chmod 600/);
  assert.match(body, /ops_verify_pg_dump_file/);
  assert.match(body, /mv -f -- "\$tmp_path" "\$backup_path"/);
  assert.match(body, /pg_dump -U/);
  assert.match(body, /PRODUCTION_BACKUPS_POSTGRES_DIR/);
  assert.doesNotMatch(body, /backups\/postgres\//);
}

function assertHttpHealthContract(): void {
  const body = extractFunctionBodies(
    readFile("scripts/ops/lib/production-ops-common.sh"),
    "ops_check_http_health_production",
  );

  assert.match(body, /PRODUCTION_HEALTH_URL/);
  assert.match(body, /grep -qE/);
  assert.match(body, /"ok"/);
  assert.match(body, /"healthy"/);
  assert.doesNotMatch(body, /\bcat\b/);
}

function assertRollbackScript(): void {
  const source = readFile("scripts/ops/production-rollback-app.sh");
  const executable = stripBashComments(source);
  const performBody = extractFunctionBodies(source, "perform_rollback");

  assert.match(executable, /ops_require_interactive_confirmation\s+"ROLLBACK PRODUCTION APP"/);
  assert.match(executable, /ops_apply_compose_app_image/);
  assert.match(executable, /ops_recreate_app_container/);
  assert.match(performBody, /ops_assert_container_image_matches/);
  assert.match(executable, /ops_assess_rollback_migration_risk/);
  assert.match(executable, /ops_check_http_health_production/);
  assert.doesNotMatch(executable, /pg_restore|DROP DATABASE|git reset/);
  assert.doesNotMatch(executable, /db:seed|owner:create/);
}

function assertManifestSafety(): void {
  const deploy = readFile("scripts/ops/production-deploy.sh");
  const manifestBody = extractFunctionBodies(deploy, "persist_state_manifest");

  assert.match(manifestBody, /ENVIRONMENT=production/);
  assert.match(manifestBody, /GIT_STATUS_STAGE=/);
  assert.match(manifestBody, /BACKUP_STATUS=/);
  assert.match(manifestBody, /BUILD_STATUS=/);
  assert.match(manifestBody, /APP_RESTART_STATUS=/);

  for (const secret of SECRET_MANIFEST_KEYS) {
    assert.doesNotMatch(
      manifestBody,
      new RegExp(`\\b${secret}=`, "i"),
      `manifest must not store ${secret}`,
    );
  }
}

function assertGitignoreProductionEnv(): void {
  const gitignore = readFile(".gitignore");
  assert.match(gitignore, /^\.env\.production$/m);
  assert.match(gitignore, /^\/backups\//m);
}

function assertDocumentation(): void {
  const runbook = readFile("docs/operations/production-deploy.md");
  assert.match(runbook, /\/opt\/online-zapis-tv-production/);
  assert.match(runbook, /DEPLOY PRODUCTION/);
  assert.match(runbook, /ROLLBACK PRODUCTION APP/);
  assert.match(runbook, /127\.0\.0\.1:3100/);
  assert.match(runbook, /reverse proxy/i);
  assert.match(runbook, /не являются разрешением/i);
  assert.match(runbook, /production-compose\.md/);
}

function assertShellSyntax(): void {
  const bash = resolveBashExecutable();
  for (const rel of [
    "scripts/ops/production-deploy.sh",
    "scripts/ops/production-rollback-app.sh",
    "scripts/ops/production-backup.sh",
    "scripts/ops/production-restore-database.sh",
    "scripts/ops/install-production-backup-timer.sh",
  ] as const) {
    const result = spawnSync(bash, ["-n", rel], { cwd: ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, `bash -n ${rel} failed:\n${result.stderr}`);
  }
}

function assertHelpWorks(): void {
  const bash = resolveBashExecutable();
  for (const [script, marker] of [
    ["scripts/ops/production-deploy.sh", "deploy production"],
    ["scripts/ops/production-rollback-app.sh", "Roll back only the production app"],
    ["scripts/ops/production-backup.sh", "production-backup.sh"],
  ] as const) {
    const result = spawnSync(bash, [script, "--help"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, `${script} --help failed:\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(marker, "i"));
  }
}

function run(): void {
  assertShellBasics();
  assertExecutableBitsInGit();
  assertProductionCommonConstants();
  assertProductionGuard();
  assertProductionEnvValidation();
  assertForbiddenPatterns();
  assertNoStagingContainerUsage();
  assertProductionLock();
  assertDeployScript();
  assertAtomicBackup();
  assertHttpHealthContract();
  assertRollbackScript();
  assertManifestSafety();
  assertGitignoreProductionEnv();
  assertDocumentation();
  assertShellSyntax();
  assertHelpWorks();
  console.log("security-production-ops-check: OK");
}

run();
