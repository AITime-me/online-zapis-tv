/**
 * Single-instance topology guards for process-local bot write rate limiter.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as {
  load: (input: string) => unknown;
};

export type TopologyIssue = {
  code: string;
  message: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function collectReplicaValues(node: unknown, out: number[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectReplicaValues(item, out);
    return;
  }
  const rec = asRecord(node);
  if (!rec) return;
  if ("replicas" in rec) {
    const n = Number(rec.replicas);
    if (Number.isFinite(n)) out.push(n);
  }
  if ("scale" in rec) {
    const scale = rec.scale;
    if (typeof scale === "number" && Number.isFinite(scale)) {
      out.push(scale);
    } else if (typeof scale === "object" && scale !== null) {
      for (const v of Object.values(scale as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n)) out.push(n);
      }
    }
  }
  for (const value of Object.values(rec)) {
    collectReplicaValues(value, out);
  }
}

/**
 * Validate compose YAML text for single app-process invariant.
 */
export function validateSingleInstanceCompose(
  composeText: string,
  options?: { appServiceName?: string },
): TopologyIssue[] {
  const issues: TopologyIssue[] = [];
  const appName = options?.appServiceName ?? "app";

  let doc: Record<string, unknown>;
  try {
    doc = yaml.load(composeText) as Record<string, unknown>;
  } catch (error) {
    return [
      {
        code: "COMPOSE_PARSE",
        message: error instanceof Error ? error.message : "parse failed",
      },
    ];
  }

  const services = asRecord(doc.services) ?? {};
  if (!(appName in services)) {
    issues.push({
      code: "MISSING_APP_SERVICE",
      message: `service "${appName}" missing`,
    });
    return issues;
  }

  const replicas: number[] = [];
  collectReplicaValues(services[appName], replicas);
  // Also scan top-level deploy/scale under that service only (already recursive).

  for (const n of replicas) {
    if (n > 1) {
      issues.push({
        code: "REPLICAS_GT_1",
        message: `replicas/scale ${n} > 1 for app service`,
      });
    }
  }

  // Text scan for pm2 / cluster in compose (should not appear for app)
  if (/\bpm2\b/i.test(composeText) && /app:/.test(composeText)) {
    // only fail if pm2 appears near app service block — conservative: any pm2 in file
    issues.push({
      code: "PM2_PRESENT",
      message: "pm2 reference found in compose",
    });
  }

  return issues;
}

export function assertSingleInstanceCompose(
  composeText: string,
  options?: { appServiceName?: string },
): void {
  const issues = validateSingleInstanceCompose(composeText, options);
  assert.equal(
    issues.length,
    0,
    issues.map((i) => `${i.code}: ${i.message}`).join("; "),
  );
}

export function assertNoNodeClusterOrPm2(sourceText: string): void {
  assert.doesNotMatch(
    sourceText,
    /\bpm2\b/i,
    "PM2 must not manage the Next.js app process",
  );
  assert.doesNotMatch(
    sourceText,
    /cluster\.fork\s*\(/,
    "Node cluster.fork must not be used for the app",
  );
  assert.doesNotMatch(
    sourceText,
    /from\s+["']node:cluster["']|require\(["']cluster["']\)/,
    "Node cluster module must not be used for the app",
  );
}

/** Negative fixtures — in-memory only. */
export function composeWithReplicas(baseCompose: string, replicas: number): string {
  const doc = yaml.load(baseCompose) as Record<string, unknown>;
  const services = asRecord(doc.services) ?? {};
  const app = asRecord(services.app);
  if (!app) throw new Error("app service missing in base compose");
  app.deploy = { replicas };
  services.app = app;
  doc.services = services;
  return (require("js-yaml") as { dump: (x: unknown) => string }).dump(doc);
}
