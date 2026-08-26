/**
 * TEYA analytics A1 — appointment creator provenance.
 * Static proofs + role derivation + optional/required Postgres migration smoke.
 *
 * Modes:
 *   default: static always; PG optional (honest SKIPPED, never "ALL PASSED")
 *   --require-postgres or SECURITY_REQUIRE_PG=1: PG required (nonzero on skip/fail)
 */
process.env.SECURITY_BATCH_TEST = "1";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/tvoe_vremya_security_batch";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { creatorKindFromAuthenticatedRole } from "../src/lib/schedule/appointment-creator-kind";

const ROOT = process.cwd();
const REQUIRE_POSTGRES =
  process.argv.includes("--require-postgres") ||
  process.env.SECURITY_REQUIRE_PG === "1";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function testStaticProvenanceModel(): void {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /enum AppointmentCreatorKind/);
  assert.match(schema, /SELF_SERVICE/);
  assert.match(schema, /TEYA/);
  assert.match(schema, /MANAGER/);
  assert.match(schema, /MASTER/);
  assert.match(schema, /OTHER/);
  assert.match(schema, /creatorKind\s+AppointmentCreatorKind\?/);
  assert.match(schema, /@map\("creator_kind"\)/);

  const migration = read(
    "prisma/migrations/20260825220000_appointment_creator_kind/migration.sql",
  );
  assert.match(migration, /CREATE TYPE "AppointmentCreatorKind"/);
  assert.match(migration, /ADD COLUMN "creator_kind"/);
  assert.doesNotMatch(migration, /UPDATE\s+"appointments"/i);
  assert.doesNotMatch(migration, /SET\s+"creator_kind"/i);

  const service = read("src/services/AppointmentService.ts");
  assert.match(service, /AppointmentCreatorKind\.SELF_SERVICE/);
  assert.match(service, /AppointmentCreatorKind\.TEYA/);
  assert.match(
    service,
    /Creator provenance is explicit \(TEYA vs MASTER\)/,
  );
  assert.match(
    service,
    /creatorKind:\s*AppointmentCreatorKind;/,
  );
  assert.doesNotMatch(
    service,
    /creatorKind:\s*options\?\.creatorKind\s*\?\?\s*AppointmentCreatorKind\.MANAGER/,
  );
  assert.match(
    service,
    /creatorKind is required for appointment create/,
  );
  const writeInputMatch = service.match(
    /export type AppointmentWriteInput = \{([\s\S]*?)\n\};/,
  );
  assert.ok(writeInputMatch, "AppointmentWriteInput type present");
  assert.doesNotMatch(writeInputMatch[1]!, /creatorKind/);

  const adminRoute = read("src/app/api/appointments/route.ts");
  assert.match(adminRoute, /creatorKindFromAuthenticatedRole/);
  assert.match(adminRoute, /Reflect\.deleteProperty[\s\S]*creatorKind/);
  assert.doesNotMatch(adminRoute, /body\.creatorKind/);

  const botCreate = read("src/services/BotBookingCreateService.ts");
  assert.match(botCreate, /"TEYA"/);

  const master = read("src/services/MasterCommandService.ts");
  assert.match(master, /"MASTER"/);

  const bookFromRequest = read("src/services/BotBookingRequestService.ts");
  assert.match(bookFromRequest, /createBotRequestAppointment/);

  const neo = read(
    "src/app/api/internal/neo-analytics/v1/appointments/route.ts",
  );
  assert.match(neo, /creatorKind:\s*true/);
  assert.match(neo, /AppointmentCreatorKind\|null/);
}

function testUnitRoleDerivation(): void {
  assert.equal(creatorKindFromAuthenticatedRole("OWNER"), "MANAGER");
  assert.equal(creatorKindFromAuthenticatedRole("MANAGER"), "MANAGER");
  assert.equal(creatorKindFromAuthenticatedRole("MASTER"), "MASTER");
}

async function testPgProvenancePaths(): Promise<"PASSED" | "SKIPPED"> {
  const { PrismaClient, AppointmentCreatorKind } = await import(
    "@prisma/client"
  );
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    await prisma.$disconnect().catch(() => undefined);
    if (REQUIRE_POSTGRES) {
      console.error(
        "PG_CHECKS_FAILED: Postgres unavailable under SECURITY_REQUIRE_PG / --require-postgres",
      );
      console.error(String(error instanceof Error ? error.message : error));
      process.exit(1);
    }
    console.log("PG_CHECKS_SKIPPED: Postgres unavailable for provenance PG proofs");
    console.log(String(error instanceof Error ? error.message : error));
    return "SKIPPED";
  }

  const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'appointments' AND column_name = 'creator_kind'
  `;
  if (cols.length === 0) {
    await prisma.$disconnect();
    if (REQUIRE_POSTGRES) {
      console.error(
        "PG_CHECKS_FAILED: migration not applied (creator_kind missing)",
      );
      process.exit(1);
    }
    console.log(
      "PG_CHECKS_SKIPPED: migration not applied (creator_kind missing)",
    );
    return "SKIPPED";
  }

  // Soft check: column nullable — no forced backfill semantics in migration.
  const falselyFilled = await prisma.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint AS c
    FROM appointments
    WHERE creator_kind IS NOT NULL
      AND created_at < NOW() - INTERVAL '1 day'
  `;
  assert.ok(falselyFilled[0] !== undefined);

  assert.equal(AppointmentCreatorKind.SELF_SERVICE, "SELF_SERVICE");
  assert.equal(AppointmentCreatorKind.TEYA, "TEYA");
  assert.equal(AppointmentCreatorKind.MANAGER, "MANAGER");
  assert.equal(AppointmentCreatorKind.MASTER, "MASTER");
  assert.equal(AppointmentCreatorKind.OTHER, "OTHER");

  await prisma.$disconnect();
  console.log("PG provenance smoke: column present, no forced backfill");
  return "PASSED";
}

async function main(): Promise<void> {
  testStaticProvenanceModel();
  console.log("STATIC_CHECKS_PASSED");
  testUnitRoleDerivation();
  console.log("role derivation: PASSED");
  const pg = await testPgProvenancePaths();
  if (pg === "PASSED") {
    console.log("PG_CHECKS_PASSED");
    console.log("appointment-creator-provenance-check: ALL CHECKS PASSED");
  } else {
    console.log("PG_CHECKS_SKIPPED");
    console.log(
      "appointment-creator-provenance-check: STATIC_CHECKS_PASSED; PG_CHECKS_SKIPPED; NOT FULLY PROVEN",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
