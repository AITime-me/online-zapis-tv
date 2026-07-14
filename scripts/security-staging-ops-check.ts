import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  classifyPrismaMigrateStatus,
  extractPendingMigrationNames,
  formatMigrateStatusResult,
} from "./ops/lib/prisma-migrate-status";

const ROOT = process.cwd();

const OPS_SHELL_FILES = [
  "scripts/ops/staging-deploy.sh",
  "scripts/ops/staging-rollback-app.sh",
  "scripts/ops/staging-restore-db.sh",
  "scripts/ops/lib/staging-ops-common.sh",
] as const;

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp; files?: readonly string[] }> = [
  { name: "set -x", pattern: /^\s*set\s+-x/m },
  { name: "docker compose down", pattern: /docker\s+compose\b[^;\n]*\bdown\b/ },
  { name: "docker system prune", pattern: /docker\s+system\s+prune/ },
  { name: "docker image prune", pattern: /docker\s+image\s+prune/ },
  { name: "volume removal", pattern: /docker\s+volume\s+rm|compose\b[^;\n]*-v\b/ },
  { name: "git reset --hard", pattern: /git\s+reset\s+--hard/ },
  { name: "git clean -fd", pattern: /git\s+clean\s+-fd/ },
  { name: "prisma migrate reset", pattern: /prisma\s+migrate\s+reset/ },
  { name: "prisma db push", pattern: /prisma\s+db\s+push/ },
  { name: "prisma migrate dev", pattern: /prisma\s+migrate\s+dev/ },
  { name: "_prisma_migrations deletion", pattern: /_prisma_migrations/ },
  { name: "cat .env.staging", pattern: /\bcat\b[^;\n]*\.env\.staging/ },
  { name: "source .env.staging", pattern: /\bsource\b[^;\n]*\.env\.staging/ },
  { name: ". env.staging", pattern: /^\s*\.\s+\.env\.staging/m },
  {
    name: "host npx tsx classifier",
    pattern: /\bnpx\s+tsx\b/,
    files: OPS_SHELL_FILES,
  },
  {
    name: "host node classifier",
    pattern: /\bnode\b[^;\n]*classify-migrate-status/,
    files: OPS_SHELL_FILES,
  },
  {
    name: "host npm exec",
    pattern: /\bnpm\s+exec\b/,
    files: OPS_SHELL_FILES,
  },
  {
    name: "host npx prerequisite check",
    pattern: /command\s+-v\s+npx\b/,
    files: OPS_SHELL_FILES,
  },
];

const SECRET_MANIFEST_KEYS = [
  "AUTH_SECRET",
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "SMTP_PASSWORD",
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

function assertPrismaMigrateStatusClassifier(): void {
  const upToDateOutput = `3 migrations found in prisma/migrations\n\nDatabase schema is up to date!`;
  assert.deepEqual(classifyPrismaMigrateStatus(0, upToDateOutput), { kind: "up_to_date" });

  const pendingOutput = `3 migrations found in prisma/migrations\nFollowing migrations have not yet been applied:\n20260714120000_login_throttle_entries\n20260715000000_example\n\nTo apply migrations in production run prisma migrate deploy.`;
  const pending = classifyPrismaMigrateStatus(1, pendingOutput);
  assert.equal(pending.kind, "pending");
  if (pending.kind === "pending") {
    assert.deepEqual(pending.migrationNames, [
      "20260714120000_login_throttle_entries",
      "20260715000000_example",
    ]);
    assert.equal(formatMigrateStatusResult(pending), "pending");
  }

  const connectionOutput = `Error: P1001: Can't reach database server at postgres:5432`;
  const connection = classifyPrismaMigrateStatus(1, connectionOutput);
  assert.equal(connection.kind, "error");
  if (connection.kind === "error") {
    assert.equal(connection.reason, "connection");
  }

  const divergedOutput = `Your local migration history and the migrations table from your database are different:\nThe last common migration is: abc`;
  const diverged = classifyPrismaMigrateStatus(1, divergedOutput);
  assert.equal(diverged.kind, "error");
  if (diverged.kind === "error") {
    assert.equal(diverged.reason, "diverged");
  }

  const failedOutput = `Following migrations have failed:\n20260714120000_login_throttle_entries`;
  const failed = classifyPrismaMigrateStatus(1, failedOutput);
  assert.equal(failed.kind, "error");
  if (failed.kind === "error") {
    assert.equal(failed.reason, "failed");
  }

  const unknownOutput = `Something unexpected happened without known markers`;
  const unknown = classifyPrismaMigrateStatus(1, unknownOutput);
  assert.equal(unknown.kind, "error");
  if (unknown.kind === "error") {
    assert.equal(unknown.reason, "unknown");
  }

  const pendingWithoutNames = `Following migrations have not yet been applied:\n\nTo apply migrations in production run prisma migrate deploy.`;
  const pendingInvalid = classifyPrismaMigrateStatus(1, pendingWithoutNames);
  assert.equal(pendingInvalid.kind, "error");
  if (pendingInvalid.kind === "error") {
    assert.equal(pendingInvalid.reason, "unknown");
  }

  assert.deepEqual(extractPendingMigrationNames(pendingOutput), [
    "20260714120000_login_throttle_entries",
    "20260715000000_example",
  ]);
}

function assertShellBasics(): void {
  for (const rel of OPS_SHELL_FILES) {
    const source = readFile(rel);
    assert.match(source, /^#!\/usr\/bin\/env bash/m, `${rel}: bash shebang required`);
    if (rel !== "scripts/ops/lib/staging-ops-common.sh") {
      assert.match(source, /set -Eeuo pipefail/, `${rel}: must use set -Eeuo pipefail`);
      assert.doesNotMatch(source, /^\s*set\s+-x/m, `${rel}: must not enable xtrace`);
    }
  }
}

function assertForbiddenPatterns(): void {
  for (const rel of OPS_SHELL_FILES) {
    const executable = stripBashComments(readFile(rel));
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.files && !rule.files.includes(rel)) {
        continue;
      }
      assert.doesNotMatch(
        executable,
        rule.pattern,
        `${rel}: forbidden pattern (${rule.name})`,
      );
    }
  }
}

function assertRedeployCurrent(): void {
  const source = readFile("scripts/ops/staging-deploy.sh");
  const executable = stripBashComments(source);
  const mainBody = extractFunctionBodies(source, "main") || executable;
  const fetchBody = extractFunctionBodies(source, "fetch_and_plan_git");
  const ffBody = extractFunctionBodies(source, "fast_forward_git");
  const manifestBody = extractFunctionBodies(source, "persist_state_manifest");

  assert.match(source, /--redeploy-current/);
  assert.match(source, /DEPLOY_MODE/);
  assert.match(manifestBody, /DEPLOY_MODE=/);
  assert.match(fetchBody, /no new commits to deploy; refusing no-op deploy/);
  assert.match(fetchBody, /--redeploy-current if you need to rebuild/);
  assert.match(fetchBody, /DEPLOY_REDEPLOY_CURRENT/);
  assert.match(fetchBody, /origin\/main has new commits; use normal deploy without --redeploy-current/);
  assert.doesNotMatch(source, /--force\b/);

  assert.match(executable, /collect_app_image_state/);
  assert.match(executable, /ops_get_container_image_id/);
  assert.match(executable, /ops_get_container_image_reference/);
  assert.match(source, /legacy or stale image reference is expected/);
  assert.match(ffBody, /DEPLOY_REDEPLOY_CURRENT/);
  assert.doesNotMatch(mainBody, /git merge.*DEPLOY_REDEPLOY_CURRENT/);

  const dryRunExit = mainBody.indexOf('ops_info "Dry-run complete');
  for (const token of [
    "ops_create_postgres_backup",
    "init_state_manifest",
    "build_images",
    "run_migrations",
    "restart_app_only",
    "fast_forward_git",
  ]) {
    const idx = mainBody.indexOf(token);
    if (idx >= 0 && dryRunExit >= 0) {
      assert.ok(dryRunExit < idx, `dry-run must exit before ${token}`);
    }
  }

  assert.match(mainBody, /DEPLOY_REDEPLOY_CURRENT.*collect_app_image_state|collect_app_image_state[\s\S]*Dry-run complete/s);

  assert.match(executable, /ops_require_interactive_confirmation\s+"DEPLOY"/);
  assert.doesNotMatch(
    stripBashComments(readFile("scripts/ops/staging-rollback-app.sh")),
    /redeploy-current|--redeploy-current/,
  );
  assert.doesNotMatch(
    stripBashComments(readFile("scripts/ops/staging-restore-db.sh")),
    /redeploy-current|--redeploy-current/,
  );
  assert.doesNotMatch(executable, /pg_restore|staging-restore-db/);
  assert.doesNotMatch(executable, /compose\s+stop\s+postgres|restart\s+postgres/);
}

function assertDeployScript(): void {
  const source = readFile("scripts/ops/staging-deploy.sh");
  const executable = stripBashComments(source);
  const mainBody = extractFunctionBodies(source, "main") || executable;
  const migrationsBody = extractFunctionBodies(source, "run_migrations");

  assert.match(source, /flock/, "deploy must use flock");
  assert.match(executable, /ops_require_interactive_confirmation\s+"DEPLOY"/);
  assert.match(executable, /ops_compose_preflight/, "deploy must run compose preflight");
  assert.match(executable, /ops_require_commands git docker flock curl/);
  assert.match(executable, /ops_run_prisma_migrate_status\s+"pre"/);
  assert.match(executable, /ops_run_prisma_migrate_status\s+"post"/);
  assert.doesNotMatch(migrationsBody, /\|\|\s*true/, "migrate status must not be masked with || true");

  assertIndexOrder(mainBody, "ops_create_postgres_backup", "prepare_rollback_tag", "backup before rollback tag");
  assertIndexOrder(mainBody, "prepare_rollback_tag", "init_state_manifest", "rollback tag before initial manifest");
  assertIndexOrder(mainBody, "init_state_manifest", "build_images", "initial manifest before image build");
  assertIndexOrder(mainBody, "build_images", "run_migrations", "build before migrations");
  assertIndexOrder(mainBody, "run_migrations", "restart_app_only", "migrations before app restart");

  assert.match(executable, /ops_apply_compose_app_image/, "rollback must retag compose app image");
  assert.match(executable, /ops_recreate_app_container/, "rollback must recreate app without rebuild");
  assert.match(executable, /ops_assert_container_image_matches/, "rollback must verify container image id");
  assert.match(executable, /persist_state_manifest/, "deploy must update manifest incrementally");
  assert.match(executable, /LAST_ERROR_SUMMARY/, "failed deploy must preserve error summary");
  assert.match(executable, /ops_assert_container_image_matches/, "rollback must verify container image id after rollback");
}

function assertRollbackScript(): void {
  const source = readFile("scripts/ops/staging-rollback-app.sh");
  const executable = stripBashComments(source);
  const performBody = extractFunctionBodies(source, "perform_rollback");

  assert.match(executable, /ops_apply_compose_app_image/);
  assert.match(executable, /ops_recreate_app_container/);
  assert.match(performBody, /ops_assert_container_image_matches/);
  assert.match(stripBashComments(readFile("scripts/ops/lib/staging-ops-common.sh")), /--no-build/);
  assert.doesNotMatch(executable, /pg_restore|DROP DATABASE/);
}

function assertRestoreScript(): void {
  const source = readFile("scripts/ops/staging-restore-db.sh");
  const executable = stripBashComments(source);
  const restoreBody = extractFunctionBodies(source, "restore_database_in_container");

  assert.match(executable, /ops_validate_postgres_identifier/);
  assert.match(restoreBody, /-d postgres/);
  assert.match(restoreBody, /pg_terminate_backend/);
  assert.match(restoreBody, /DROP DATABASE IF EXISTS/);
  assert.match(restoreBody, /CREATE DATABASE .* OWNER/);
  assert.match(restoreBody, /pg_restore --exit-on-error/);
  assert.match(executable, /ops_compose stop app/);
  assert.doesNotMatch(executable, /compose\s+down/);
}

function assertManifestSafety(): void {
  const deploy = readFile("scripts/ops/staging-deploy.sh");
  const common = readFile("scripts/ops/lib/staging-ops-common.sh");
  const manifestWriters = extractFunctionBodies(deploy, "persist_state_manifest");

  for (const secret of SECRET_MANIFEST_KEYS) {
    assert.doesNotMatch(
      manifestWriters,
      new RegExp(`\\b${secret}=`, "i"),
      `manifest writer must not store ${secret}`,
    );
  }

  assert.match(common, /ops_write_manifest_file/);
  assert.match(common, /ops_read_manifest_value/);
}

function assertComposeMigrator(): void {
  const compose = readFile("docker-compose.staging.yml");
  const dockerfile = readFile("Dockerfile");

  assert.match(compose, /image:\s*online-zapis-tv-staging-app:current/);
  assert.match(dockerfile, /FROM deps AS migrator/);

  const migratorService =
    compose.match(/\r?\n  migrator:\r?\n[\s\S]*?(?=\r?\n  [a-z_]+:|\r?\nnetworks:)/)?.[0] ?? "";
  assert.ok(migratorService.length > 0, "migrator service must exist in compose");
  assert.doesNotMatch(migratorService, /^\s*ports:/m, "migrator must not publish ports");
  assert.match(migratorService, /profiles:/);
  assert.match(migratorService, /ops/);
}

function assertNoHostNodePrerequisites(): void {
  const hostNodeCommands = ["node", "npm", "npx"] as const;

  for (const rel of OPS_SHELL_FILES) {
    const executable = stripBashComments(readFile(rel));
    const requireMatch = executable.match(/ops_require_commands\s+([^;\n]+)/g) ?? [];
    for (const call of requireMatch) {
      for (const cmd of hostNodeCommands) {
        assert.doesNotMatch(
          call,
          new RegExp(`\\b${cmd}\\b`),
          `${rel}: ops_require_commands must not require host ${cmd}`,
        );
      }
    }
  }
}

function assertHostNodeNotInHelpOrErrors(): void {
  for (const rel of OPS_SHELL_FILES) {
    const source = readFile(rel);
    assert.doesNotMatch(source, /missing required commands:[^\n]*\bnpx\b/);
    assert.doesNotMatch(source, /Requires:[^\n]*\bnpx\b/);
    assert.doesNotMatch(source, /requires host npx/i);
  }
}

function assertClassifierRunsInMigrator(): void {
  const classifyBody = extractFunctionBodies(readFile("scripts/ops/lib/staging-ops-common.sh"), "ops_classify_prisma_migrate_output");

  assert.match(classifyBody, /ops_compose\b[^}]*--profile ops run/);
  assert.match(classifyBody, /--entrypoint\s+"\$STAGING_MIGRATOR_TSX"/);
  assert.match(classifyBody, /STAGING_CLASSIFIER_CLI/);
  assert.match(classifyBody, /--no-TTY -i\b|--no-TTY\s+-i\b/);
  assert.match(classifyBody, /<\s*"\$output_file"/);
  assert.doesNotMatch(classifyBody, /\bnpx\b/);
  assert.doesNotMatch(classifyBody, /\bnode\b/);

  const migrateBody = extractFunctionBodies(readFile("scripts/ops/lib/staging-ops-common.sh"), "ops_run_prisma_migrate_status");
  const commonExecutable = stripBashComments(readFile("scripts/ops/lib/staging-ops-common.sh"));
  assert.match(commonExecutable, /ops_compose[^;\n]*migrator migrate status/);
  assert.doesNotMatch(classifyBody, /\bnpx\b/);
  assert.doesNotMatch(migrateBody || commonExecutable, /\bnpx\b/);
  assert.match(readFile("scripts/ops/lib/staging-ops-common.sh"), /readonly STAGING_MIGRATOR_PRISMA="\/app\/node_modules\/\.bin\/prisma"/);
}

function assertMigratorImageContainsClassifier(): void {
  const dockerfile = readFile("Dockerfile");
  const migratorBlock = dockerfile.match(/FROM deps AS migrator[\s\S]*?(?=\nFROM |\n# |\z)/)?.[0] ?? "";
  assert.ok(migratorBlock.length > 0, "migrator target must exist");
  assert.match(migratorBlock, /COPY scripts\/ops\/lib\/prisma-migrate-status\.ts/);
  assert.match(migratorBlock, /COPY scripts\/ops\/lib\/classify-migrate-status-cli\.ts/);
  assert.doesNotMatch(migratorBlock, /\.env/);
}

function assertMigratorUsesLocalBinariesOnly(): void {
  const compose = readFile("docker-compose.staging.yml");
  const migratorService =
    compose.match(/\r?\n  migrator:\r?\n[\s\S]*?(?=\r?\n  [a-z_]+:|\r?\nnetworks:)/)?.[0] ?? "";
  assert.match(migratorService, /entrypoint:\s*\["\/app\/node_modules\/\.bin\/prisma"\]/);
  assert.doesNotMatch(migratorService, /\bnpx\b/);
}

function assertClassifierCliReadsStdin(): void {
  const cli = readFile("scripts/ops/lib/classify-migrate-status-cli.ts");
  assert.match(cli, /readFileSync\(0/);
  assert.doesNotMatch(cli, /process\.argv\[3\]/);
}

function assertRollbackRestoreSkipClassifier(): void {
  for (const rel of ["scripts/ops/staging-rollback-app.sh", "scripts/ops/staging-restore-db.sh"] as const) {
    const executable = stripBashComments(readFile(rel));
    assert.doesNotMatch(executable, /ops_classify_prisma_migrate_output/);
    assert.doesNotMatch(executable, /ops_run_prisma_migrate_status/);
    assert.doesNotMatch(executable, /--profile ops run[^;\n]*migrator/);
  }
}

function assertMigrationFlowSemantics(): void {
  const common = readFile("scripts/ops/lib/staging-ops-common.sh");
  const commonExecutable = stripBashComments(common);
  const migrateStatusBody = extractFunctionBodies(common, "ops_run_prisma_migrate_status") || commonExecutable;
  const migrationsBody = extractFunctionBodies(readFile("scripts/ops/staging-deploy.sh"), "run_migrations");

  assert.match(migrateStatusBody, /pending\)/);
  assert.match(migrateStatusBody, /phase" == "post"/);
  assert.match(migrateStatusBody, /error:\*/);
  assert.match(migrationsBody, /migrate deploy/);
  assert.match(migrationsBody, /OPS_LAST_MIGRATE_CLASSIFICATION" == "pending"/);
  assertIndexOrder(migrationsBody, 'ops_run_prisma_migrate_status "pre"', "migrate deploy", "deploy after pre-status");
  assertIndexOrder(migrationsBody, "migrate deploy", 'ops_run_prisma_migrate_status "post"', "post-status after deploy");

  const classifierOutput = formatMigrateStatusResult({ kind: "up_to_date" });
  assert.equal(classifierOutput, "up_to_date");
  for (const secret of SECRET_MANIFEST_KEYS) {
    assert.doesNotMatch(classifierOutput, new RegExp(secret, "i"));
  }
}

function assertDryRunSkipsMigratorAndClassifier(): void {
  const deploy = readFile("scripts/ops/staging-deploy.sh");
  const mainBody = extractFunctionBodies(deploy, "main");
  const migrationsBody = extractFunctionBodies(deploy, "run_migrations");
  const dryRunExit = mainBody.indexOf('ops_info "Dry-run complete');

  for (const token of [
    "ops_create_postgres_backup",
    "init_state_manifest",
    "build_images",
    "run_migrations",
    "restart_app_only",
  ]) {
    const idx = mainBody.indexOf(token);
    if (idx >= 0) {
      assert.ok(dryRunExit >= 0 && dryRunExit < idx, `dry-run must exit before ${token}`);
    }
  }

  assert.match(migrationsBody, /OPS_DRY_RUN/);
  assert.doesNotMatch(migrationsBody, /ops_classify_prisma_migrate_output/);
}

function assertCommonHelpers(): void {
  const common = stripBashComments(readFile("scripts/ops/lib/staging-ops-common.sh"));
  assert.match(common, /ops_compose_preflight/);
  assert.match(common, /config --quiet/);
  assert.match(common, /ops_classify_prisma_migrate_output/);
  assert.match(common, /classify-migrate-status-cli\.ts/);
  assert.match(common, /STAGING_APP_IMAGE_REF/);
  assert.match(common, /STAGING_MIGRATOR_TSX/);
  assert.doesNotMatch(common, /\becho\b[^;\n]*ops_compose[^;\n]*\bconfig\b/);
}

function run(): void {
  assertPrismaMigrateStatusClassifier();
  assertShellBasics();
  assertForbiddenPatterns();
  assertNoHostNodePrerequisites();
  assertHostNodeNotInHelpOrErrors();
  assertClassifierRunsInMigrator();
  assertMigratorImageContainsClassifier();
  assertMigratorUsesLocalBinariesOnly();
  assertClassifierCliReadsStdin();
  assertRollbackRestoreSkipClassifier();
  assertMigrationFlowSemantics();
  assertDryRunSkipsMigratorAndClassifier();
  assertRedeployCurrent();
  assertDeployScript();
  assertRollbackScript();
  assertRestoreScript();
  assertManifestSafety();
  assertComposeMigrator();
  assertCommonHelpers();
  console.log("security-staging-ops-check: OK");
}

run();
