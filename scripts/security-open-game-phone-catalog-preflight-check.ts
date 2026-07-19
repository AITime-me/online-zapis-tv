process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const PHONE_CASE_SNIPPET = [
  "length(regexp_replace(coalesce(",
  "'\\D', '', 'g')) = 11",
  "IN ('7', '8')",
  "'7' || substr(",
  ">= 10",
].join("|");

function assertSharedSqlContracts(): void {
  const preflight = read(
    "scripts/ops/lib/open-game-phone-catalog-preflight.sql",
  );
  const migration = read(
    "prisma/migrations/20260719120000_booking_request_open_game_phone_catalog/migration.sql",
  );

  assert.match(preflight, /conflict_group_count/);
  assert.match(preflight, /conflict_row_count/);
  assert.match(preflight, /open_game_rows_missing_catalog_count/);
  assert.match(preflight, /open_game_rows_invalid_phone_count/);
  assert.match(preflight, /INNER JOIN "game_plays" gp ON gp\."lead_id" = br\."id"/);
  assert.match(preflight, /status" IN \('NEW', 'CONTACTED'\)/);
  assert.doesNotMatch(preflight, /client_phone_normalized/);
  // No mutating SQL statements (ignore the READ-ONLY comment that mentions them).
  assert.doesNotMatch(preflight, /^\s*(UPDATE|DELETE|INSERT|ALTER)\b/im);
  assert.doesNotMatch(preflight, /client_name|"comment"/i);
  assert.doesNotMatch(preflight, /SELECT\s+br\."id"|SELECT\s+br\."client_phone"/i);

  assert.match(migration, /RAISE EXCEPTION/);
  assert.match(migration, /conflict_group_count/);
  assert.match(migration, /open_game_rows_missing_catalog_count/);
  assert.match(migration, /open_game_rows_invalid_phone_count/);
  assert.match(migration, /booking_requests_open_game_phone_catalog_uidx/);
  assert.match(migration, /does NOT wrap migrations in a transaction/);
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;/m);
  // Fail-fast must appear before unique index creation.
  const failFastAt = migration.indexOf("RAISE EXCEPTION");
  const uniqueCreateAt = migration.indexOf(
    'CREATE UNIQUE INDEX IF NOT EXISTS "booking_requests_open_game_phone_catalog_uidx"',
  );
  assert.ok(failFastAt >= 0 && uniqueCreateAt > failFastAt);
  assert.doesNotMatch(migration, /UPDATE[\s\S]*status\s*=\s*'CLOSED'/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+"booking_requests"/i);

  // Phone normalize fragments present in both.
  for (const fragment of [
    "regexp_replace(coalesce(",
    "IN ('7', '8')",
    "'7' || substr(",
  ]) {
    assert.match(preflight, new RegExp(fragment.replace(/[()]/g, "\\$&")));
    assert.match(migration, new RegExp(fragment.replace(/[()]/g, "\\$&")));
  }

  void PHONE_CASE_SNIPPET;
}

function assertOpsScripts(): void {
  const staging = read(
    "scripts/ops/staging-preflight-open-game-phone-catalog.sh",
  );
  const production = read(
    "scripts/ops/production-preflight-open-game-phone-catalog.sh",
  );
  const gitignore = read(".gitignore");

  assert.match(gitignore, /!scripts\/ops\/lib\/\*\.sql/);

  for (const script of [staging, production]) {
    assert.match(script, /--dry-run/);
    assert.match(script, /open-game-phone-catalog-preflight\.sql/);
    assert.match(script, /conflict_group_count=/);
    assert.match(script, /ops_read_env_value POSTGRES_USER/);
    assert.match(script, /ops_die "preflight failed/);
    assert.doesNotMatch(script, /echo\s+"\$pg_user"|printf.*PASSWORD|DATABASE_URL=/);
  }

  assert.match(staging, /staging-ops-common/);
  assert.match(production, /production-ops-common/);
  assert.match(production, /ops_assert_production_checkout/);
}

function run(): void {
  assertSharedSqlContracts();
  assertOpsScripts();
  console.log("security-open-game-phone-catalog-preflight-check: OK");
}

run();
