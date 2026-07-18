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
  "scripts/ops/production-bootstrap-data.sh",
  "scripts/ops/install-production-backup-timer.sh",
  "scripts/ops/install-production-reverse-proxy.sh",
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
  const common = readFile("scripts/ops/lib/production-ops-common.sh");
  const guardBody = extractFunctionBodies(
    common,
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

  // Регрессия: pwd -P и fallback pwd не должны жить в одной &&/|| цепочке внутри одной
  // подстановки — иначе при успехе pwd выполняется дважды и путь дублируется через \n.
  assert.doesNotMatch(
    guardBody,
    /resolved="\$\(cd "\$OPS_REPO_ROOT" && pwd -P 2>\/dev\/null \|\| cd "\$OPS_REPO_ROOT" && pwd\)"/,
  );
  assert.match(
    guardBody,
    /resolved="\$\(cd "\$OPS_REPO_ROOT" && pwd -P 2>\/dev\/null\)" \|\|\s*\\\r?\n\s*resolved="\$\(cd "\$OPS_REPO_ROOT" && pwd\)"/,
  );
  assert.match(
    guardBody,
    /resolved" == \*\$'\\n'\*/,
  );
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
  const collectBody = extractFunctionBodies(source, "collect_app_image_state");
  const detectPostgresBody = extractFunctionBodies(source, "detect_postgres_deploy_state");
  const prepareRollbackBody = extractFunctionBodies(source, "prepare_rollback_tag");
  const printPlanBody = extractFunctionBodies(source, "print_plan");
  const rollbackAppBody = extractFunctionBodies(source, "rollback_app_image");
  const startPostgresBody = extractFunctionBodies(source, "start_production_postgres_for_bootstrap");

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

  assert.match(collectBody, /IS_INITIAL_DEPLOY=1/);
  assert.match(collectBody, /APP_IMAGE_ROLLBACK_AVAILABLE=0/);
  assert.match(collectBody, /Initial deploy:/);
  assert.match(collectBody, /detect_postgres_deploy_state/);
  assert.doesNotMatch(
    collectBody,
    /ops_die "app container does not exist \(required to capture previous image for rollback\)"/,
  );
  assert.match(collectBody, /IS_INITIAL_DEPLOY=0/);
  assert.match(collectBody, /APP_IMAGE_ROLLBACK_AVAILABLE=1/);

  assert.match(detectPostgresBody, /POSTGRES_EXISTED_AT_START=1/);
  assert.match(detectPostgresBody, /PRE_DEPLOY_BACKUP_REQUIRED=1/);
  assert.match(detectPostgresBody, /IS_CLEAN_INITIAL_BOOTSTRAP=1/);
  assert.match(detectPostgresBody, /PRE_DEPLOY_BACKUP_REQUIRED=0/);
  assert.match(detectPostgresBody, /pre-deploy backup is required/);
  assert.match(detectPostgresBody, /pre-deploy backup is not applicable/);

  assert.match(prepareRollbackBody, /IS_INITIAL_DEPLOY.*-eq 1/);
  assert.match(prepareRollbackBody, /skipping previous app image capture/);
  assert.match(
    prepareRollbackBody,
    /ops_die "app container does not exist \(required to capture previous image for rollback\)"/,
  );
  assert.match(prepareRollbackBody, /docker tag "\$PREVIOUS_APP_IMAGE_ID" "\$ROLLBACK_IMAGE_TAG"/);

  assert.match(printPlanBody, /Deploy kind: INITIAL/);
  assert.match(printPlanBody, /PostgreSQL: EXISTS/);
  assert.match(printPlanBody, /PostgreSQL: MISSING/);
  assert.match(printPlanBody, /CLEAN INITIAL/);
  assert.match(printPlanBody, /NOT APPLICABLE/);
  assert.match(printPlanBody, /Create and wait for healthy production PostgreSQL/);
  assert.match(printPlanBody, /Create and verify PostgreSQL backup \(atomic\)/);
  assert.match(printPlanBody, /Skip previous app image tag \(initial deploy/);
  assert.match(printPlanBody, /Tag current app image for rollback/);
  assert.match(printPlanBody, /build → start\/wait postgres → migrate → app → health|Build app and migrator images/);

  assert.match(startPostgresBody, /IS_CLEAN_INITIAL_BOOTSTRAP.*-ne 1/);
  assert.match(startPostgresBody, /ops_compose up -d --no-deps --no-build postgres/);
  assert.match(startPostgresBody, /ops_wait_for_docker_health "\$PRODUCTION_POSTGRES_CONTAINER"/);
  assert.doesNotMatch(startPostgresBody, /pg_dump|ops_create_production_postgres_backup/);

  assert.match(rollbackAppBody, /APP_ROLLBACK_STATUS="unavailable"/);
  assert.match(rollbackAppBody, /no previous app image available for rollback/);

  assert.match(mainBody, /PRE_DEPLOY_BACKUP_REQUIRED/);
  assert.match(mainBody, /not_applicable_no_database/);
  assert.match(mainBody, /start_production_postgres_for_bootstrap/);

  assertIndexOrder(mainBody, "collect_app_image_state", "print_plan", "detect initial/redeploy before plan");
  assertIndexOrder(mainBody, "ops_create_production_postgres_backup", "prepare_rollback_tag", "backup before rollback tag");
  assertIndexOrder(mainBody, "prepare_rollback_tag", "init_state_manifest", "rollback tag before manifest");
  assertIndexOrder(mainBody, "init_state_manifest", "build_images", "manifest before build");
  assertIndexOrder(mainBody, "build_images", "start_production_postgres_for_bootstrap", "build before postgres bootstrap");
  assertIndexOrder(mainBody, "start_production_postgres_for_bootstrap", "run_migrations", "postgres before migrations");
  assertIndexOrder(mainBody, "run_migrations", "restart_app_only", "migrations before restart");

  const dryRunExit = mainBody.indexOf('ops_info "Dry-run complete');
  for (const token of [
    "ops_create_production_postgres_backup",
    "init_state_manifest",
    "build_images",
    "start_production_postgres_for_bootstrap",
    "run_migrations",
    "restart_app_only",
    "fast_forward_git",
    "prepare_rollback_tag",
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
  assert.match(body, /ops_die "postgres container does not exist"/);
  assert.doesNotMatch(body, /backups\/postgres\//);
  assert.doesNotMatch(body, /not_applicable_no_database|IS_CLEAN_INITIAL_BOOTSTRAP/);
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
  const assertAvailableBody = extractFunctionBodies(source, "assert_previous_app_rollback_available");
  const mainBody = extractFunctionBodies(source, "main") || executable;

  assert.match(executable, /ops_require_interactive_confirmation\s+"ROLLBACK PRODUCTION APP"/);
  assert.match(executable, /ops_apply_compose_app_image/);
  assert.match(executable, /ops_recreate_app_container/);
  assert.match(performBody, /ops_assert_container_image_matches/);
  assert.match(executable, /ops_assess_rollback_migration_risk/);
  assert.match(executable, /ops_check_http_health_production/);
  assert.doesNotMatch(executable, /pg_restore|DROP DATABASE|git reset/);
  assert.doesNotMatch(executable, /db:seed|owner:create/);

  assert.match(
    assertAvailableBody,
    /previous app rollback image is unavailable \(initial deploy or incomplete deploy manifest\)/,
  );
  assert.match(assertAvailableBody, /IS_INITIAL_DEPLOY/);
  assert.match(assertAvailableBody, /APP_IMAGE_ROLLBACK_AVAILABLE/);
  assert.match(assertAvailableBody, /ROLLBACK_IMAGE_TAG/);
  assert.match(assertAvailableBody, /PREVIOUS_APP_IMAGE_ID/);
  assert.match(mainBody, /assert_previous_app_rollback_available/);
  assertIndexOrder(
    mainBody,
    "print_rollback_plan",
    "assert_previous_app_rollback_available",
    "fail-closed before dry-run success or mutate",
  );
  const dryRunExit = mainBody.indexOf('ops_info "Dry-run complete');
  const assertIdx = mainBody.indexOf("assert_previous_app_rollback_available");
  assert.ok(assertIdx >= 0 && dryRunExit > assertIdx, "rollback dry-run must fail-closed before reporting success");
}

function assertManifestSafety(): void {
  const deploy = readFile("scripts/ops/production-deploy.sh");
  const manifestBody = extractFunctionBodies(deploy, "persist_state_manifest");

  assert.match(manifestBody, /ENVIRONMENT=production/);
  assert.match(manifestBody, /IS_INITIAL_DEPLOY=/);
  assert.match(manifestBody, /APP_IMAGE_ROLLBACK_AVAILABLE=/);
  assert.match(manifestBody, /IS_CLEAN_INITIAL_BOOTSTRAP=/);
  assert.match(manifestBody, /POSTGRES_EXISTED_AT_START=/);
  assert.match(manifestBody, /PRE_DEPLOY_BACKUP_APPLICABLE=/);
  assert.match(manifestBody, /GIT_STATUS_STAGE=/);
  assert.match(manifestBody, /BACKUP_STATUS=/);
  assert.match(manifestBody, /POSTGRES_START_STATUS=/);
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
  assert.match(runbook, /Initial deploy/);
  assert.match(runbook, /IS_INITIAL_DEPLOY/);
  assert.match(runbook, /APP_IMAGE_ROLLBACK_AVAILABLE/);
  assert.match(runbook, /IS_CLEAN_INITIAL_BOOTSTRAP|clean initial bootstrap/i);
  assert.match(runbook, /not_applicable_no_database/);
  assert.match(runbook, /previous rollback image отсутствует/i);
}

function assertMigratorProductionSeedRuntime(): void {
  const dockerfile = readFile("Dockerfile");
  const migrator = dockerfile.match(/FROM deps AS migrator[\s\S]*?(?=\nFROM |\z)/)?.[0] ?? "";
  assert.ok(migrator.length > 0, "Dockerfile must define migrator stage");

  const seed = readFile("prisma/seed.production.ts");
  const plan = readFile("prisma/lib/production-seed-plan.ts");
  const seedSources = `${seed}\n${plan}`;

  const atImports = [...seedSources.matchAll(/from\s+["'](@\/[^"']+)["']/g)].map((m) => m[1]!);
  assert.ok(atImports.includes("@/lib/bot-settings/defaults"));
  assert.ok(atImports.includes("@/lib/legal-document/content-hash"));
  assert.ok(atImports.includes("@/lib/legal-document/defaults"));
  assert.ok(atImports.includes("@/lib/studio-settings/defaults"));

  assert.match(migrator, /COPY prisma \.\/prisma/);
  assert.match(migrator, /COPY tsconfig\.json \.\/tsconfig\.json/);
  assert.match(migrator, /COPY src\/lib\/bot-settings\/defaults\.ts \.\/src\/lib\/bot-settings\/defaults\.ts/);
  assert.match(
    migrator,
    /COPY src\/lib\/legal-document\/content-hash\.ts \.\/src\/lib\/legal-document\/content-hash\.ts/,
  );
  assert.match(migrator, /COPY src\/lib\/legal-document\/defaults\.ts \.\/src\/lib\/legal-document\/defaults\.ts/);
  assert.match(
    migrator,
    /COPY src\/lib\/studio-settings\/defaults\.ts \.\/src\/lib\/studio-settings\/defaults\.ts/,
  );
  assert.doesNotMatch(migrator, /COPY src \.\/src\b/);
  assert.doesNotMatch(migrator, /COPY \. \./);
}

function assertMigratorCreateOwnerRuntime(): void {
  const dockerfile = readFile("Dockerfile");
  const migrator = dockerfile.match(/FROM deps AS migrator[\s\S]*?(?=\nFROM |\z)/)?.[0] ?? "";
  assert.ok(migrator.length > 0, "Dockerfile must define migrator stage");

  const createOwner = readFile("scripts/create-owner.ts");
  assert.match(createOwner, /from ["']\.\.\/src\/lib\/auth\/password-policy["']/);
  assert.match(createOwner, /from ["']\.\/lib\/prompt["']/);
  assert.match(createOwner, /from ["']bcryptjs["']/);
  assert.match(createOwner, /from ["']@prisma\/client["']/);

  const passwordPolicy = readFile("src/lib/auth/password-policy.ts");
  assert.doesNotMatch(passwordPolicy, /^import\s/m);

  const prompt = readFile("scripts/lib/prompt.ts");
  assert.match(prompt, /node:readline|node:process/);
  assert.doesNotMatch(prompt, /from ["']@\//);
  assert.doesNotMatch(prompt, /from ["']\.\.\//);

  assert.match(migrator, /COPY scripts\/create-owner\.ts \.\/scripts\/create-owner\.ts/);
  assert.match(migrator, /COPY scripts\/lib\/prompt\.ts \.\/scripts\/lib\/prompt\.ts/);
  assert.match(
    migrator,
    /COPY src\/lib\/auth\/password-policy\.ts \.\/src\/lib\/auth\/password-policy\.ts/,
  );
  assert.doesNotMatch(migrator, /COPY src \.\/src\b/);
  assert.doesNotMatch(migrator, /COPY scripts \.\/scripts\b/);
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
  assertMigratorProductionSeedRuntime();
  assertMigratorCreateOwnerRuntime();
  assertShellSyntax();
  assertHelpWorks();
  console.log("security-production-ops-check: OK");
}

run();
