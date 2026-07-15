import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  classifyPrismaMigrateStatus,
  extractPendingMigrationNames,
  formatMigrateStatusResult,
} from "./ops/lib/prisma-migrate-status";

const ROOT = process.cwd();
const OPS_COMMON_SH = path.join(ROOT, "scripts/ops/lib/staging-ops-common.sh");
const SAMPLE_IMAGE_ID = "f9b62564978b9f008d279bea829cbd32900a2fa66db35b63986250bee8d67caa";
const SAMPLE_IMAGE_ID_SHA256 = `sha256:${SAMPLE_IMAGE_ID}`;

function resolveBashExecutable(): string {
  if (process.platform === "win32") {
    const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
    if (fs.existsSync(gitBash)) {
      return gitBash;
    }
  }
  return "bash";
}

function runOpsNormalizeImageId(options: {
  arg?: string;
  stdin?: string;
  pipeline?: string;
}): { stdout: string; stderr: string; status: number | null } {
  const bash = resolveBashExecutable();
  const commonPath = OPS_COMMON_SH.replace(/\\/g, "/");
  let body: string;
  if (options.pipeline) {
    body = options.pipeline;
  } else if (options.arg !== undefined) {
    body = `result="$(ops_normalize_image_id ${JSON.stringify(options.arg)})"`;
  } else {
    body = `result="$(ops_normalize_image_id)"`;
  }
  const script = `
    set -Eeuo pipefail
    source ${JSON.stringify(commonPath)}
    ${body}
    printf '%s' "$result"
  `;
  const result = spawnSync(bash, ["-c", script], {
    cwd: ROOT,
    input: options.stdin,
    encoding: "utf8",
  });
  return {
    stdout: (result.stdout ?? "").trimEnd(),
    stderr: (result.stderr ?? "").trimEnd(),
    status: result.status,
  };
}

function runOpsNormalizeImageIdExpectFailure(options: {
  arg?: string;
  stdin?: string;
  pipeline?: string;
}): { stderr: string; status: number | null } {
  const run = runOpsNormalizeImageId(options);
  assert.notEqual(run.status, 0, `expected failure for ${JSON.stringify(options)}`);
  return { stderr: run.stderr, status: run.status };
}

function assertNormalizeImageIdBehavior(): void {
  const commonSource = readFile("scripts/ops/lib/staging-ops-common.sh");
  assert.match(commonSource, /ops_normalize_image_id\(\)\s*\{/);
  assert.doesNotMatch(commonSource, /ops_normalize_image_id\(\)[\s\S]*?local image_id="\$1"/);
  assert.match(commonSource, /ops_normalize_image_id\(\)[\s\S]*?\$\# >= 1/);

  assert.equal(
    runOpsNormalizeImageId({ arg: SAMPLE_IMAGE_ID_SHA256 }).stdout,
    SAMPLE_IMAGE_ID,
    "arg sha256:<64 hex>",
  );
  assert.equal(
    runOpsNormalizeImageId({ arg: SAMPLE_IMAGE_ID }).stdout,
    SAMPLE_IMAGE_ID,
    "arg <64 hex>",
  );
  assert.equal(
    runOpsNormalizeImageId({ stdin: `${SAMPLE_IMAGE_ID_SHA256}\n` }).stdout,
    SAMPLE_IMAGE_ID,
    "stdin sha256:<64 hex>",
  );
  assert.equal(
    runOpsNormalizeImageId({ stdin: `${SAMPLE_IMAGE_ID}\n` }).stdout,
    SAMPLE_IMAGE_ID,
    "stdin <64 hex>",
  );

  runOpsNormalizeImageIdExpectFailure({});
  runOpsNormalizeImageIdExpectFailure({ arg: "" });
  runOpsNormalizeImageIdExpectFailure({ stdin: "\n" });
  runOpsNormalizeImageIdExpectFailure({ stdin: `${SAMPLE_IMAGE_ID}\n${SAMPLE_IMAGE_ID}\n` });
  runOpsNormalizeImageIdExpectFailure({ arg: "abc123" });
  runOpsNormalizeImageIdExpectFailure({ arg: "online-zapis-tv-app" });
  runOpsNormalizeImageIdExpectFailure({ arg: `sha256:${SAMPLE_IMAGE_ID}ZZ` });

  const bash = resolveBashExecutable();
  const commonPath = OPS_COMMON_SH.replace(/\\/g, "/");
  const pipelineFail = spawnSync(
    bash,
    [
      "-c",
      `
      set -Eeuo pipefail
      source ${JSON.stringify(commonPath)}
      set +e
      false | ops_normalize_image_id >/dev/null
      printf '%s' "$?"
    `,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(pipelineFail.stdout?.trim(), "1", "upstream pipeline failure must not be masked");

  const pipeSuccess = spawnSync(
    bash,
    [
      "-c",
      `set -Eeuo pipefail; source ${JSON.stringify(commonPath)}; echo ${JSON.stringify(SAMPLE_IMAGE_ID_SHA256)} | ops_normalize_image_id`,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(pipeSuccess.status, 0, `pipeline failed: ${pipeSuccess.stderr}`);
  assert.equal(pipeSuccess.stdout?.trim(), SAMPLE_IMAGE_ID, "pipeline stdin");
}

type VerifyPgDumpMockConfig = {
  dockerCpStatus?: number;
  pgRestoreStatus?: number;
  rmStatus?: number;
};

function runOpsVerifyPgDumpFileMock(config: VerifyPgDumpMockConfig = {}): {
  status: number | null;
  log: string[];
  hostDumpExists: boolean;
} {
  const bash = resolveBashExecutable();
  const commonPath = OPS_COMMON_SH.replace(/\\/g, "/");
  const dockerCpStatus = config.dockerCpStatus ?? 0;
  const pgRestoreStatus = config.pgRestoreStatus ?? 0;
  const rmStatus = config.rmStatus ?? 0;
  const script = `
    set -Eeuo pipefail
    source ${JSON.stringify(commonPath)}
    OPS_DRY_RUN=0
    DOCKER_CP_STATUS=${dockerCpStatus}
    PG_RESTORE_STATUS=${pgRestoreStatus}
    RM_STATUS=${rmStatus}
    declare -a DOCKER_LOG=()
    docker() {
      DOCKER_LOG+=("$*")
      case "$1" in
        cp)
          return "$DOCKER_CP_STATUS"
          ;;
        exec)
          shift
          shift
          if [[ "$1" == "rm" ]]; then
            return "$RM_STATUS"
          fi
          if [[ "$1" == "pg_restore" ]]; then
            return "$PG_RESTORE_STATUS"
          fi
          return 0
          ;;
      esac
      return 0
    }
    HOST_DUMP="$(mktemp)"
    printf 'x' >"$HOST_DUMP"
    set +e
    ops_verify_pg_dump_file "$HOST_DUMP"
    verify_status=$?
    host_dump_exists=0
    [[ -f "$HOST_DUMP" ]] && host_dump_exists=1
    printf 'VERIFY_STATUS=%s\\n' "$verify_status"
    printf 'HOST_DUMP_EXISTS=%s\\n' "$host_dump_exists"
    for entry in "\${DOCKER_LOG[@]}"; do
      printf 'DOCKER_LOG=%s\\n' "$entry"
    done
    rm -f "$HOST_DUMP"
  `;
  const result = spawnSync(bash, ["-c", script], { cwd: ROOT, encoding: "utf8" });
  const log: string[] = [];
  let status: number | null = result.status;
  let hostDumpExists = false;
  for (const line of (result.stdout ?? "").split("\n")) {
    if (line.startsWith("VERIFY_STATUS=")) {
      status = Number(line.slice("VERIFY_STATUS=".length));
    } else if (line.startsWith("HOST_DUMP_EXISTS=")) {
      hostDumpExists = line.slice("HOST_DUMP_EXISTS=".length) === "1";
    } else if (line.startsWith("DOCKER_LOG=")) {
      log.push(line.slice("DOCKER_LOG=".length));
    }
  }
  return { status, log, hostDumpExists };
}

function assertVerifyPgDumpFileBehavior(): void {
  const commonSource = readFile("scripts/ops/lib/staging-ops-common.sh");
  const fnStart = commonSource.indexOf("ops_verify_pg_dump_file()");
  assert.ok(fnStart >= 0, "ops_verify_pg_dump_file must exist");
  const fnSlice = commonSource.slice(fnStart, fnStart + 2200);
  assert.doesNotMatch(fnSlice, /trap\s+\w+\s+RETURN/);
  assert.match(fnSlice, /ops_pg_dump_verify_remove_remote/);
  assert.match(fnSlice, /return "\$status"/);
  assert.match(fnSlice, /pg_restore -l "\$remote_path"/);
  assert.doesNotMatch(fnSlice, /pg_restore -l[^\n]*\|\|\s*true/);
  assert.match(fnSlice, /rm -f -- "\$remote_path"/);

  const success = runOpsVerifyPgDumpFileMock({ dockerCpStatus: 0, pgRestoreStatus: 0 });
  assert.equal(success.status, 0, "successful verify must exit 0");
  assert.equal(success.hostDumpExists, true, "host dump must not be deleted");
  assert.ok(
    success.log.some((entry) => entry.startsWith("cp ") && entry.includes("ops-verify-")),
    "docker cp must use remote verify path",
  );
  assert.ok(
    success.log.some((entry) => entry.includes("pg_restore -l /tmp/ops-verify-")),
    "pg_restore -l must run",
  );
  assert.ok(
    success.log.some((entry) => entry.includes("rm -f -- /tmp/ops-verify-")),
    "remote temp file must be removed on success",
  );

  const cpFail = runOpsVerifyPgDumpFileMock({ dockerCpStatus: 1 });
  assert.notEqual(cpFail.status, 0, "docker cp failure must exit non-zero");
  assert.equal(cpFail.hostDumpExists, true);
  assert.ok(!cpFail.log.some((entry) => entry.includes("pg_restore")), "pg_restore must not run after cp failure");

  const restoreFail = runOpsVerifyPgDumpFileMock({ dockerCpStatus: 0, pgRestoreStatus: 2 });
  assert.equal(restoreFail.status, 2, `pg_restore failure exit code must be preserved (log: ${restoreFail.log.join(" | ")})`);
  assert.ok(
    restoreFail.log.some((entry) => entry.includes("rm -f --")),
    `remote temp file must be removed after pg_restore failure (log: ${restoreFail.log.join(" | ")})`,
  );

  const rmMissing = runOpsVerifyPgDumpFileMock({ dockerCpStatus: 0, pgRestoreStatus: 0, rmStatus: 1 });
  assert.equal(rmMissing.status, 0, "cleanup rm failure must not mask successful verify");
  assert.equal(rmMissing.hostDumpExists, true);

  const first = runOpsVerifyPgDumpFileMock({ dockerCpStatus: 0, pgRestoreStatus: 0 });
  const second = runOpsVerifyPgDumpFileMock({ dockerCpStatus: 0, pgRestoreStatus: 0 });
  assert.equal(first.status, 0);
  assert.equal(second.status, 0, "verify must not recurse via RETURN trap on repeated calls");

  const restoreLog = success.log.find((entry) => entry.includes("pg_restore -l")) ?? "";
  const rmLog = success.log.find((entry) => entry.includes("rm -f --")) ?? "";
  const remotePath = restoreLog.match(/pg_restore -l (\S+)/)?.[1] ?? "";
  assert.ok(remotePath.length > 0);
  assert.match(rmLog, new RegExp(`rm -f -- ${remotePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}


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

function assertOptionalImageLookupBehavior(): void {
  const bash = resolveBashExecutable();
  const commonPath = OPS_COMMON_SH.replace(/\\/g, "/");

  const missing = spawnSync(
    bash,
    [
      "-c",
      `
      set -Eeuo pipefail
      source ${JSON.stringify(commonPath)}
      INSPECT_EXISTS=0
      docker() {
        if [[ "$1" != "image" || "$2" != "inspect" ]]; then
          return 0
        fi
        if [[ "$INSPECT_EXISTS" == "0" ]]; then
          return 1
        fi
        if [[ "$*" == *"--format"* ]]; then
          echo "sha256:${SAMPLE_IMAGE_ID}"
        fi
        return 0
      }
      result="$(ops_get_image_id_from_ref_optional "missing-ref")"
      printf 'RESULT=%s\\n' "$result"
    `,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(missing.status, 0, `missing optional lookup failed: ${missing.stderr}`);
  assert.match(missing.stdout ?? "", /^RESULT=$/m);
  assert.doesNotMatch(`${missing.stdout ?? ""}${missing.stderr ?? ""}`, /empty image id/);

  const existing = spawnSync(
    bash,
    [
      "-c",
      `
      set -Eeuo pipefail
      source ${JSON.stringify(commonPath)}
      INSPECT_EXISTS=1
      docker() {
        if [[ "$1" != "image" || "$2" != "inspect" ]]; then
          return 0
        fi
        if [[ "$INSPECT_EXISTS" == "0" ]]; then
          return 1
        fi
        if [[ "$*" == *"--format"* ]]; then
          echo "sha256:${SAMPLE_IMAGE_ID}"
        fi
        return 0
      }
      result="$(ops_get_image_id_from_ref_optional "present-ref")"
      printf 'RESULT=%s\\n' "$result"
    `,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(existing.status, 0, `existing optional lookup failed: ${existing.stderr}`);
  assert.match(existing.stdout ?? "", new RegExp(`RESULT=${SAMPLE_IMAGE_ID}`));

  const requiredMissing = spawnSync(
    bash,
    [
      "-c",
      `
      set -Eeuo pipefail
      source ${JSON.stringify(commonPath)}
      docker() {
        if [[ "$1" == "image" && "$2" == "inspect" ]]; then
          return 1
        fi
        return 0
      }
      set +e
      ops_get_image_id_from_ref "required-missing" >/dev/null
      printf '%s' "$?"
    `,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.notEqual(requiredMissing.stdout?.trim(), "0", "required lookup must fail when image is missing");

  const deploy = readFile("scripts/ops/staging-deploy.sh");
  assert.match(deploy, /ops_get_image_id_from_ref_optional/);
  assert.match(deploy, /not present locally until build/);
}

function assertMigrationResultStatus(): void {
  const deploy = readFile("scripts/ops/staging-deploy.sh");
  const migrationsBody = extractFunctionBodies(deploy, "run_migrations") || stripBashComments(deploy);

  assert.match(migrationsBody, /migration_action="up_to_date"/);
  assert.match(migrationsBody, /migration_action="applied"/);
  assert.match(migrationsBody, /MIGRATION_STATUS="\$migration_action"/);
  assert.match(migrationsBody, /OPS_LAST_MIGRATE_CLASSIFICATION" == "pending"/);
  assert.doesNotMatch(
    migrationsBody,
    /MIGRATION_STATUS="applied"\s*\n\s*DEPLOY_STATUS="migrations_applied"/,
    "applied must not be unconditional final status",
  );
  assert.match(migrationsBody, /MIGRATION_STATUS="failed"/);
  assert.match(migrationsBody, /MIGRATION_STATUS="dry_run_skipped"/);
  assert.match(deploy, /migration: \$\{MIGRATION_STATUS\}/);
  assert.match(deploy, /"MIGRATION_STATUS=\$\(ops_escape_manifest_value "\$MIGRATION_STATUS"\)"/);
}

function runRestoreDbMock(config: {
  pgRestoreStatus?: number;
  psqlFail?: boolean;
}): { status: number | null; log: string[]; hostBackupExists: boolean } {
  const bash = resolveBashExecutable();
  const commonPath = OPS_COMMON_SH.replace(/\\/g, "/");
  const restoreFn = extractFunctionBodies(readFile("scripts/ops/staging-restore-db.sh"), "restore_database_in_container");
  assert.ok(restoreFn.length > 0, "restore_database_in_container must exist for mock test");

  const pgRestoreStatus = config.pgRestoreStatus ?? 0;
  const psqlFail = config.psqlFail ? 1 : 0;
  const script = `
    set -Eeuo pipefail
    source ${JSON.stringify(commonPath)}
    RESTORE_PG_USER=testuser
    RESTORE_PG_PASSWORD=testpass
    RESTORE_PG_DB=testdb
    PSQL_FAIL=${psqlFail}
    PG_RESTORE_STATUS=${pgRestoreStatus}
    declare -a DOCKER_LOG=()
    docker() {
      DOCKER_LOG+=("$*")
      if [[ "$1" == "cp" ]]; then
        return 0
      fi
      if [[ "$1" != "exec" ]]; then
        return 0
      fi
      if [[ "$*" == *"pg_restore --exit-on-error"* ]]; then
        return "$PG_RESTORE_STATUS"
      fi
      if [[ "$*" == *" rm -f -- "* ]]; then
        return 0
      fi
      if [[ "$PSQL_FAIL" == "1" && "$*" == *"psql"* ]]; then
        return 1
      fi
      return 0
    }
    ${restoreFn}
    HOST_BACKUP="$(mktemp)"
    printf 'host-backup' >"$HOST_BACKUP"
    set +e
    restore_database_in_container "$HOST_BACKUP"
    restore_status=$?
    set +e
    host_backup_exists=0
    [[ -f "$HOST_BACKUP" ]] && host_backup_exists=1
    printf 'RESTORE_STATUS=%s\\n' "$restore_status"
    printf 'HOST_BACKUP_EXISTS=%s\\n' "$host_backup_exists"
    for entry in "\${DOCKER_LOG[@]}"; do
      printf 'DOCKER_LOG=%s\\n' "$entry"
    done
    rm -f "$HOST_BACKUP"
  `;
  const result = spawnSync(bash, ["-c", script], { cwd: ROOT, encoding: "utf8" });
  const log: string[] = [];
  let status: number | null = result.status;
  let hostBackupExists = false;
  for (const line of (result.stdout ?? "").split("\n")) {
    if (line.startsWith("RESTORE_STATUS=")) {
      status = Number(line.slice("RESTORE_STATUS=".length));
    } else if (line.startsWith("HOST_BACKUP_EXISTS=")) {
      hostBackupExists = line.slice("HOST_BACKUP_EXISTS=".length) === "1";
    } else if (line.startsWith("DOCKER_LOG=")) {
      log.push(line.slice("DOCKER_LOG=".length));
    }
  }
  return { status, log, hostBackupExists };
}

function assertRestoreDbCleanupBehavior(): void {
  const restoreSource = readFile("scripts/ops/staging-restore-db.sh");
  const restoreFn = extractFunctionBodies(restoreSource, "restore_database_in_container");
  const restoreMain = extractFunctionBodies(restoreSource, "main") || stripBashComments(restoreSource);

  assert.ok(restoreFn.length > 0);
  assert.doesNotMatch(restoreFn, /trap\s+cleanup_remote\s+RETURN/);
  assert.doesNotMatch(restoreFn, /trap\s+\w+\s+RETURN/);
  assert.match(restoreFn, /ops_restore_remove_remote/);
  assert.match(restoreFn, /pg_restore --exit-on-error/);
  assert.doesNotMatch(restoreFn, /pg_restore[^\n]*\|\|\s*true/);
  assert.match(restoreMain, /if ! restore_database_in_container/);
  assert.ok(
    restoreMain.indexOf("ops_compose up -d") > restoreMain.indexOf("restore_database_in_container"),
    "app must start only after successful restore",
  );

  const success = runRestoreDbMock({ pgRestoreStatus: 0 });
  assert.equal(success.status, 0);
  assert.equal(success.hostBackupExists, true);
  assert.ok(success.log.some((entry) => entry.includes("rm -f -- /tmp/ops-restore-")));
  assert.ok(success.log.some((entry) => entry.includes("pg_restore --exit-on-error")));

  const failure = runRestoreDbMock({ pgRestoreStatus: 3 });
  assert.equal(failure.status, 3);
  assert.equal(failure.hostBackupExists, true);
  assert.ok(failure.log.some((entry) => entry.includes("rm -f -- /tmp/ops-restore-")));

  const psqlFailure = runRestoreDbMock({ psqlFail: true });
  assert.notEqual(psqlFailure.status, 0);
  assert.ok(psqlFailure.log.some((entry) => entry.includes("rm -f -- /tmp/ops-restore-")));

  const restoreLog = success.log.find((entry) => entry.includes("pg_restore --exit-on-error")) ?? "";
  const rmLog = success.log.find((entry) => entry.includes("rm -f --")) ?? "";
  const remotePath = restoreLog.match(/pg_restore --exit-on-error[^\n]* (\S+)$/)?.[1] ?? "";
  if (remotePath.length > 0) {
    assert.match(rmLog, new RegExp(`rm -f -- ${remotePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  }
}

function assertTrapAudit(): void {
  for (const rel of OPS_SHELL_FILES) {
    const source = readFile(rel);
    assert.doesNotMatch(
      source,
      /trap\s+\w+\s+RETURN/,
      `${rel}: RETURN cleanup traps are forbidden`,
    );
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
  assert.match(common, /ops_get_image_id_from_ref_optional/);
  assert.match(common, /STAGING_MIGRATOR_TSX/);
  assert.doesNotMatch(common, /\becho\b[^;\n]*ops_compose[^;\n]*\bconfig\b/);
}

function run(): void {
  assertPrismaMigrateStatusClassifier();
  assertNormalizeImageIdBehavior();
  assertOptionalImageLookupBehavior();
  assertVerifyPgDumpFileBehavior();
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
  assertMigrationResultStatus();
  assertDryRunSkipsMigratorAndClassifier();
  assertRedeployCurrent();
  assertRestoreDbCleanupBehavior();
  assertTrapAudit();
  assertDeployScript();
  assertRollbackScript();
  assertRestoreScript();
  assertManifestSafety();
  assertComposeMigrator();
  assertCommonHelpers();
  console.log("security-staging-ops-check: OK");
}

run();
