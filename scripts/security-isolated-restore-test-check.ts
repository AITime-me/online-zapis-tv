/**
 * Static + executable harness for isolated restore-test.
 * Uses fake docker via PATH; never talks to real Docker/DBs/servers.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();

const SCRIPT = "scripts/ops/isolated-restore-test.sh";
const COMMON = "scripts/ops/lib/isolated-restore-test-common.sh";
const POLICY = "scripts/ops/lib/isolated-restore-test-policy.sh";
const INSTALLER = "scripts/ops/install-isolated-restore-test.sh";
const FAKE_DOCKER = "scripts/ops/lib/fake-docker-irt.sh";
const HARNESS = "scripts/ops/tests/isolated-restore-test-harness.sh";
const IHM_HARNESS = "scripts/ops/tests/ihm-restore-test-evidence-harness.sh";
const IHM = "scripts/ops/internal-health-monitor.sh";
const DOCS = "docs/operations/isolated-restore-test.md";

const UNITS = [
  "deploy/systemd/host/online-zapis-tv-production-restore-test.service",
  "deploy/systemd/host/online-zapis-tv-production-restore-test.timer",
  "deploy/systemd/host/online-zapis-tv-staging-restore-test.service",
  "deploy/systemd/host/online-zapis-tv-staging-restore-test.timer",
] as const;

const REQUIRED = [
  SCRIPT,
  COMMON,
  POLICY,
  INSTALLER,
  FAKE_DOCKER,
  HARNESS,
  IHM_HARNESS,
  DOCS,
  ...UNITS,
] as const;

const FORBIDDEN_CONTAINERS = [
  "tvoe-vremya-production-postgres",
  "tvoe-vremya-staging-postgres",
  "tvoe-vremya-production-app",
  "tvoe-vremya-staging-app",
] as const;

const SECRET_KEYS = [
  "AUTH_SECRET",
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "SMTP_PASSWORD",
  "PGPASSWORD",
  "IRT_TEMP_PASSWORD",
] as const;

type RunResult = { status: number | null; stdout: string; stderr: string };

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

function runBash(
  args: string[],
  env?: NodeJS.ProcessEnv,
  timeoutMs = 120_000,
): RunResult {
  const bash = resolveBashExecutable();
  const result = spawnSync(bash, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function toBashPath(p: string): string {
  if (process.platform !== "win32") {
    return p;
  }
  // Git Bash: C:\foo -> /c/foo
  const normalized = p.replace(/\\/g, "/");
  const m = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!m) {
    return normalized;
  }
  return `/${m[1]!.toLowerCase()}/${m[2]}`;
}

function assertRequiredFiles(): void {
  for (const rel of REQUIRED) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing ${rel}`);
  }
}

function assertIsolationContracts(): void {
  const script = stripBashComments(readFile(SCRIPT));
  const common = stripBashComments(readFile(COMMON));
  const policy = stripBashComments(readFile(POLICY));
  const combined = `${policy}\n${common}\n${script}`;

  assert.match(combined, /--network none/);
  assert.match(combined, /--pull=never/);
  assert.match(combined, /:ro/);
  assert.match(combined, /--pids-limit/);
  assert.match(combined, /flock -n/);
  assert.match(policy, /IRT_DUMP_MAX_AGE_HOURS=36/);
  assert.match(policy, /IRT_SUCCESS_MAX_AGE_HOURS=192/);
  assert.match(policy, /IRT_DUMP_LAG_MAX_HOURS=168/);
  assert.match(common, /isolated-restore-test-policy\.sh/);
  assert.match(combined, /IRT_DOCKER_PIDS_LIMIT=256/);
  assert.match(script, /irt_attempt_finalized_for_run/);
  assert.match(script, /capture_finished_epoch/);
  assert.match(script, /write_emergency_failure_evidence/);
  assert.match(script, /dirname -- "\$resolved"/);
  assert.match(script, /basename -- "\$run_dir"\)" != "\$run_id"/);
  assert.match(script, /basename -- "\$resolved"\)" != "container\.cid"/);
  assert.doesNotMatch(script, /run_dir="\$\(dirname -- "\$cidfile"\)"/);
  assert.match(combined, /postgres:17-alpine/);
  assert.match(combined, /trap finalize_once EXIT/);
  assert.match(combined, /trap on_signal INT TERM/);
  assert.match(combined, /trap on_err ERR/);
  assert.match(combined, /docker rm -f/);
  assert.match(combined, /verify_cleanup_proof/);
  assert.match(combined, /CLEANUP_OK=1/);
  assert.match(combined, /create_dump_snapshot/);
  assert.match(combined, /DUMP_TOCTOU_DETECTED/);
  assert.match(combined, /--cidfile/);
  assert.match(combined, /--emergency-cleanup/);
  assert.match(combined, /--reap-orphans/);
  assert.match(combined, /last-success\.env/);
  assert.match(combined, /last-attempt\.env/);
  assert.match(combined, /irt_write_evidence_file/);
  assert.match(combined, /IRT_PROD_DUMP_DIR/);
  assert.match(combined, /IRT_STAGING_DUMP_DIR/);
  assert.match(combined, /realpath|readlink -f/);
  assert.match(combined, /irt_forbidden_snapshot/);
  assert.doesNotMatch(combined, /docker (stop|restart|kill)\s+tvoe-vremya/);
  assert.doesNotMatch(combined, /--publish|\s-p\s+\d+:\d+/);
  assert.doesNotMatch(combined, /production_internal|staging_internal/);
  assert.doesNotMatch(combined, /postgres_production_data|postgres_staging_data/);
  assert.doesNotMatch(combined, /docker pull/);
  assert.doesNotMatch(combined, /pg_restore[^&\n]*\|/);
  // Must not set CLEANUP_OK=1 unconditionally after rm || true without proof
  assert.doesNotMatch(
    script,
    /docker rm -f[^\n]*\|\| true\n\s*IRT_TEMP_PASSWORD=""\n\s*IRT_CLEANUP_OK=1/,
  );

  for (const name of FORBIDDEN_CONTAINERS) {
    assert.match(common, new RegExp(name.replace(/\./g, "\\.")));
  }

  for (const key of SECRET_KEYS) {
    assert.doesNotMatch(
      script,
      new RegExp(`echo.*${key}`),
      `must not echo ${key}`,
    );
  }
  assert.doesNotMatch(script, /echo.*IRT_TEMP_PASSWORD/);
  assert.doesNotMatch(script, /irt_info.*PASSWORD/);
}

function assertUnits(): void {
  const prodService = readFile(UNITS[0]);
  const prodTimer = readFile(UNITS[1]);
  const stgService = readFile(UNITS[2]);
  const stgTimer = readFile(UNITS[3]);

  assert.match(prodService, /Type=oneshot/);
  assert.match(prodService, /User=deploy/);
  assert.match(prodService, /--environment production/);
  assert.match(prodService, /TimeoutStartSec=1900/);
  assert.match(prodService, /TimeoutStopSec=120/);
  assert.match(prodService, /ExecStopPost=.*--emergency-cleanup/);
  assert.match(prodService, /KillMode=mixed/);
  assert.match(stgService, /--environment staging/);
  assert.match(stgService, /ExecStopPost=.*--emergency-cleanup/);
  assert.match(stgService, /TimeoutStopSec=120/);
  assert.match(prodTimer, /Persistent=true/);
  assert.match(prodTimer, /RandomizedDelaySec=1800/);
  assert.match(prodTimer, /OnCalendar=Sun \*-\*-\* 05:00:00 Asia\/Yekaterinburg/);
  assert.match(stgTimer, /OnCalendar=Sun \*-\*-\* 06:30:00 Asia\/Yekaterinburg/);
  assert.doesNotMatch(prodTimer, /02:30:00/);
  assert.doesNotMatch(stgTimer, /22:15:00/);
  assert.doesNotMatch(prodService, /POSTGRES_PASSWORD|AUTH_SECRET|DATABASE_URL/);
  assert.doesNotMatch(stgService, /POSTGRES_PASSWORD|AUTH_SECRET|DATABASE_URL/);
}

function assertInstaller(): void {
  const src = stripBashComments(readFile(INSTALLER));
  assert.match(src, /--dry-run|--install/);
  assert.match(src, /--enable-timers/);
  assert.match(src, /--enable-enforce/);
  assert.match(src, /--uninstall-units/);
  assert.match(src, /IRT_ENFORCE_MARKER/);
  assert.match(src, /runtime/);
  assert.match(src, /isolated-restore-test-policy\.sh/);
  assert.doesNotMatch(src, /rm -rf.*restore-test/);
  assert.doesNotMatch(src, /rm -rf.*backups/);
  assert.match(src, /evidence retained|Evidence and dumps retained/);
}

function assertIhmIntegration(): void {
  const ihm = stripBashComments(readFile(IHM));
  assert.match(ihm, /isolated-restore-test-policy\.sh/);
  assert.match(ihm, /IRT_SUCCESS_MAX_AGE_HOURS/);
  assert.match(ihm, /IRT_DUMP_LAG_MAX_HOURS/);
  assert.match(ihm, /check_restore_test_evidence "production"/);
  assert.match(ihm, /check_restore_test_evidence "staging"/);
  assert.match(ihm, /ihm_restore_test_enforced/);
  assert.match(ihm, /ihm_validate_referenced_dump/);
  assert.match(ihm, /not_enforced/);
  assert.match(ihm, /RESTORE_TEST_SUCCESS_MISSING/);
  assert.match(ihm, /RESTORE_TEST_STALE/);
  assert.match(ihm, /RESTORE_TEST_DUMP_HASH/);
  assert.match(ihm, /control not enabled/);
  assert.doesNotMatch(ihm, /enforce=off lastSuccess/);
  // No duplicated threshold literals in IHM after policy source.
  assert.doesNotMatch(ihm, /IHM_RESTORE_TEST_MAX_AGE_HOURS\s*=\s*\d+/);
  assert.doesNotMatch(ihm, /IHM_RESTORE_TEST_DUMP_LAG_MAX_HOURS\s*=\s*\d+/);
}

function assertAgeConstantsSynced(): void {
  const policy = readFile(POLICY);
  const common = stripBashComments(readFile(COMMON));
  const ihm = stripBashComments(readFile(IHM));
  assert.match(policy, /IRT_SUCCESS_MAX_AGE_HOURS=192/);
  assert.match(policy, /IRT_DUMP_LAG_MAX_HOURS=168/);
  assert.match(common, /source "\$\{IRT_LIB_DIR\}\/isolated-restore-test-policy\.sh"/);
  assert.match(ihm, /source "\$IHM_IRT_POLICY"/);
  // Threshold integers must live only in the policy file as assignments.
  assert.doesNotMatch(common, /IRT_SUCCESS_MAX_AGE_HOURS=\d+/);
  assert.doesNotMatch(common, /IRT_DUMP_LAG_MAX_HOURS=\d+/);
}

function assertDocs(): void {
  const docs = readFile(DOCS);
  assert.match(docs, /finalize_once|EXIT-финализатор|единый EXIT/);
  assert.match(docs, /ExecStopPost|emergency-cleanup/);
  assert.match(docs, /TimeoutStopSec/);
  assert.match(docs, /cidfile/);
  assert.match(docs, /snapshot|Snapshot/);
  assert.match(docs, /not_enforced/);
  assert.match(docs, /pids-limit|PIDS_LIMIT|256/);
  assert.match(docs, /orphan|reaper/i);
  assert.match(docs, /NOT VERIFIED/);
  assert.match(docs, /PARTIAL/);
  assert.match(docs, /isolated-restore-test-policy\.sh/);
  assert.match(docs, /RUN_ID/);
}

function assertBashSyntax(): void {
  for (const rel of [SCRIPT, COMMON, POLICY, INSTALLER, FAKE_DOCKER, HARNESS, IHM_HARNESS]) {
    const result = runBash(["-n", path.join(ROOT, rel)]);
    assert.equal(result.status, 0, `bash -n failed for ${rel}: ${result.stderr}`);
  }
}

function assertHelp(): void {
  const result = runBash([path.join(ROOT, SCRIPT), "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--environment/);
  assert.match(result.stdout, /network none/);
  assert.match(result.stdout, /emergency-cleanup/);
}

function assertDryRunMissingEnv(): void {
  const result = runBash([path.join(ROOT, SCRIPT), "--dry-run"]);
  assert.equal(result.status, 70);
}

function runBehavioralHarness(): void {
  const harnessPath = toBashPath(path.join(ROOT, HARNESS));
  const result = runBash([harnessPath], undefined, 300_000);
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
  }
  assert.equal(
    result.status,
    0,
    `behavioral harness failed:\n${result.stdout}\n${result.stderr}`,
  );
  assert.match(result.stdout, /PASS success/);
  assert.match(result.stdout, /PASS dump_missing/);
  assert.match(result.stdout, /PASS emergency_cleanup/);
  assert.match(result.stdout, /PASS reaper_old_removed/);
  assert.match(result.stdout, /PASS n01_attempt_run_b/);
  assert.match(result.stdout, /PASS n01_success_unchanged/);
  assert.match(result.stdout, /PASS n01_same_run_attempt_preserved/);
  assert.match(result.stdout, /PASS success_duration/);
  assert.match(result.stdout, /PASS l01_static_resolved_dirname/);
  assert.match(result.stdout, /PASS l01_static_run_dir_contract/);
  assert.match(result.stdout, /PASS l01_snapshot_removed|SKIP l01_symlink_cidfile/);
  // term_interrupt is executed on Linux; may be SKIP on Windows Git Bash
  assert.match(result.stdout, /PASS term_interrupt|SKIP term_interrupt/);
}

function runIhmHarness(): void {
  const harnessPath = toBashPath(path.join(ROOT, IHM_HARNESS));
  const result = runBash([harnessPath], undefined, 180_000);
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
  }
  assert.equal(
    result.status,
    0,
    `IHM restore-test harness failed:\n${result.stdout}\n${result.stderr}`,
  );
  assert.match(result.stdout, /PASS not_enforced_info/);
  assert.match(result.stdout, /PASS healthy_linked/);
  assert.match(result.stdout, /PASS hash_mismatch/);
}

function assertInstallerDryRun(): void {
  const installDry = runBash([path.join(ROOT, INSTALLER)]);
  assert.equal(installDry.status, 0);
  assert.match(installDry.stdout, /DRY-RUN|Dry-run/);
}

function main(): void {
  assertRequiredFiles();
  assertIsolationContracts();
  assertUnits();
  assertInstaller();
  assertIhmIntegration();
  assertAgeConstantsSynced();
  assertDocs();
  assertBashSyntax();
  assertHelp();
  assertDryRunMissingEnv();
  assertInstallerDryRun();
  runBehavioralHarness();
  runIhmHarness();

  console.log("security-isolated-restore-test-check: OK");
}

main();
