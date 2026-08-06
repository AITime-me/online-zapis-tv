/**
 * Статический аудит: атомарная запись appointment против TOCTOU double-booking.
 */
process.env.SECURITY_BATCH_TEST = "1";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/tvoe_vremya_security_batch";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { installServerOnlyShimForSecurityScripts } from "./lib/stub-server-only";

installServerOnlyShimForSecurityScripts();

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function makeKnownRequestError(
  code: string,
  meta?: Record<string, unknown>,
  message = "test prisma error",
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: "6.19.0",
    meta,
  });
}

async function testSerializationFailureClassifier(): Promise<void> {
  const {
    isAppointmentSerializationFailure,
    APPOINTMENT_WRITE_SERIALIZABLE_RETRIES,
  } = await import("../src/services/AppointmentService");

  assert.equal(APPOINTMENT_WRITE_SERIALIZABLE_RETRIES, 3, "retry limit remains 3");

  assert.equal(
    isAppointmentSerializationFailure(makeKnownRequestError("P2034")),
    true,
    "P2034 is retryable",
  );
  assert.equal(
    isAppointmentSerializationFailure(
      makeKnownRequestError(
        "P2010",
        { code: "40001" },
        "Raw query failed. Code: `40001`. Message: `could not serialize access due to read/write dependencies among transactions`",
      ),
    ),
    true,
    "P2010 + meta.code 40001 is retryable",
  );

  assert.equal(
    isAppointmentSerializationFailure(
      makeKnownRequestError("P2010", { code: "23505" }),
    ),
    false,
    "P2010 + other SQLSTATE is not retryable",
  );
  assert.equal(
    isAppointmentSerializationFailure(makeKnownRequestError("P2010")),
    false,
    "P2010 without meta.code is not retryable",
  );
  assert.equal(
    isAppointmentSerializationFailure(
      makeKnownRequestError("P2010", { message: "could not serialize access" }),
    ),
    false,
    "P2010 with serialize text but no meta.code is not retryable",
  );
  assert.equal(
    isAppointmentSerializationFailure(new Error("could not serialize access")),
    false,
    "plain Error is not retryable",
  );
  assert.equal(
    isAppointmentSerializationFailure(makeKnownRequestError("P2002")),
    false,
    "unknown Prisma codes are not absorbed as retryable",
  );
  assert.equal(
    isAppointmentSerializationFailure({ code: "P2034" }),
    false,
    "plain object is not a KnownRequestError",
  );
}

function testSerializableTransactionWrapper(): void {
  const src = stripComments(read("src/services/AppointmentService.ts"));

  assert.match(
    src,
    /export const APPOINTMENT_WRITE_SERIALIZABLE_RETRIES = 3/,
    "retry ограничен тремя попытками",
  );
  assert.match(
    src,
    /export async function runSerializableAppointmentWrite/,
  );
  assert.match(
    src,
    /isolationLevel:\s*Prisma\.TransactionIsolationLevel\.Serializable/,
  );
  assert.match(
    src,
    /export function isAppointmentSerializationFailure/,
    "classifier exported for behavioral checks",
  );
  assert.match(
    src,
    /error\.code === "P2034"/,
    "P2034 remains retryable",
  );
  assert.match(
    src,
    /error\.code === "P2010"[\s\S]*meta\?\.code === "40001"/,
    "P2010+40001 classified by meta.code not message",
  );
  assert.doesNotMatch(
    src,
    /isAppointmentSerializationFailure[\s\S]{0,400}includes\(["']could not serialize/,
    "classifier must not key off message text",
  );
  assert.match(
    src,
    /attempt < APPOINTMENT_WRITE_SERIALIZABLE_RETRIES - 1/,
    "нет бесконечного retry",
  );
  assert.match(
    src,
    /function runSerializableAppointmentWrite[\s\S]*?catch \(error\) \{[\s\S]*?isAppointmentSerializationFailure\(error\)[\s\S]*?continue[\s\S]*?throw error/,
    "retry continue только после classifier; иначе throw",
  );
}

function testCreateUsesTransactionClient(): void {
  const src = stripComments(read("src/services/AppointmentService.ts"));

  assert.match(
    src,
    /async function loadConflictContext\(\s*db:\s*AppointmentConflictDbClient/,
    "loadConflictContext принимает transaction client",
  );
  assert.match(
    src,
    /async function assertNoBlockingConflict\(\s*db:\s*AppointmentConflictDbClient/,
    "assertNoBlockingConflict принимает transaction client",
  );
  assert.match(
    src,
    /db\.appointment\.findMany/,
    "конфликт читается через переданный db",
  );

  assert.match(
    src,
    /runtime\.runSerializableWrite\(async \(tx\) => \{[\s\S]*assertNoBlockingConflict\(\s*tx,/,
    "create: check внутри Serializable tx",
  );
  assert.match(
    src,
    /runtime\.runSerializableWrite\(async \(tx\) => \{[\s\S]*createAppointmentWithValidatedServicePolicy\(\s*tx,/,
    "create: write через tx client",
  );
}

function testUpdateUsesTransactionClientForBlockingStatus(): void {
  const src = stripComments(read("src/services/AppointmentService.ts"));

  assert.match(
    src,
    /const needsConflictCheck = isBlockingAppointmentStatus\(merged\.status\)/,
    "update: conflict check только для blocking status",
  );
  assert.match(
    src,
    /runtime\.runSerializableWrite\(async \(tx\) => \{[\s\S]*needsConflictCheck[\s\S]*assertNoBlockingConflict\(\s*tx,/,
    "update: check внутри Serializable tx",
  );
  assert.match(
    src,
    /needsConflictCheck[\s\S]*tx\.appointment\.update/,
    "update: write через tx client",
  );
  assert.match(
    src,
    /const appointment = await tx\.appointment\.update/,
    "update appointment write uses transaction client",
  );
}

function testCancelUnchanged(): void {
  const src = stripComments(read("src/services/AppointmentService.ts"));

  assert.match(src, /export async function cancelAppointment/);
  assert.doesNotMatch(
    src,
    /cancelAppointment[\s\S]*runSerializableAppointmentWrite/,
    "cancel не обёрнут в Serializable tx",
  );
}

function testConflictStillThrowsDomainError(): void {
  const src = stripComments(read("src/services/AppointmentService.ts"));
  const conflictLib = stripComments(
    read("src/lib/schedule/appointment-write-conflicts.ts"),
  );

  assert.match(
    src,
    /resolveAppointmentWriteConflict[\s\S]*throw new AppointmentConflictError/,
    "проигравший параллельный запрос получает доменный conflict",
  );
  assert.match(
    conflictLib,
    /type === "appointment"[\s\S]*APPOINTMENT_OVERLAP/,
    "appointment-overlap остаётся отдельным доменным кодом",
  );
}

async function main(): Promise<void> {
  await testSerializationFailureClassifier();
  testSerializableTransactionWrapper();
  testCreateUsesTransactionClient();
  testUpdateUsesTransactionClientForBlockingStatus();
  testCancelUnchanged();
  testConflictStillThrowsDomainError();
  console.log("security-appointment-double-book-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
