process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const MIGRATION_SQL_PATH = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260712121500_secure_game_session_platform",
  "migration.sql",
);
const SCHEMA_PATH = path.join(process.cwd(), "prisma", "schema.prisma");

const DESTRUCTIVE_SQL_PATTERN =
  /\b(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+"\w+"\s+DROP\s+COLUMN)\b/i;

function readMigrationSql(): string {
  assert.ok(fs.existsSync(MIGRATION_SQL_PATH), "migration.sql must exist");
  return fs.readFileSync(MIGRATION_SQL_PATH, "utf8");
}

function readSchema(): string {
  return fs.readFileSync(SCHEMA_PATH, "utf8");
}

function assertMigrationStructure(sql: string): void {
  assert.match(sql, /CREATE TYPE "GameSessionStatus"/);
  assert.match(sql, /CREATE TABLE "game_sessions"/);
  assert.match(sql, /game_plays_game_session_id_fkey/);
  assert.doesNotMatch(sql, /GameSession\.gamePlayId|"game_play_id".*game_sessions/i);
  assert.match(sql, /game_plays_lead_id_key/);
  assert.match(sql, /game_plays_lead_id_fkey/);
  assert.match(sql, /booking_requests_idempotency_key_key/);
  assert.match(sql, /idempotency_payload_hash/);
  assert.match(sql, /game_gifts_game_catalog_id_fkey/);
  assert.match(sql, /game_catalog_one_primary_public_idx/);
  assert.match(sql, /WHERE "is_primary_public" = true/);
  assert.match(sql, /UPDATE "game_plays"[\s\S]*SET "game_catalog_id"/);
  assert.match(sql, /UPDATE "game_plays"[\s\S]*SET "completed_at" = "created_at"/);
  assert.match(sql, /UPDATE "game_plays"[\s\S]*SET "consumed_at" = br\."created_at"/);
  assert.match(sql, /UPDATE "game_gifts"[\s\S]*SET "game_catalog_id"/);
  assert.doesNotMatch(sql, DESTRUCTIVE_SQL_PATTERN);
  assert.doesNotMatch(sql, /UPDATE "game_plays"[\s\S]*selected_gift_id/i);
  assert.doesNotMatch(sql, /UPDATE "game_plays"[\s\S]*(game_direction|skin_need|result_type|premium_level)/i);
  assert.doesNotMatch(sql, /UPDATE "game_gifts"[\s\S]*(name|probability|required_premium_level|is_active)/i);
}

function assertPrismaSchema(schema: string): void {
  assert.match(schema, /enum GameSessionStatus/);
  assert.match(schema, /model GameSession/);
  assert.match(schema, /gameSessionId\s+String\?\s+@unique/);
  assert.doesNotMatch(schema, /gamePlayId\s+String/);
  assert.match(schema, /leadId String\?\s+@unique/);
  assert.match(schema, /idempotencyKey\s+String\?\s+@unique/);
  assert.match(schema, /idempotencyPayloadHash/);
  assert.match(schema, /gameCatalogId String\?\s+@map\("game_catalog_id"\)/);
  assert.match(schema, /giftSnapshot/);
  assert.match(schema, /rulesSnapshot/);
  assert.match(schema, /serverResultTier/);
  assert.match(schema, /isPrimaryPublic/);
}

async function assertDatabaseStructure(prisma: PrismaClient): Promise<void> {
  const enumRows = await prisma.$queryRawUnsafe<Array<{ typname: string }>>(
    `SELECT t.typname
     FROM pg_type t
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typname = 'GameSessionStatus'`,
  );
  assert.equal(enumRows.length, 1, "GameSessionStatus enum must exist");

  const sessionTable = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'game_sessions'`,
  );
  assert.equal(sessionTable.length, 1, "game_sessions table must exist");

  const sessionPlayFk = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
    `SELECT c.conname
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'game_plays'
       AND c.contype = 'f'
       AND c.conname = 'game_plays_game_session_id_fkey'`,
  );
  assert.equal(sessionPlayFk.length, 1, "GamePlay → GameSession FK must exist");

  const sessionPlayReverseFk = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
    `SELECT c.conname
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'game_sessions'
       AND c.contype = 'f'
       AND pg_get_constraintdef(c.oid) ILIKE '%game_plays%'`,
  );
  assert.equal(
    sessionPlayReverseFk.length,
    0,
    "GameSession must not have physical FK to GamePlay",
  );

  const leadUnique = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'game_plays' AND indexname = 'game_plays_lead_id_key'`,
  );
  assert.equal(leadUnique.length, 1, "GamePlay.leadId unique index must exist");

  const leadFk = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
    `SELECT conname FROM pg_constraint WHERE conname = 'game_plays_lead_id_fkey'`,
  );
  assert.equal(leadFk.length, 1, "GamePlay.leadId FK must exist");

  const idempotencyUnique = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'booking_requests' AND indexname = 'booking_requests_idempotency_key_key'`,
  );
  assert.equal(idempotencyUnique.length, 1, "BookingRequest.idempotencyKey unique must exist");

  const giftCatalogFk = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
    `SELECT conname FROM pg_constraint WHERE conname = 'game_gifts_game_catalog_id_fkey'`,
  );
  assert.equal(giftCatalogFk.length, 1, "GameGift.gameCatalogId FK must exist");

  const partialPrimary = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'game_catalog' AND indexname = 'game_catalog_one_primary_public_idx'`,
  );
  assert.equal(partialPrimary.length, 1, "partial primary public index must exist");
}

async function main(): Promise<void> {
  const sql = readMigrationSql();
  const schema = readSchema();
  assertMigrationStructure(sql);
  assertPrismaSchema(schema);

  const prisma = new PrismaClient();
  try {
    await assertDatabaseStructure(prisma);
    console.log("security-game-platform-migration-check: OK");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("security-game-platform-migration-check: FAILED");
  console.error(error);
  process.exit(1);
});
