/**
 * Structural validation of CURSOR-24 PostgreSQL Gate workflow.
 * Uses js-yaml (transitive) — no new dependency.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as {
  load: (input: string) => unknown;
  dump: (x: unknown, opts?: Record<string, unknown>) => string;
};

export const BOT_BOOKING_CREATE_CI_WORKFLOW_PATH =
  ".github/workflows/bot-internal-booking-create-pg-gate.yml";

export const BOT_BOOKING_CREATE_CI_JOB_NAME =
  "Internal Bot Booking Create PostgreSQL Gate";

export const BOT_BOOKING_CREATE_REQUIRED_NPM =
  "npm run test:security:bot-internal-booking-create-db:required";

export const BOT_BOOKING_CREATE_REQUIRED_PACKAGE_SCRIPT =
  "test:security:bot-internal-booking-create-db:required";

/** CURSOR-26 required PG gate (same workflow file). */
export const MASTER_COMMAND_REQUIRED_GATE_STEP_NAME =
  "CURSOR-26 required PostgreSQL Gate";

export const MASTER_COMMAND_REQUIRED_NPM =
  "npm run test:security:bot-master-command-db:required";

export const MASTER_COMMAND_REQUIRED_PACKAGE_SCRIPT =
  "test:security:bot-master-command-db:required";

/** BookingRequest contour — static security check in the same PG Gate workflow. */
export const BOOKING_REQUEST_STATIC_GATE_STEP_NAME =
  "BookingRequest unit and security checks";

export const BOOKING_REQUEST_STATIC_NPM =
  "npm run test:security:bot-booking-request";

export const BOOKING_REQUEST_STATIC_PACKAGE_SCRIPT =
  "test:security:bot-booking-request";

/** BookingRequest required PostgreSQL Gate (same workflow file). */
export const BOOKING_REQUEST_REQUIRED_GATE_STEP_NAME =
  "BookingRequest required PostgreSQL Gate";

export const BOOKING_REQUEST_REQUIRED_NPM =
  "npm run test:security:bot-booking-request-db:required";

export const BOOKING_REQUEST_REQUIRED_PACKAGE_SCRIPT =
  "test:security:bot-booking-request-db:required";

/** Paths that must be covered by both pull_request and push filters. */
export const BOT_BOOKING_CREATE_REQUIRED_PATH_TARGETS = [
  {
    file: "docker-compose.production.yml",
    code: "MISSING_PATH_PRODUCTION_COMPOSE",
  },
  {
    file: "docker-compose.staging.yml",
    code: "MISSING_PATH_STAGING_COMPOSE",
  },
  {
    file: "scripts/lib/bot-booking-create-ci-wiring.ts",
    code: "MISSING_PATH_CI_WIRING",
  },
  {
    file: "scripts/lib/bot-booking-create-topology-guard.ts",
    code: "MISSING_PATH_TOPOLOGY_GUARD",
  },
  {
    file: "scripts/lib/bot-booking-create-test-db-guard.ts",
    code: "MISSING_PATH_TEST_DB_GUARD",
  },
  {
    file: "scripts/lib/bot-booking-create-pg-fixture.ts",
    code: "MISSING_PATH_PG_FIXTURE",
  },
] as const;

export type CiWiringIssue = {
  code: string;
  message: string;
};

type WorkflowDoc = {
  name?: string;
  on?: unknown;
  jobs?: Record<string, WorkflowJob>;
};

type WorkflowJob = {
  name?: string;
  "continue-on-error"?: boolean;
  if?: unknown;
  services?: Record<string, WorkflowService>;
  env?: Record<string, string>;
  steps?: WorkflowStep[];
};

type WorkflowService = {
  image?: string;
  options?: string;
  env?: Record<string, string>;
};

type WorkflowStep = {
  name?: string;
  run?: string;
  uses?: string;
  if?: unknown;
  "continue-on-error"?: boolean;
};

export type WorkflowMutation =
  | "remove-health-cmd"
  | "replace-pg-isready"
  | "gate-if-false"
  | "gate-continue-on-error"
  | "gate-nongating-command"
  | "remove-require-postgres"
  | "remove-migrate"
  | "remove-hmac-env"
  | "remove-postgres-service"
  | "remove-gate-step"
  | "gate-echo-required"
  | "gate-comment-only"
  | "gate-false-and-required"
  | "remove-path-production-compose"
  | "remove-path-staging-compose"
  | "remove-path-ci-wiring"
  | "remove-path-topology-guard"
  | "remove-path-test-db-guard"
  | "remove-path-pg-fixture";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function collectEventPaths(on: unknown, event: "pull_request" | "push"): string[] {
  const paths: string[] = [];
  const root = asRecord(on);
  if (!root) return paths;
  const section = asRecord(root[event]);
  if (!section) return paths;
  const list = section.paths;
  if (Array.isArray(list)) {
    for (const item of list) {
      if (typeof item === "string") paths.push(item);
    }
  }
  return paths;
}

function collectOnPaths(on: unknown): string[] {
  return [
    ...collectEventPaths(on, "pull_request"),
    ...collectEventPaths(on, "push"),
  ];
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0DOUBLESTAR\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0DOUBLESTAR\0/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Exact path or covering glob (e.g. scripts/lib/bot-booking-create-*.ts). */
export function pathFilterCoversTarget(
  filters: string[],
  targetFile: string,
): boolean {
  for (const filter of filters) {
    if (filter === targetFile) return true;
    if (filter.includes("*") && globToRegExp(filter).test(targetFile)) {
      return true;
    }
  }
  return false;
}

function stepRunText(step: WorkflowStep): string {
  return typeof step.run === "string" ? step.run : "";
}

function stripShellLineComment(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return "";

  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) {
      return trimmed.slice(0, i).trim();
    }
  }
  return trimmed;
}

function isNeutralShellSetupLine(line: string): boolean {
  if (!line) return true;
  return (
    /^set\s+-[a-zA-Z]+$/.test(line) ||
    /^set\s+-o\s+[a-zA-Z0-9_-]+$/.test(line) ||
    /^set\s+-[a-zA-Z]+\s+-o\s+[a-zA-Z0-9_-]+$/.test(line)
  );
}

/**
 * True only when `run` executes `requiredNpm` as a real command line.
 * Allows preceding neutral `set -e` / `set -o pipefail` lines only.
 */
export function runTextExecutesExactNpmCommand(
  run: string,
  requiredNpm: string,
): boolean {
  if (typeof run !== "string" || !run.trim() || !requiredNpm.trim()) {
    return false;
  }

  const executable: string[] = [];
  for (const raw of run.split(/\r?\n/)) {
    const line = stripShellLineComment(raw);
    if (!line) continue;
    executable.push(line);
  }

  if (executable.length === 0) return false;

  let sawRequired = false;
  for (const line of executable) {
    if (line === requiredNpm) {
      if (sawRequired) return false;
      sawRequired = true;
      continue;
    }
    if (!sawRequired) {
      if (!isNeutralShellSetupLine(line)) return false;
      continue;
    }
    // Nothing after the required command.
    return false;
  }

  return sawRequired;
}

/**
 * True only when `run` executes the CURSOR-24 required npm script as a real command line.
 * Allows preceding neutral `set -e` / `set -o pipefail` lines only.
 */
export function runTextExecutesRequiredGateCommand(run: string): boolean {
  return runTextExecutesExactNpmCommand(run, BOT_BOOKING_CREATE_REQUIRED_NPM);
}

function findGateStep(steps: WorkflowStep[]): WorkflowStep | undefined {
  return steps.find((step) =>
    runTextExecutesRequiredGateCommand(stepRunText(step)),
  );
}

function looksLikeImitationGate(run: string): boolean {
  if (runTextExecutesRequiredGateCommand(run)) return false;
  const body = run
    .split(/\r?\n/)
    .map(stripShellLineComment)
    .filter((line) => line.length > 0)
    .join("\n");
  if (!body) return false;
  return (
    /test:security:bot-internal-booking-create-db:required/.test(body) ||
    (/security-bot-internal-booking-create-db-check/.test(body) &&
      /--require-postgres/.test(body))
  );
}

/**
 * Validate required package.json script (in-memory; does not read disk).
 */
export function validateBotBookingCreateRequiredPackageScript(
  script: string | undefined | null,
): CiWiringIssue[] {
  const issues: CiWiringIssue[] = [];
  if (script == null || !String(script).trim()) {
    issues.push({
      code: "MISSING_REQUIRED_PACKAGE_SCRIPT",
      message: `${BOT_BOOKING_CREATE_REQUIRED_PACKAGE_SCRIPT} missing`,
    });
    return issues;
  }
  const value = String(script).trim();
  if (!/security-bot-internal-booking-create-db-check/.test(value)) {
    issues.push({
      code: "REQUIRED_SCRIPT_WRONG_ENTRY",
      message: "Required script must run security-bot-internal-booking-create-db-check",
    });
  }
  if (!/--require-postgres\b/.test(value)) {
    issues.push({
      code: "MISSING_REQUIRE_FLAG",
      message: "Required package script must pass --require-postgres",
    });
  }
  if (/\|\|\s*true\b/.test(value) || /;\s*true\s*$/.test(value)) {
    issues.push({
      code: "REQUIRED_SCRIPT_ERROR_SUPPRESSED",
      message: "Required package script must not suppress failures",
    });
  }
  return issues;
}

export function assertBotBookingCreateRequiredPackageScript(
  script: string | undefined | null,
): void {
  const issues = validateBotBookingCreateRequiredPackageScript(script);
  assert.equal(
    issues.length,
    0,
    issues.map((i) => `${i.code}: ${i.message}`).join("; "),
  );
}

/**
 * Validate workflow document. Returns issues (empty = OK).
 * Deterministic codes for mutation tests.
 */
export function validateBotBookingCreateCiWiring(
  workflowText: string,
  options?: { packageScript?: string | null },
): CiWiringIssue[] {
  const issues: CiWiringIssue[] = [];
  const push = (code: string, message: string) => {
    issues.push({ code, message });
  };

  let doc: WorkflowDoc;
  try {
    doc = yaml.load(workflowText) as WorkflowDoc;
  } catch (error) {
    push(
      "YAML_PARSE",
      error instanceof Error ? error.message : "YAML parse failed",
    );
    return issues;
  }

  if (!doc || typeof doc !== "object") {
    push("YAML_EMPTY", "Workflow document empty");
    return issues;
  }

  const onRoot = asRecord(doc.on);
  if (!onRoot || !("pull_request" in onRoot)) {
    push("MISSING_PULL_REQUEST", "pull_request trigger missing");
  }
  if (!onRoot || !("push" in onRoot)) {
    push("MISSING_PUSH", "push trigger missing");
  }

  const jobs = doc.jobs ?? {};
  const jobEntry = Object.entries(jobs).find(
    ([, job]) => job?.name === BOT_BOOKING_CREATE_CI_JOB_NAME,
  );
  if (!jobEntry) {
    push(
      "MISSING_JOB",
      `Job named "${BOT_BOOKING_CREATE_CI_JOB_NAME}" not found`,
    );
    return issues;
  }

  const [, job] = jobEntry;
  if (job["continue-on-error"] === true) {
    push("JOB_CONTINUE_ON_ERROR", "Job has continue-on-error: true");
  }
  if (job.if !== undefined) {
    push("JOB_IF", "Job has if-condition that can skip Gate");
  }

  const postgres = job.services?.postgres;
  if (!postgres) {
    push("MISSING_POSTGRES_SERVICE", "services.postgres missing");
  } else {
    if (!postgres.image || !/postgres/i.test(postgres.image)) {
      push("MISSING_POSTGRES_IMAGE", "postgres image missing or invalid");
    }
    const optionsText = postgres.options ?? "";
    if (!/health-cmd/i.test(optionsText)) {
      push("MISSING_HEALTH_CMD", "postgres health-cmd missing");
    }
    if (!/pg_isready/i.test(optionsText)) {
      push("MISSING_PG_ISREADY", "postgres health-cmd must use pg_isready");
    }
    if (!/health-interval/i.test(optionsText)) {
      push("MISSING_HEALTH_INTERVAL", "postgres health-interval missing");
    }
    if (!/health-retries/i.test(optionsText)) {
      push("MISSING_HEALTH_RETRIES", "postgres health-retries missing");
    }
  }

  const env = job.env ?? {};
  if (!env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET) {
    push("MISSING_HMAC_ENV", "BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET missing");
  }
  if (!env.BOT_INTERNAL_API_TOKEN) {
    push("MISSING_BOT_TOKEN_ENV", "BOT_INTERNAL_API_TOKEN missing");
  }
  if (!env.DATABASE_URL) {
    push("MISSING_DATABASE_URL", "DATABASE_URL missing on job");
  }

  const steps = job.steps ?? [];
  if (steps.length === 0) {
    push("MISSING_STEPS", "Job has no steps");
    return issues;
  }

  const runs = steps.map(stepRunText).join("\n");
  if (!/\bnpm ci\b/.test(runs)) {
    push("MISSING_NPM_CI", "npm ci step missing");
  }
  if (!/prisma generate/.test(runs)) {
    push("MISSING_PRISMA_GENERATE", "prisma generate missing");
  }
  if (!/prisma migrate deploy|migrate deploy/.test(runs)) {
    push("MISSING_MIGRATE", "prisma migrate deploy missing");
  }

  const gate = findGateStep(steps);
  if (!gate) {
    const imitation = steps.find((step) =>
      looksLikeImitationGate(stepRunText(step)),
    );
    if (imitation) {
      push(
        "GATE_COMMAND_NOT_EXECUTED",
        "Gate step mentions required command but does not execute it",
      );
    } else {
      push("MISSING_GATE_STEP", "Required PostgreSQL Gate step missing");
    }
  } else {
    if (gate.if !== undefined) {
      push("GATE_STEP_IF", "Gate step must not have if-condition");
    }
    if (gate["continue-on-error"] === true) {
      push("GATE_CONTINUE_ON_ERROR", "Gate step continue-on-error forbidden");
    }
  }

  for (const step of steps) {
    const run = stepRunText(step);
    if (
      /npm run test:security:bot-internal-booking-create-db\s*$/.test(
        run.trim(),
      ) ||
      (/security-bot-internal-booking-create-db-check/.test(run) &&
        !/--require-postgres/.test(run) &&
        !/test:security:bot-internal-booking-create-db:required/.test(run))
    ) {
      if (
        /booking-create-db-check/.test(run) ||
        /booking-create-db(?!:required)/.test(run)
      ) {
        push("NONGATING_DB_STEP", "Non-gating DB check used in workflow");
      }
    }
  }

  const pathFilters = collectOnPaths(doc.on);
  const requiredPathFragments = [
    "prisma/**",
    "BotBookingCreateService",
    "bookings",
    "booking-create",
    "security-bot-internal-booking-create",
    "bot-internal-booking-create-pg-gate.yml",
  ];
  for (const fragment of requiredPathFragments) {
    if (!pathFilters.some((p) => p.includes(fragment.replace("/**", "")))) {
      if (
        fragment === "prisma/**" &&
        pathFilters.some((p) => p.includes("prisma"))
      ) {
        continue;
      }
      if (
        fragment === "bookings" &&
        pathFilters.some((p) => p.includes("bookings"))
      ) {
        continue;
      }
      push("PATH_FILTER_GAP", `Path filters missing coverage for ${fragment}`);
    }
  }

  for (const event of ["pull_request", "push"] as const) {
    const eventPaths = collectEventPaths(doc.on, event);
    for (const target of BOT_BOOKING_CREATE_REQUIRED_PATH_TARGETS) {
      if (!pathFilterCoversTarget(eventPaths, target.file)) {
        push(
          target.code,
          `${event} paths missing coverage for ${target.file}`,
        );
      }
    }
  }

  if (options && "packageScript" in (options ?? {})) {
    for (const issue of validateBotBookingCreateRequiredPackageScript(
      options.packageScript,
    )) {
      issues.push(issue);
    }
  }

  return issues;
}

export function assertBotBookingCreateCiWiring(
  workflowText: string,
  options?: { packageScript?: string | null },
): void {
  const issues = validateBotBookingCreateCiWiring(workflowText, options);
  assert.equal(
    issues.length,
    0,
    issues.map((i) => `${i.code}: ${i.message}`).join("; "),
  );
}

/**
 * Fail-closed: one concrete step must be named CURSOR-26 required gate and
 * actually execute the required npm script (same parsing as C24 wiring).
 * Comments / echo / other steps mentioning the command do not satisfy this.
 */
export function assertMasterCommandRequiredPgGateWired(
  workflowText: string,
): void {
  let doc: WorkflowDoc;
  try {
    doc = yaml.load(workflowText) as WorkflowDoc;
  } catch (error) {
    assert.fail(
      `Master Command CI workflow YAML parse failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const jobs = doc.jobs ?? {};
  const jobEntries = Object.values(jobs);
  assert.ok(jobEntries.length > 0, "workflow has no jobs");

  const steps = jobEntries.flatMap((job) => job.steps ?? []);
  const named = steps.filter(
    (step) => step.name === MASTER_COMMAND_REQUIRED_GATE_STEP_NAME,
  );
  assert.equal(
    named.length,
    1,
    `expected exactly one step named "${MASTER_COMMAND_REQUIRED_GATE_STEP_NAME}", found ${named.length}`,
  );

  const gate = named[0]!;
  assert.equal(
    gate.if,
    undefined,
    "CURSOR-26 required gate step must not have if-condition",
  );
  assert.notEqual(
    gate["continue-on-error"],
    true,
    "CURSOR-26 required gate step continue-on-error forbidden",
  );
  assert.ok(
    runTextExecutesExactNpmCommand(
      stepRunText(gate),
      MASTER_COMMAND_REQUIRED_NPM,
    ),
    `step "${MASTER_COMMAND_REQUIRED_GATE_STEP_NAME}" must execute ${MASTER_COMMAND_REQUIRED_NPM}`,
  );
}

/**
 * Fail-closed: BookingRequest static security step must execute the npm script.
 */
export function assertBookingRequestStaticGateWired(
  workflowText: string,
): void {
  let doc: WorkflowDoc;
  try {
    doc = yaml.load(workflowText) as WorkflowDoc;
  } catch (error) {
    assert.fail(
      `BookingRequest CI workflow YAML parse failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const jobs = doc.jobs ?? {};
  const steps = Object.values(jobs).flatMap((job) => job.steps ?? []);
  const named = steps.filter(
    (step) => step.name === BOOKING_REQUEST_STATIC_GATE_STEP_NAME,
  );
  assert.equal(
    named.length,
    1,
    `expected exactly one step named "${BOOKING_REQUEST_STATIC_GATE_STEP_NAME}", found ${named.length}`,
  );

  const gate = named[0]!;
  assert.equal(
    gate.if,
    undefined,
    "BookingRequest static gate step must not have if-condition",
  );
  assert.notEqual(
    gate["continue-on-error"],
    true,
    "BookingRequest static gate step continue-on-error forbidden",
  );
  assert.ok(
    runTextExecutesExactNpmCommand(
      stepRunText(gate),
      BOOKING_REQUEST_STATIC_NPM,
    ),
    `step "${BOOKING_REQUEST_STATIC_GATE_STEP_NAME}" must execute ${BOOKING_REQUEST_STATIC_NPM}`,
  );
}

/**
 * Fail-closed: BookingRequest required PG gate step must execute the npm script.
 */
export function assertBookingRequestRequiredPgGateWired(
  workflowText: string,
): void {
  let doc: WorkflowDoc;
  try {
    doc = yaml.load(workflowText) as WorkflowDoc;
  } catch (error) {
    assert.fail(
      `BookingRequest CI workflow YAML parse failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const jobs = doc.jobs ?? {};
  const steps = Object.values(jobs).flatMap((job) => job.steps ?? []);
  const named = steps.filter(
    (step) => step.name === BOOKING_REQUEST_REQUIRED_GATE_STEP_NAME,
  );
  assert.equal(
    named.length,
    1,
    `expected exactly one step named "${BOOKING_REQUEST_REQUIRED_GATE_STEP_NAME}", found ${named.length}`,
  );

  const gate = named[0]!;
  assert.equal(
    gate.if,
    undefined,
    "BookingRequest required gate step must not have if-condition",
  );
  assert.notEqual(
    gate["continue-on-error"],
    true,
    "BookingRequest required gate step continue-on-error forbidden",
  );
  assert.ok(
    runTextExecutesExactNpmCommand(
      stepRunText(gate),
      BOOKING_REQUEST_REQUIRED_NPM,
    ),
    `step "${BOOKING_REQUEST_REQUIRED_GATE_STEP_NAME}" must execute ${BOOKING_REQUEST_REQUIRED_NPM}`,
  );
}

function removePathFiltersCovering(doc: WorkflowDoc, targetFile: string): void {
  const on = asRecord(doc.on);
  if (!on) return;
  for (const event of ["pull_request", "push"] as const) {
    const section = asRecord(on[event]);
    if (!section || !Array.isArray(section.paths)) continue;
    section.paths = section.paths.filter(
      (p) => typeof p === "string" && !pathFilterCoversTarget([p], targetFile),
    );
  }
}

function dumpWorkflow(doc: WorkflowDoc): string {
  return yaml.dump(doc, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}

/** In-memory mutations — never writes the real workflow file. */
export function mutateWorkflowText(
  original: string,
  mutation: WorkflowMutation,
): string {
  const doc = yaml.load(original) as WorkflowDoc;
  const jobKey = Object.keys(doc.jobs ?? {}).find(
    (k) => doc.jobs?.[k]?.name === BOT_BOOKING_CREATE_CI_JOB_NAME,
  );
  if (!jobKey || !doc.jobs?.[jobKey]) {
    throw new Error("mutateWorkflowText: job not found");
  }
  const job = doc.jobs[jobKey];

  switch (mutation) {
    case "remove-health-cmd": {
      const pg = job.services?.postgres;
      if (pg?.options) {
        pg.options = pg.options
          .replace(/--health-cmd[^\n]*/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }
      break;
    }
    case "replace-pg-isready": {
      const pg = job.services?.postgres;
      if (pg?.options) {
        pg.options = pg.options.replace(/pg_isready/g, "true");
      }
      break;
    }
    case "gate-if-false": {
      const gate = findGateStep(job.steps ?? []);
      if (gate) gate.if = false;
      break;
    }
    case "gate-continue-on-error": {
      const gate = findGateStep(job.steps ?? []);
      if (gate) gate["continue-on-error"] = true;
      break;
    }
    case "gate-nongating-command": {
      const gate = findGateStep(job.steps ?? []);
      if (gate) {
        gate.run = "npm run test:security:bot-internal-booking-create-db";
        gate.name = "CURSOR-24 non-gating DB";
      }
      break;
    }
    case "remove-require-postgres": {
      const gate = findGateStep(job.steps ?? []);
      if (gate?.run) {
        gate.run = gate.run
          .replace(/\s*--require-postgres\b/, "")
          .replace(
            /test:security:bot-internal-booking-create-db:required/,
            "test:security:bot-internal-booking-create-db",
          );
      }
      break;
    }
    case "remove-migrate": {
      job.steps = (job.steps ?? []).filter(
        (s) => !/migrate deploy/.test(stepRunText(s)),
      );
      break;
    }
    case "remove-hmac-env": {
      if (job.env) {
        delete job.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET;
      }
      break;
    }
    case "remove-postgres-service": {
      if (job.services) {
        delete job.services.postgres;
      }
      break;
    }
    case "remove-gate-step": {
      job.steps = (job.steps ?? []).filter(
        (s) => !runTextExecutesRequiredGateCommand(stepRunText(s)),
      );
      break;
    }
    case "gate-echo-required": {
      const gate = findGateStep(job.steps ?? []);
      if (gate) {
        gate.run = `echo "${BOT_BOOKING_CREATE_REQUIRED_NPM}"`;
      }
      break;
    }
    case "gate-comment-only": {
      const gate = findGateStep(job.steps ?? []);
      if (gate) {
        gate.run = `# ${BOT_BOOKING_CREATE_REQUIRED_NPM}`;
      }
      break;
    }
    case "gate-false-and-required": {
      const gate = findGateStep(job.steps ?? []);
      if (gate) {
        gate.run = `false && ${BOT_BOOKING_CREATE_REQUIRED_NPM}`;
      }
      break;
    }
    case "remove-path-production-compose": {
      removePathFiltersCovering(doc, "docker-compose.production.yml");
      break;
    }
    case "remove-path-staging-compose": {
      removePathFiltersCovering(doc, "docker-compose.staging.yml");
      break;
    }
    case "remove-path-ci-wiring": {
      removePathFiltersCovering(
        doc,
        "scripts/lib/bot-booking-create-ci-wiring.ts",
      );
      break;
    }
    case "remove-path-topology-guard": {
      removePathFiltersCovering(
        doc,
        "scripts/lib/bot-booking-create-topology-guard.ts",
      );
      break;
    }
    case "remove-path-test-db-guard": {
      removePathFiltersCovering(
        doc,
        "scripts/lib/bot-booking-create-test-db-guard.ts",
      );
      break;
    }
    case "remove-path-pg-fixture": {
      removePathFiltersCovering(
        doc,
        "scripts/lib/bot-booking-create-pg-fixture.ts",
      );
      break;
    }
    default:
      throw new Error(`Unknown mutation: ${mutation satisfies never}`);
  }

  return dumpWorkflow(doc);
}

export function assertCiWiringRejectsMutation(
  original: string,
  mutation: WorkflowMutation,
  expectedCode: string,
): void {
  const mutated = mutateWorkflowText(original, mutation);
  const issues = validateBotBookingCreateCiWiring(mutated);
  assert.ok(
    issues.some((i) => i.code === expectedCode),
    `Expected ${expectedCode} for ${mutation}, got: ${issues
      .map((i) => i.code)
      .join(",")}`,
  );
}
