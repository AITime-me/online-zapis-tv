/**
 * Security regression: manage-link hash storage, DTO leak prevention,
 * requestReference hygiene, rate limit / CSRF / browser headers.
 * Без БД и без реальных production-токенов.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildManageUrl,
  createManageToken,
  createPublicRequestReference,
  hashManageToken,
  isManageTokenHash,
  manageTokenRateLimitFingerprint,
} from "../src/lib/booking/manage-token";
import { MANAGE_LINK_INVALID_MESSAGE } from "../src/lib/booking/manage-response";
import { FORBIDDEN_MASTER_APPOINTMENT_KEYS } from "../src/lib/schedule/appointment-contract";
import { resolveApiRateLimitPolicy } from "../src/lib/security/rate-limit/route-rules";
import { getRateLimitPolicy } from "../src/lib/security/rate-limit/policies";
import { assertCsrfRouteCoverage } from "./security-csrf-coverage-check";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertHashMatchesPgcryptoContract(): void {
  const token = createManageToken();
  const hash = hashManageToken(token);
  assert.equal(hash.length, 64);
  assert.ok(isManageTokenHash(hash));
  assert.equal(
    hash,
    createHash("sha256").update(token, "utf8").digest("hex"),
  );
  assert.notEqual(hash, token);
  assert.ok(!hash.includes(token));
}

function assertFingerprintNeverRaw(): void {
  const token = createManageToken();
  const fp = manageTokenRateLimitFingerprint(token);
  assert.equal(fp.length, 32);
  assert.ok(!fp.includes(token));
  assert.notEqual(fp, token);
}

function assertManageUrlOpaque(): void {
  const token = createManageToken();
  const url = buildManageUrl(token);
  assert.equal(url.startsWith("/booking/manage?token="), true);
  assert.ok(!url.includes("@"));
  assert.ok(!/appointmentId|phone|\+7/i.test(url));
}

function assertPublicRequestReferenceIndependent(): void {
  const a = createPublicRequestReference();
  const b = createPublicRequestReference();
  assert.notEqual(a, b);
  assert.equal(a.length, 32);
  assert.ok(/^[a-f0-9]+$/i.test(a));
  const manage = createManageToken();
  assert.notEqual(a, manage);
  assert.notEqual(a, hashManageToken(manage));
}

function assertSchemaAndMigration(): void {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /manageTokenHash\s+String\?\s+@unique\s+@map\("manage_token_hash"\)/);
  assert.match(schema, /manageToken\s+String\?\s+@unique\s+@map\("manage_token"\)/);
  assert.match(schema, /Phase A EXPAND|dual-write/i);

  const migration = read(
    "prisma/migrations/20260718220000_appointment_manage_token_hash/migration.sql",
  );
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pgcrypto/);
  assert.match(migration, /manage_token_hash/);
  assert.match(migration, /encode\(digest\("manage_token", 'sha256'\), 'hex'\)/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "appointments_manage_token_hash_key"/);
  assert.match(migration, /prisma migrate deploy|migrate deploy/i);
  assert.match(migration, /dual-write/i);
  const executable = migration
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(executable, /DROP\s+COLUMN\s+"manage_token"/i);
  assert.doesNotMatch(executable, /SELECT\s+"manage_token"/i);

  const expandDoc = read("docs/architecture/manage-token-expand-contract.md");
  assert.match(expandDoc, /Phase A/);
  assert.match(expandDoc, /Phase B/);
  assert.match(expandDoc, /dual-write/i);
  assert.match(expandDoc, /hash-only/i);
}

/** Phase A: dual-write plaintext + hash; DTO must still omit raw token. */
function assertPhaseADualWrite(): void {
  const source = read("src/services/AppointmentService.ts");
  assert.match(source, /manageTokenHash/);
  assert.match(source, /hashManageToken/);
  assert.match(source, /createPublicRequestReference/);
  assert.match(source, /issuedManageToken/);
  assert.doesNotMatch(source, /requestReference:\s*created\.manageToken/);
  // dual-write both columns from the same issued token
  assert.match(source, /manageToken:\s*issuedManageToken/);
  assert.match(source, /manageTokenHash,/);
  assert.match(source, /Phase A EXPAND dual-write|dual-write/i);
  assert.doesNotMatch(source, /manageToken:\s*null/);
  const dtoMatch = source.match(/export type AppointmentDto = \{([^}]+)\}/);
  assert.ok(dtoMatch, "AppointmentDto type missing");
  assert.doesNotMatch(dtoMatch[1], /manageToken/);
  assert.match(source, /Never log issuedManageToken|hasManageTokenHash/);
}

function assertCreateRouteSingleIssue(): void {
  const source = read("src/app/api/booking/create/route.ts");
  assert.match(source, /issuedManageToken/);
  assert.match(source, /buildManageUrl\(created\.issuedManageToken\)/);
  assert.doesNotMatch(source, /appointment\.manageToken/);
  assert.match(source, /Cache-Control.*no-store|no-store/);
}

/**
 * Dual-read contract:
 * - hash-first (covers hash-only rows after future B1 and backfilled rows)
 * - plaintext fallback (covers pre-expand plaintext-only rows)
 * - rollback path: Phase A dual-write keeps plaintext for old image lookup
 */
function assertDualReadAndRollbackContract(): void {
  const source = read("src/services/BookingManageService.ts");
  const hashIdx = source.indexOf("manageTokenHash: tokenHash");
  const plainIdx = source.indexOf("manageToken: normalizedToken");
  assert.ok(hashIdx > 0, "hash lookup missing");
  assert.ok(plainIdx > 0, "plaintext fallback missing");
  assert.ok(hashIdx < plainIdx, "hash lookup must run before plaintext fallback");
  assert.match(source, /Lazy|legacy|plaintext|dual-write|rollback/i);

  const create = read("src/services/AppointmentService.ts");
  // Emulate rollback: new Phase A row must retain plaintext column for pre-hash app
  assert.match(create, /manageToken:\s*issuedManageToken/);
  assert.match(create, /manageTokenHash/);
}

function assertManageRoutesHardened(): void {
  for (const rel of [
    "src/app/api/booking/manage/route.ts",
    "src/app/api/booking/manage/cancel/route.ts",
    "src/app/api/booking/manage/reschedule-request/route.ts",
  ]) {
    const source = read(rel);
    assert.match(source, /enforceRequestRateLimit/);
    assert.match(source, /manageTokenRateLimitFingerprint|manageUnauthorizedResponse/);
    assert.match(source, /no-store|MANAGE_SECURITY_HEADERS|manageJsonResponse/);
  }

  const cancel = read("src/app/api/booking/manage/cancel/route.ts");
  const reschedule = read(
    "src/app/api/booking/manage/reschedule-request/route.ts",
  );
  assert.match(cancel, /enforceSameOriginForMutatingRequest/);
  assert.match(reschedule, /enforceSameOriginForMutatingRequest/);

  const middleware = read("src/middleware.ts");
  assert.match(middleware, /\/booking\/manage/);
  assert.match(middleware, /Referrer-Policy.*no-referrer|no-referrer/);
  assert.match(middleware, /no-store/);
}

function assertRateLimitPolicyWired(): void {
  assert.equal(
    resolveApiRateLimitPolicy("/api/booking/manage", "GET"),
    "bookingManage",
  );
  assert.equal(
    resolveApiRateLimitPolicy("/api/booking/manage/cancel", "POST"),
    "bookingManage",
  );
  assert.equal(
    resolveApiRateLimitPolicy("/api/booking/manage/reschedule-request", "POST"),
    "bookingManage",
  );
  const policy = getRateLimitPolicy("bookingManage");
  assert.ok(policy.maxRequests >= 10);
  assert.ok(policy.windowMs >= 60_000);
}

function assertForbiddenKeysIncludeHash(): void {
  assert.ok(
    (FORBIDDEN_MASTER_APPOINTMENT_KEYS as readonly string[]).includes(
      "manageToken",
    ),
  );
  assert.ok(
    (FORBIDDEN_MASTER_APPOINTMENT_KEYS as readonly string[]).includes(
      "manageTokenHash",
    ),
  );
}

function assertUniformUnauthorizedMessage(): void {
  assert.equal(typeof MANAGE_LINK_INVALID_MESSAGE, "string");
  assert.ok(MANAGE_LINK_INVALID_MESSAGE.length > 0);
  const manageGet = read("src/app/api/booking/manage/route.ts");
  assert.match(manageGet, /manageUnauthorizedResponse/);
  assert.doesNotMatch(manageGet, /Запись не найдена/);
}

function assertNoAnalyticsOnManagePage(): void {
  const page = read("src/app/booking/manage/page.tsx");
  const client = read("src/components/booking/booking-manage-client.tsx");
  for (const source of [page, client]) {
    assert.doesNotMatch(source, /gtag|googletagmanager|ym\(|metrika|analytics|sentry|posthog/i);
  }
}

function main(): void {
  assertHashMatchesPgcryptoContract();
  assertFingerprintNeverRaw();
  assertManageUrlOpaque();
  assertPublicRequestReferenceIndependent();
  assertSchemaAndMigration();
  assertPhaseADualWrite();
  assertCreateRouteSingleIssue();
  assertDualReadAndRollbackContract();
  assertManageRoutesHardened();
  assertRateLimitPolicyWired();
  assertForbiddenKeysIncludeHash();
  assertUniformUnauthorizedMessage();
  assertNoAnalyticsOnManagePage();
  assertCsrfRouteCoverage();
  console.log("manage-link hardening security checks passed (Phase A expand).");
}

main();
