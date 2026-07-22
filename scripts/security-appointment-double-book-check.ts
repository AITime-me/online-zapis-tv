/**
 * Статический аудит: атомарная запись appointment против TOCTOU double-booking.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
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
    /isAppointmentSerializationFailure[\s\S]*code === "P2034"/,
    "retry только для P2034",
  );
  assert.match(
    src,
    /attempt < APPOINTMENT_WRITE_SERIALIZABLE_RETRIES - 1/,
    "нет бесконечного retry",
  );
  assert.match(
    src,
    /function runSerializableAppointmentWrite[\s\S]*?catch \(error\) \{[\s\S]*?isAppointmentSerializationFailure\(error\)[\s\S]*?continue[\s\S]*?throw error/,
    "retry continue только после проверки P2034",
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
    /runSerializableAppointmentWrite\(async \(tx\) => \{[\s\S]*assertNoBlockingConflict\(\s*tx,/,
    "create: check внутри Serializable tx",
  );
  assert.match(
    src,
    /runSerializableAppointmentWrite\(async \(tx\) => \{[\s\S]*tx\.appointment\.create/,
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
    /needsConflictCheck[\s\S]*runSerializableAppointmentWrite\(async \(tx\) => \{[\s\S]*assertNoBlockingConflict\(\s*tx,/,
    "update: check внутри Serializable tx",
  );
  assert.match(
    src,
    /needsConflictCheck[\s\S]*tx\.appointment\.update/,
    "update: write через tx client",
  );
  assert.match(
    src,
    /:\s*await prisma\.appointment\.update/,
    "non-blocking update остаётся вне Serializable tx",
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

function main(): void {
  testSerializableTransactionWrapper();
  testCreateUsesTransactionClient();
  testUpdateUsesTransactionClientForBlockingStatus();
  testCancelUnchanged();
  testConflictStillThrowsDomainError();
  console.log("security-appointment-double-book-check: OK");
}

main();
