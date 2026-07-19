process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  GAME_OPEN_REQUEST_EXISTS_CODE,
  GAME_OPEN_REQUEST_EXISTS_MESSAGE,
  isOpenGameBookingRequestStatus,
  isOpenGamePhoneCatalogConstraintTarget,
  normalizeGameBookingPhoneKey,
  OPEN_GAME_BOOKING_REQUEST_STATUSES,
} from "../src/lib/game/game-open-request-policy";
import { SESSION_START_LIMIT } from "../src/lib/game/session/game-session-cookie";
import {
  canRestartSession,
  isPlayRewardConsumed,
} from "../src/lib/game/session/game-session-reuse-rules";
import { validateSessionCompleteBody } from "../src/lib/game/session/game-session-contract";

const ROOT = process.cwd();
const CATALOG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CATALOG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertPhoneNormalizationVariants(): void {
  const key = "79001234567";
  assert.equal(normalizeGameBookingPhoneKey("+7 (900) 123-45-67"), key);
  assert.equal(normalizeGameBookingPhoneKey("8 (900) 123-45-67"), key);
  assert.equal(normalizeGameBookingPhoneKey("79001234567"), key);
  assert.equal(normalizeGameBookingPhoneKey("9001234567"), "9001234567");
  assert.notEqual(
    normalizeGameBookingPhoneKey("+7 (900) 123-45-67"),
    normalizeGameBookingPhoneKey("+7 (900) 999-99-99"),
  );
}

function assertOpenStatuses(): void {
  assert.deepEqual([...OPEN_GAME_BOOKING_REQUEST_STATUSES], ["NEW", "CONTACTED"]);
  assert.equal(isOpenGameBookingRequestStatus("NEW"), true);
  assert.equal(isOpenGameBookingRequestStatus("CONTACTED"), true);
  assert.equal(isOpenGameBookingRequestStatus("CLOSED"), false);
}

type MockOpenBooking = {
  id: string;
  phoneKey: string;
  catalogId: string;
  status: "NEW" | "CONTACTED" | "CLOSED";
  idempotencyKey: string;
};

/**
 * In-memory model of partial unique index + idempotency for open game leads.
 */
function createOpenPhoneCatalogStore() {
  const bookings: MockOpenBooking[] = [];

  function findOpen(phoneKey: string, catalogId: string): MockOpenBooking | null {
    return (
      bookings.find(
        (row) =>
          row.phoneKey === phoneKey &&
          row.catalogId === catalogId &&
          (row.status === "NEW" || row.status === "CONTACTED"),
      ) ?? null
    );
  }

  function submit(input: {
    phone: string;
    catalogId: string;
    idempotencyKey: string;
  }): { ok: true; id: string; reused: boolean } | { ok: false; code: string } {
    const phoneKey = normalizeGameBookingPhoneKey(input.phone);
    if (!phoneKey) {
      return { ok: false, code: "INVALID_PHONE" };
    }

    const byKey = bookings.find((row) => row.idempotencyKey === input.idempotencyKey);
    if (byKey) {
      return { ok: true, id: byKey.id, reused: true };
    }

    if (findOpen(phoneKey, input.catalogId)) {
      return { ok: false, code: GAME_OPEN_REQUEST_EXISTS_CODE };
    }

    const id = `req-${bookings.length + 1}`;
    bookings.push({
      id,
      phoneKey,
      catalogId: input.catalogId,
      status: "NEW",
      idempotencyKey: input.idempotencyKey,
    });
    return { ok: true, id, reused: false };
  }

  function close(id: string): void {
    const row = bookings.find((item) => item.id === id);
    if (row) {
      row.status = "CLOSED";
    }
  }

  function parallelSubmit(
    left: Parameters<typeof submit>[0],
    right: Parameters<typeof submit>[0],
  ): Array<ReturnType<typeof submit>> {
    // Simulate race: both pass SELECT, first INSERT wins, second hits unique.
    const phoneLeft = normalizeGameBookingPhoneKey(left.phone);
    const phoneRight = normalizeGameBookingPhoneKey(right.phone);
    assert.ok(phoneLeft && phoneRight);

    const openBefore = findOpen(phoneLeft!, left.catalogId);
    if (
      !openBefore &&
      phoneLeft === phoneRight &&
      left.catalogId === right.catalogId &&
      left.idempotencyKey !== right.idempotencyKey
    ) {
      const first = submit(left);
      const second = submit(right);
      return [first, second];
    }

    return [submit(left), submit(right)];
  }

  return { submit, close, findOpen, parallelSubmit, bookings };
}

function assertOpenPhoneCatalogPolicy(): void {
  const store = createOpenPhoneCatalogStore();
  const phoneA = "+7 (900) 111-22-33";
  const phoneAAlt = "89001112233";
  const phoneB = "+7 (900) 444-55-66";

  const first = store.submit({
    phone: phoneA,
    catalogId: CATALOG_A,
    idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const idempotent = store.submit({
    phone: phoneA,
    catalogId: CATALOG_A,
    idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
  });
  assert.equal(idempotent.ok, true);
  if (idempotent.ok) {
    assert.equal(idempotent.reused, true);
    assert.equal(idempotent.id, first.id);
  }

  const otherKey = store.submit({
    phone: phoneAAlt,
    catalogId: CATALOG_A,
    idempotencyKey: "550e8400-e29b-41d4-a716-446655440002",
  });
  assert.equal(otherKey.ok, false);
  if (!otherKey.ok) {
    assert.equal(otherKey.code, GAME_OPEN_REQUEST_EXISTS_CODE);
  }

  const otherPhone = store.submit({
    phone: phoneB,
    catalogId: CATALOG_A,
    idempotencyKey: "550e8400-e29b-41d4-a716-446655440003",
  });
  assert.equal(otherPhone.ok, true);

  const otherCatalog = store.submit({
    phone: phoneA,
    catalogId: CATALOG_B,
    idempotencyKey: "550e8400-e29b-41d4-a716-446655440004",
  });
  assert.equal(otherCatalog.ok, true);

  store.close(first.id);
  const afterClose = store.submit({
    phone: phoneA,
    catalogId: CATALOG_A,
    idempotencyKey: "550e8400-e29b-41d4-a716-446655440005",
  });
  assert.equal(afterClose.ok, true);

  const raceStore = createOpenPhoneCatalogStore();
  const [raceA, raceB] = raceStore.parallelSubmit(
    {
      phone: phoneA,
      catalogId: CATALOG_A,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440010",
    },
    {
      phone: phoneAAlt,
      catalogId: CATALOG_A,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440011",
    },
  );
  assert.equal(raceA.ok, true);
  assert.equal(raceB.ok, false);
  if (!raceB.ok) {
    assert.equal(raceB.code, GAME_OPEN_REQUEST_EXISTS_CODE);
  }
}

function assertSessionLimitConstant(): void {
  assert.equal(SESSION_START_LIMIT, 3);
}

function assertRestartRulesBeforeConsume(): void {
  assert.equal(
    canRestartSession({
      status: "COMPLETED",
      play: { leadId: null, consumedAt: null },
    }),
    true,
  );
  assert.equal(
    canRestartSession({
      status: "COMPLETED",
      play: { leadId: "x", consumedAt: new Date() },
    }),
    false,
  );
  assert.equal(
    isPlayRewardConsumed({ leadId: "x", consumedAt: new Date() }),
    true,
  );
}

function assertGiftIdRejected(): void {
  const rejected = validateSessionCompleteBody({
    catalogSlug: "procedure-gift",
    giftId: "55555555-5555-4555-8555-555555555555",
    gameDirection: "faceCare",
    skinNeed: "hydration",
    resultType: "win",
    premiumLevel: 0,
  });
  assert.equal(rejected.ok, false);
}

function assertConstraintTargetDetection(): void {
  assert.equal(
    isOpenGamePhoneCatalogConstraintTarget([
      "client_phone_normalized",
      "game_catalog_id",
    ]),
    true,
  );
  assert.equal(
    isOpenGamePhoneCatalogConstraintTarget(
      "booking_requests_open_game_phone_catalog_uidx",
    ),
    true,
  );
  assert.equal(isOpenGamePhoneCatalogConstraintTarget(["idempotency_key"]), false);
}

function assertSchemaAndMigration(): void {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /clientPhoneNormalized/);
  assert.match(schema, /gameCatalogId\s+String\?/);
  assert.match(schema, /model BookingRequest \{[\s\S]*gameCatalog\s+GameCatalog\?/);

  const migration = read(
    "prisma/migrations/20260719120000_booking_request_open_game_phone_catalog/migration.sql",
  );
  assert.match(migration, /client_phone_normalized/);
  assert.match(migration, /booking_requests_open_game_phone_catalog_uidx/);
  assert.match(migration, /status" IN \('NEW', 'CONTACTED'\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS/);
}

function assertServiceWiring(): void {
  const service = read("src/services/BookingRequestService.ts");
  assert.match(service, /normalizeGameBookingPhoneKey/);
  assert.match(service, /assertNoOpenGameBookingForPhoneCatalog/);
  assert.match(service, /clientPhoneNormalized:\s*phoneKey/);
  assert.match(service, /gameCatalogId,/);
  assert.match(service, /resolveGameBookingCreateP2002Plan/);
  assert.match(service, /handleGameBookingCreateUniqueViolation/);
  assert.match(service, /GAME_OPEN_REQUEST_EXISTS/);

  const sessionService = read("src/services/GameSessionService.ts");
  assert.match(sessionService, /status:\s*\{\s*in:\s*\["NEW",\s*"CONTACTED"\]/);
  assert.match(sessionService, /GAME_BOOKING_ALREADY_SUBMITTED/);

  assert.equal(
    GAME_OPEN_REQUEST_EXISTS_MESSAGE.includes("уже отправлена"),
    true,
  );
  assert.equal(GAME_OPEN_REQUEST_EXISTS_CODE, "GAME_BOOKING_ALREADY_SUBMITTED");
}

function run(): void {
  assertPhoneNormalizationVariants();
  assertOpenStatuses();
  assertOpenPhoneCatalogPolicy();
  assertSessionLimitConstant();
  assertRestartRulesBeforeConsume();
  assertGiftIdRejected();
  assertConstraintTargetDetection();
  assertSchemaAndMigration();
  assertServiceWiring();
  console.log("security-game-open-request-check: OK");
}

run();
