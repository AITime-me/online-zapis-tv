/**
 * Behavioral regression for Phase 1 rollback target classification.
 *
 * It executes the real staging/production common helpers in Git Bash with a
 * mocked PostgreSQL command. No Docker daemon or database is contacted.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();

function resolveBashExecutable(): string {
  if (process.platform === "win32") {
    const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
    if (fs.existsSync(gitBash)) {
      return gitBash;
    }
  }
  return "bash";
}

type Capability = "yes" | "no" | "unknown" | "missing";
type AuditMode = "count" | "error" | "malformed";

type Scenario = {
  previousCapability: Capability;
  currentCapability?: "yes" | "no";
  canonicalCount: number;
  auditMode?: AuditMode;
  directPerform?: boolean;
  dryRun?: boolean;
};

type RunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  events: string[];
};

function runScenario(
  commonRelativePath: string,
  scenario: Scenario,
): RunResult {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "full-busy-rollback-"));
  try {
    const manifest = path.join(tempDir, "deploy.env");
    const envFile = path.join(tempDir, "runtime.env");
    const eventsFile = path.join(tempDir, "events.log");
    const manifestLines = [
      `APP_FULL_BUSY_COMPAT=${scenario.currentCapability ?? "yes"}`,
      "CURRENT_APP_FULL_BUSY_COMPAT=yes",
      "CURRENT_APP_COMMIT=compat-current",
      "CURRENT_APP_IMAGE_ID=current-image",
      "PREVIOUS_APP_COMMIT=rollback-target",
      "PREVIOUS_APP_IMAGE_ID=previous-image",
    ];
    if (scenario.previousCapability !== "missing") {
      manifestLines.push(
        `PREVIOUS_APP_FULL_BUSY_COMPAT=${scenario.previousCapability}`,
      );
    }
    fs.writeFileSync(manifest, `${manifestLines.join("\n")}\n`);
    fs.writeFileSync(
      envFile,
      "POSTGRES_USER=test_user\nPOSTGRES_DB=test_db\n",
    );

    const commonPath = path
      .join(ROOT, commonRelativePath)
      .replace(/\\/g, "/");
    const repoRoot = ROOT.replace(/\\/g, "/");
    const script = `
      set -Eeuo pipefail
      source ${JSON.stringify(commonPath)}
      OPS_REPO_ROOT=${JSON.stringify(repoRoot)}
      OPS_DRY_RUN=${scenario.dryRun ? "1" : "0"}
      EVENT_FILE=${JSON.stringify(eventsFile.replace(/\\/g, "/"))}
      AUDIT_MODE=${JSON.stringify(scenario.auditMode ?? "count")}
      CANONICAL_COUNT=${scenario.canonicalCount}

      docker() {
        printf 'audit\\n' >>"$EVENT_FILE"
        case "$AUDIT_MODE" in
          error)
            return 1
            ;;
          malformed)
            printf 'not-a-valid-audit-result\\n'
            return 0
            ;;
          count)
            printf '%s\\t0\\n' "$CANONICAL_COUNT"
            return 0
            ;;
        esac
      }

      confirm() {
        printf 'confirm\\n' >>"$EVENT_FILE"
      }

      perform_rollback() {
        ops_assert_pre_compat_timing_rollback_allowed \
          ${JSON.stringify(envFile.replace(/\\/g, "/"))} \
          compose.yml \
          "\${ROLLBACK_TARGET_FULL_BUSY_COMPAT:-unknown}"
        printf 'perform\\n' >>"$EVENT_FILE"
      }

      ops_resolve_full_busy_rollback_target ${JSON.stringify(manifest.replace(/\\/g, "/"))}
      printf 'classification:%s\\n' "$ROLLBACK_TARGET_FULL_BUSY_COMPAT" >>"$EVENT_FILE"

      if [[ ${scenario.directPerform ? "1" : "0"} -eq 1 ]]; then
        perform_rollback
      else
        ops_assert_pre_compat_timing_rollback_allowed \
          ${JSON.stringify(envFile.replace(/\\/g, "/"))} \
          compose.yml \
          "$ROLLBACK_TARGET_FULL_BUSY_COMPAT"
        confirm
        perform_rollback
      fi
    `;

    const run = spawnSync(resolveBashExecutable(), ["-c", script], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const events = fs.existsSync(eventsFile)
      ? fs
          .readFileSync(eventsFile, "utf8")
          .split(/\r?\n/)
          .filter(Boolean)
      : [];
    return {
      status: run.status,
      stdout: run.stdout ?? "",
      stderr: run.stderr ?? "",
      events,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertBehavior(common: string): void {
  const blocked = runScenario(common, {
    previousCapability: "no",
    canonicalCount: 1,
  });
  assert.notEqual(blocked.status, 0);
  assert.deepEqual(blocked.events, ["classification:no", "audit"]);
  assert.match(blocked.stderr, /pre-compat rollback forbidden/);

  const allowedPreCompat = runScenario(common, {
    previousCapability: "no",
    canonicalCount: 0,
  });
  assert.equal(allowedPreCompat.status, 0, allowedPreCompat.stderr);
  assert.deepEqual(allowedPreCompat.events, [
    "classification:no",
    "audit",
    "confirm",
    "audit",
    "perform",
  ]);

  const allowedCompat = runScenario(common, {
    previousCapability: "yes",
    canonicalCount: 7,
  });
  assert.equal(allowedCompat.status, 0, allowedCompat.stderr);
  assert.deepEqual(allowedCompat.events, [
    "classification:yes",
    "confirm",
    "perform",
  ]);

  const legacyManifest = runScenario(common, {
    previousCapability: "missing",
    currentCapability: "yes",
    canonicalCount: 1,
  });
  assert.notEqual(legacyManifest.status, 0);
  assert.deepEqual(legacyManifest.events, [
    "classification:unknown",
    "audit",
  ]);

  for (const auditMode of ["error", "malformed"] as const) {
    const auditFailure = runScenario(common, {
      previousCapability: "unknown",
      canonicalCount: 0,
      auditMode,
    });
    assert.notEqual(auditFailure.status, 0);
    assert.deepEqual(auditFailure.events, [
      "classification:unknown",
      "audit",
    ]);
  }

  const forbiddenDryRun = runScenario(common, {
    previousCapability: "no",
    canonicalCount: 1,
    dryRun: true,
  });
  assert.notEqual(forbiddenDryRun.status, 0);
  assert.deepEqual(forbiddenDryRun.events, ["classification:no", "audit"]);

  const directPerform = runScenario(common, {
    previousCapability: "no",
    canonicalCount: 1,
    directPerform: true,
  });
  assert.notEqual(directPerform.status, 0);
  assert.deepEqual(directPerform.events, ["classification:no", "audit"]);
}

function assertCommitCapabilityClassification(commonRelativePath: string): void {
  const commonPath = path
    .join(ROOT, commonRelativePath)
    .replace(/\\/g, "/");
  const repoRoot = ROOT.replace(/\\/g, "/");
  const script = `
    set -Eeuo pipefail
    source ${JSON.stringify(commonPath)}
    OPS_REPO_ROOT=${JSON.stringify(repoRoot)}
    printf 'boundary=%s\\n' "$(ops_classify_commit_full_busy_compat "$APPOINTMENT_FULL_BUSY_COMPAT_BOUNDARY_COMMIT")"
    printf 'head=%s\\n' "$(ops_classify_commit_full_busy_compat HEAD)"
    printf 'pre_boundary=%s\\n' "$(ops_classify_commit_full_busy_compat "$APPOINTMENT_FULL_BUSY_COMPAT_BOUNDARY_COMMIT^")"
    printf 'missing=%s\\n' "$(ops_classify_commit_full_busy_compat does-not-exist)"
  `;
  const run = spawnSync(resolveBashExecutable(), ["-c", script], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(
    run.stdout.trim(),
    "boundary=yes\nhead=yes\npre_boundary=no\nmissing=unknown",
  );
}

function assertImageCapabilityClassification(
  commonRelativePath: string,
): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "full-busy-image-"));
  try {
    const explicit = path.join(tempDir, "explicit.env");
    const legacy = path.join(tempDir, "legacy.env");
    const preCompat = path.join(tempDir, "pre-compat.env");
    fs.writeFileSync(
      explicit,
      "CURRENT_APP_IMAGE_ID=image-a\nCURRENT_APP_FULL_BUSY_COMPAT=yes\n",
    );
    fs.writeFileSync(
      legacy,
      "NEW_APP_IMAGE_ID=image-b\nAPP_FULL_BUSY_COMPAT=yes\n",
    );
    fs.writeFileSync(
      preCompat,
      [
        "NEW_APP_IMAGE_ID=image-c",
        "TARGET_COMMIT_SHA=e4ffe96a27af0efc5cd8771618f7ae25144e23c5",
        "",
      ].join("\n"),
    );

    const commonPath = path
      .join(ROOT, commonRelativePath)
      .replace(/\\/g, "/");
    const repoRoot = ROOT.replace(/\\/g, "/");
    const script = `
      set -Eeuo pipefail
      source ${JSON.stringify(commonPath)}
      OPS_REPO_ROOT=${JSON.stringify(repoRoot)}
      printf 'explicit=%s\\n' "$(ops_classify_deployed_image_full_busy_compat image-a ${JSON.stringify(explicit.replace(/\\/g, "/"))})"
      printf 'mismatch=%s\\n' "$(ops_classify_deployed_image_full_busy_compat other-image ${JSON.stringify(explicit.replace(/\\/g, "/"))})"
      printf 'legacy=%s\\n' "$(ops_classify_deployed_image_full_busy_compat image-b ${JSON.stringify(legacy.replace(/\\/g, "/"))})"
      printf 'pre_compat=%s\\n' "$(ops_classify_deployed_image_full_busy_compat image-c ${JSON.stringify(preCompat.replace(/\\/g, "/"))})"
      printf 'missing=%s\\n' "$(ops_classify_deployed_image_full_busy_compat image-a '')"
    `;
    const run = spawnSync(resolveBashExecutable(), ["-c", script], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      run.stdout.trim(),
      "explicit=yes\nmismatch=unknown\nlegacy=yes\npre_compat=no\nmissing=unknown",
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function extractFunction(source: string, functionName: string): string {
  const start = source.indexOf(`${functionName}() {`);
  assert.ok(start >= 0, `missing function ${functionName}`);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated function ${functionName}`);
}

function assertRollbackScriptStructure(file: string): void {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const main = extractFunction(source, "main");
  const perform = extractFunction(source, "perform_rollback");
  const resolveIndex = main.indexOf("ops_resolve_full_busy_rollback_target");
  const guardIndex = main.indexOf(
    "ops_assert_pre_compat_timing_rollback_allowed",
  );
  const confirmIndex = main.indexOf("ops_require_interactive_confirmation");
  const performIndex = main.indexOf("perform_rollback");

  assert.ok(resolveIndex >= 0 && resolveIndex < guardIndex);
  assert.ok(guardIndex < confirmIndex && confirmIndex < performIndex);
  assert.match(
    perform,
    /ops_assert_pre_compat_timing_rollback_allowed[\s\S]*ROLLBACK_TARGET_FULL_BUSY_COMPAT/,
  );
  assert.match(
    main,
    /ops_assert_pre_compat_timing_rollback_allowed[\s\S]{0,200}ROLLBACK_TARGET_FULL_BUSY_COMPAT/,
  );
  assert.match(perform, /expected_image_id="\$\{ROLLBACK_TARGET_IMAGE_ID:-\}"/);
}

function assertDeployManifestSemantics(file: string): void {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const automaticRollback = extractFunction(source, "rollback_app_image");
  for (const field of [
    "CURRENT_APP_IMAGE_ID",
    "CURRENT_APP_COMMIT",
    "CURRENT_APP_FULL_BUSY_COMPAT",
    "PREVIOUS_APP_IMAGE_ID",
    "PREVIOUS_APP_COMMIT",
    "PREVIOUS_APP_FULL_BUSY_COMPAT",
  ]) {
    assert.match(source, new RegExp(`"${field}=`), `${file}: ${field}`);
  }
  assert.match(
    source,
    /ops_resolve_deployed_image_full_busy_metadata[\s\S]{0,200}"\$PREVIOUS_APP_IMAGE_ID"/,
  );
  assert.match(
    source,
    /CURRENT_APP_FULL_BUSY_COMPAT="\$\(\s*ops_classify_commit_full_busy_compat "\$TARGET_COMMIT_SHA"/,
  );
  assert.match(
    source,
    /APP_FULL_BUSY_COMPAT=.*CURRENT_APP_FULL_BUSY_COMPAT/,
  );
  assert.match(
    source,
    /"PREVIOUS_APP_COMMIT=.*\$PREVIOUS_APP_COMMIT/,
  );
  assert.match(
    automaticRollback,
    /ops_assert_pre_compat_timing_rollback_allowed[\s\S]{0,200}PREVIOUS_APP_FULL_BUSY_COMPAT/,
  );
  assert.match(automaticRollback, /APP_ROLLBACK_STATUS="blocked_timing_guard"/);
}

for (const common of [
  "scripts/ops/lib/staging-ops-common.sh",
  "scripts/ops/lib/production-ops-common.sh",
]) {
  assertBehavior(common);
  assertCommitCapabilityClassification(common);
  assertImageCapabilityClassification(common);
}

for (const rollback of [
  "scripts/ops/staging-rollback-app.sh",
  "scripts/ops/production-rollback-app.sh",
]) {
  assertRollbackScriptStructure(rollback);
}

for (const deploy of [
  "scripts/ops/staging-deploy.sh",
  "scripts/ops/production-deploy.sh",
]) {
  assertDeployManifestSemantics(deploy);
}

console.log("security-appointment-full-busy-rollback-check: OK");
