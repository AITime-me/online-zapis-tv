process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  classifyBookingRequestUniqueTarget,
  hasReliableUniqueTargetMetadata,
  isIdempotencyKeyConstraintTarget,
  isOpenGamePhoneCatalogConstraintTarget,
  OPEN_GAME_PHONE_CATALOG_UNIQUE_INDEX,
  resolveGameBookingCreateP2002Plan,
} from "../src/lib/game/game-open-request-policy";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertTargetClassification(): void {
  assert.equal(
    isOpenGamePhoneCatalogConstraintTarget([
      "client_phone_normalized",
      "game_catalog_id",
    ]),
    true,
  );
  assert.equal(
    isOpenGamePhoneCatalogConstraintTarget(OPEN_GAME_PHONE_CATALOG_UNIQUE_INDEX),
    true,
  );
  assert.equal(isIdempotencyKeyConstraintTarget(["idempotency_key"]), true);
  assert.equal(isIdempotencyKeyConstraintTarget("idempotencyKey"), true);
  assert.equal(isIdempotencyKeyConstraintTarget(["id"]), false);
  assert.equal(hasReliableUniqueTargetMetadata(null), false);
  assert.equal(hasReliableUniqueTargetMetadata([]), false);
  assert.equal(hasReliableUniqueTargetMetadata(["id"]), true);

  assert.equal(
    classifyBookingRequestUniqueTarget(["idempotency_key"]),
    "idempotency_key",
  );
  assert.equal(
    classifyBookingRequestUniqueTarget([
      "clientPhoneNormalized",
      "gameCatalogId",
    ]),
    "open_game_phone_catalog",
  );
  assert.equal(classifyBookingRequestUniqueTarget(["id"]), "other");
  assert.equal(classifyBookingRequestUniqueTarget(null), "other");
}

function assertP2002Plans(): void {
  assert.deepEqual(
    resolveGameBookingCreateP2002Plan([
      "client_phone_normalized",
      "game_catalog_id",
    ]),
    { action: "open_game_exists" },
  );
  assert.deepEqual(
    resolveGameBookingCreateP2002Plan(OPEN_GAME_PHONE_CATALOG_UNIQUE_INDEX),
    { action: "open_game_exists" },
  );
  assert.deepEqual(resolveGameBookingCreateP2002Plan(["idempotency_key"]), {
    action: "try_idempotent_retry",
  });
  assert.deepEqual(resolveGameBookingCreateP2002Plan(null), {
    action: "requery_open_then_maybe_open_or_rethrow",
  });
  assert.deepEqual(resolveGameBookingCreateP2002Plan([]), {
    action: "requery_open_then_maybe_open_or_rethrow",
  });
  assert.deepEqual(resolveGameBookingCreateP2002Plan(["id"]), {
    action: "rethrow",
  });
  assert.deepEqual(resolveGameBookingCreateP2002Plan(["some_future_unique"]), {
    action: "rethrow",
  });
}

/**
 * In-memory simulation of catch handler decisions (no Prisma).
 */
function simulateHandler(input: {
  target: unknown;
  idempotentRow: boolean;
  openRow: boolean;
}): "open_game" | "idempotent_retry" | "rethrow" {
  const plan = resolveGameBookingCreateP2002Plan(input.target);

  if (plan.action === "open_game_exists") {
    return "open_game";
  }

  if (
    plan.action === "try_idempotent_retry" ||
    plan.action === "requery_open_then_maybe_open_or_rethrow"
  ) {
    if (input.idempotentRow) {
      return "idempotent_retry";
    }
  }

  if (plan.action === "try_idempotent_retry") {
    return "rethrow";
  }

  if (plan.action === "requery_open_then_maybe_open_or_rethrow") {
    return input.openRow ? "open_game" : "rethrow";
  }

  return "rethrow";
}

function assertHandlerScenarios(): void {
  assert.equal(
    simulateHandler({
      target: ["client_phone_normalized", "game_catalog_id"],
      idempotentRow: false,
      openRow: true,
    }),
    "open_game",
  );

  assert.equal(
    simulateHandler({
      target: ["idempotency_key"],
      idempotentRow: true,
      openRow: false,
    }),
    "idempotent_retry",
  );

  assert.equal(
    simulateHandler({
      target: ["idempotency_key"],
      idempotentRow: false,
      openRow: true,
    }),
    "rethrow",
  );

  assert.equal(
    simulateHandler({
      target: null,
      idempotentRow: false,
      openRow: true,
    }),
    "open_game",
  );

  assert.equal(
    simulateHandler({
      target: null,
      idempotentRow: false,
      openRow: false,
    }),
    "rethrow",
  );

  assert.equal(
    simulateHandler({
      target: ["id"],
      idempotentRow: false,
      openRow: true,
    }),
    "rethrow",
  );

  // Normal business duplicate via explicit open target.
  assert.equal(
    simulateHandler({
      target: OPEN_GAME_PHONE_CATALOG_UNIQUE_INDEX,
      idempotentRow: false,
      openRow: false,
    }),
    "open_game",
  );
}

function assertServiceWiring(): void {
  const service = read("src/services/BookingRequestService.ts");
  assert.match(service, /resolveGameBookingCreateP2002Plan/);
  assert.match(service, /handleGameBookingCreateUniqueViolation/);
  assert.match(service, /findOpenGameBookingIdForPhoneCatalog/);
  assert.doesNotMatch(
    service,
    /Concurrent open-phone race without identifiable target metadata/,
  );
  // Must not unconditionally throw open-game after failed idempotency lookup.
  const handlerStart = service.indexOf(
    "async function handleGameBookingCreateUniqueViolation",
  );
  const handlerEnd = service.indexOf(
    "async function assertIdempotentGameRetryAllowed",
    handlerStart,
  );
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const handler = service.slice(handlerStart, handlerEnd);
  assert.match(handler, /plan\.action === "rethrow"|throw input\.error/);
  assert.match(handler, /requery_open_then_maybe_open_or_rethrow/);
}

function run(): void {
  assertTargetClassification();
  assertP2002Plans();
  assertHandlerScenarios();
  assertServiceWiring();
  console.log("security-game-booking-p2002-check: OK");
}

run();
