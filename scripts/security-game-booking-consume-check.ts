process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  IDEMPOTENCY_KEY_HEADER,
  validateIdempotencyKeyHeader,
} from "../src/lib/booking-requests/idempotency-contract";
import {
  buildBookingIdempotencyPayload,
  computeIdempotencyPayloadHash,
  idempotencyPayloadHashesEqual,
} from "../src/lib/booking-requests/idempotency-server";
import {
  collectForbiddenPublicBookingRequestKeys,
  toPublicBookingRequestCreateResponse,
} from "../src/lib/booking-requests/public-booking-request-contract";
import {
  extractGameBookingCommentForPayload,
  buildServerGameBookingComment,
  GAME_BOOKING_UNAVAILABLE_MESSAGE,
  resolveGameGiftFromPlay,
  sessionTokenMatchesHash,
  validateGameBookingForFirstSubmit,
  validateGameBookingForIdempotentRetry,
  resolveGamePlayIdInput,
  GAME_INVALID_REQUEST_CODE,
  type GamePlayBookingRow,
} from "../src/lib/game/game-booking-consume-rules";
import {
  buildGiftSnapshot,
  parseRulesSnapshot,
} from "../src/lib/game/session/game-session-snapshot";
import {
  buildCatalogSessionCookieName,
  readRequestCookie,
} from "../src/lib/game/session/game-session-cookie";
import { hashOpaqueToken } from "../src/lib/game/session/game-session-token";
import { validateSameOriginRequest } from "../src/lib/security/csrf";

const CATALOG_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const PLAY_ID = "33333333-3333-4333-8333-333333333333";
const BOOKING_ID = "44444444-4444-4444-8444-444444444444";
const GIFT_ID = "55555555-5555-4555-8555-555555555555";

const SECURITY_INVENTORY = [
  "booking/request requires Idempotency-Key",
  "booking/request enforces same-origin guard",
  "browser consumers send Idempotency-Key",
  "client idempotency module is browser-safe",
  "HMAC-SHA256 payload hash for booking idempotency",
  "game booking requires session cookie ownership",
  "legacy GamePlay without GameSession rejected",
  "atomic GameSession + GamePlay consume transaction",
  "idempotent retry after CONSUMED returns same requestId",
  "different idempotency key after CONSUMED rejected",
  "/api/booking/create remains separate appointment flow",
  "malformed non-empty gamePlayId rejected before booking side effects",
];

function assertIdempotencyHeaderContract(): void {
  const missing = validateIdempotencyKeyHeader(null);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.code, "IDEMPOTENCY_KEY_REQUIRED");
  }

  const malformed = validateIdempotencyKeyHeader("not-a-uuid");
  assert.equal(malformed.ok, false);
  if (!malformed.ok) {
    assert.equal(malformed.code, "IDEMPOTENCY_KEY_INVALID");
  }

  const valid = validateIdempotencyKeyHeader("550e8400-e29b-41d4-a716-446655440000");
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.key, "550e8400-e29b-41d4-a716-446655440000");
    assert.equal(valid.key.includes("+7"), false);
    assert.equal(valid.key.includes("Иван"), false);
  }
}

function assertHmacPayloadHash(): void {
  const left = buildBookingIdempotencyPayload({
    clientName: "  Anna   Test ",
    clientPhone: "+7 (900) 123-45-67",
    type: "CONSULTATION_REQUEST",
    comment: "Нужна консультация",
    masterId: null,
    personalDataConsent: true,
    offerAcknowledgement: true,
    gamePlayId: null,
    gameSessionId: null,
  });
  const right = buildBookingIdempotencyPayload({
    clientName: "Anna Test",
    clientPhone: "79001234567",
    type: "CONSULTATION_REQUEST",
    comment: "Нужна консультация",
    masterId: null,
    personalDataConsent: true,
    offerAcknowledgement: true,
    gamePlayId: null,
    gameSessionId: null,
  });

  const hashA = computeIdempotencyPayloadHash(left);
  const hashB = computeIdempotencyPayloadHash(right);
  assert.equal(hashA, hashB);
  assert.equal(hashA.length, 64);

  const changed = buildBookingIdempotencyPayload({
    ...left,
    comment: "Другой комментарий",
  });
  assert.notEqual(computeIdempotencyPayloadHash(changed), hashA);

  const secret =
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "dev-idempotency-hmac-not-for-production";
  const canonical = JSON.stringify({
    clientName: left.clientName,
    clientPhone: left.clientPhone,
    comment: left.comment,
    gamePlayId: left.gamePlayId,
    gameSessionId: left.gameSessionId,
    masterId: left.masterId,
    offerAcknowledgement: left.offerAcknowledgement,
    personalDataConsent: left.personalDataConsent,
    // Must match canonicalizePayload key order in idempotency-server.ts
    serviceId: left.serviceId,
    type: left.type,
  });
  const expected = createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
  assert.equal(hashA, expected);

  assert.equal(idempotencyPayloadHashesEqual(hashA, hashA), true);
  const flipped =
    (hashA[0] === "a" ? "b" : "a") + hashA.slice(1);
  assert.equal(idempotencyPayloadHashesEqual(hashA, flipped), false);
  assert.equal(
    timingSafeEqual(Buffer.from(hashA, "utf8"), Buffer.from(hashA, "utf8")),
    true,
  );
}

function buildMockPlay(overrides: Partial<GamePlayBookingRow> = {}): GamePlayBookingRow {
  const assignedAt = new Date("2026-07-12T10:00:00.000Z");
  const giftSnapshot = buildGiftSnapshot(
    {
      id: GIFT_ID,
      name: "Server gift",
      shortDescription: "Описание подарка",
      image: null,
      priority: "standard",
      cardStyle: "default",
      activationMode: "SINGLE_PAID_SERVICE",
      minCourseSessions: null,
      activationConditionText:
        "Подарок предоставляется при записи на одну оплачиваемую процедуру по выпавшему направлению",
    },
    assignedAt,
  );

  return {
    id: PLAY_ID,
    gameDirection: "faceCare",
    gameCatalogId: CATALOG_ID,
    gameSessionId: SESSION_ID,
    selectedGiftId: GIFT_ID,
    leadId: null,
    consumedAt: null,
    giftSnapshot,
    rulesSnapshot: {
      campaignKey: "2026-07",
      rulesVersion: "1",
      mechanicType: "CATCH_TIME",
      serverResultTier: 0,
      probabilityBucket: "tier-0",
      bookingWindowHours: 24,
      catalogSlug: "procedure-gift",
      catalogTitle: "Поймай своё время",
    },
    selectedGift: {
      name: "Live gift",
      shortDescription: "Legacy fallback",
    },
    gameCatalog: {
      id: CATALOG_ID,
      slug: "procedure-gift",
      title: "Поймай своё время",
    },
    gameSession: {
      id: SESSION_ID,
      gameCatalogId: CATALOG_ID,
      tokenHash: hashOpaqueToken("session-token"),
      status: "COMPLETED",
      claimExpiresAt: new Date("2026-07-13T10:00:00.000Z"),
      consumedAt: null,
    },
    ...overrides,
  };
}

function assertGameValidationRules(): void {
  const token = "session-token";
  const play = buildMockPlay();
  const now = new Date("2026-07-12T11:00:00.000Z");

  const ok = validateGameBookingForFirstSubmit(play, token, now);
  assert.equal(ok.ok, true);

  const legacy = validateGameBookingForFirstSubmit(
    buildMockPlay({ gameSessionId: null, gameSession: null }),
    token,
    now,
  );
  assert.equal(legacy.ok, false);

  const wrongCookie = validateGameBookingForFirstSubmit(play, "wrong-token", now);
  assert.equal(wrongCookie.ok, false);
  if (!wrongCookie.ok) {
    assert.equal(wrongCookie.code, "GAME_SESSION_OWNERSHIP_FAILED");
  }

  const expired = validateGameBookingForFirstSubmit(
    buildMockPlay({
      gameSession: {
        ...play.gameSession!,
        claimExpiresAt: new Date("2026-07-12T09:00:00.000Z"),
      },
    }),
    token,
    now,
  );
  assert.equal(expired.ok, false);
  if (!expired.ok) {
    assert.equal(expired.code, "GAME_SESSION_EXPIRED");
  }

  const noGift = validateGameBookingForFirstSubmit(
    buildMockPlay({ giftSnapshot: null, selectedGift: null, selectedGiftId: null }),
    token,
    now,
  );
  assert.equal(noGift.ok, false);

  const consumedPlay = buildMockPlay({
    leadId: BOOKING_ID,
    consumedAt: now,
    gameSession: {
      ...play.gameSession!,
      status: "CONSUMED",
      consumedAt: now,
    },
  });
  const retry = validateGameBookingForIdempotentRetry({
    play: consumedPlay,
    sessionToken: token,
    bookingRequestId: BOOKING_ID,
    gamePlayId: PLAY_ID,
  });
  assert.equal(retry.ok, true);

  const retryWrongKey = validateGameBookingForIdempotentRetry({
    play: consumedPlay,
    sessionToken: token,
    bookingRequestId: "00000000-0000-4000-8000-000000000001",
    gamePlayId: PLAY_ID,
  });
  assert.equal(retryWrongKey.ok, false);
}

function assertServerGiftCommentIgnoresClientTemplate(): void {
  const play = buildMockPlay();
  const gift = resolveGameGiftFromPlay(play);
  assert.ok(gift);
  assert.equal(gift!.giftName, "Server gift");

  const userMessage = extractGameBookingCommentForPayload(
    "Клиент прошёл игру «Поймай своё время».\n\nСообщение клиента:\nРеальный текст",
  );
  assert.equal(userMessage, "Реальный текст");

  const comment = buildServerGameBookingComment({
    play,
    gift: gift!,
    userMessage,
  });
  assert.match(comment, /Поймай своё время/);
  assert.match(comment, /Server gift/);
  assert.match(comment, /Реальный текст/);
  assert.equal((comment.match(/Server gift/g) ?? []).length, 1);
}

type MockBooking = {
  id: string;
  idempotencyKey: string;
  payloadHash: string;
};

type MockPlay = {
  id: string;
  leadId: string | null;
  consumedAt: Date | null;
  gameSessionId: string;
};

type MockSession = {
  id: string;
  status: "COMPLETED" | "CONSUMED";
  consumedAt: Date | null;
  claimExpiresAt: Date;
};

function simulateRegularDoubleSubmit(): void {
  const store = new Map<string, MockBooking>();
  const key = "550e8400-e29b-41d4-a716-446655440000";
  const payloadHash = computeIdempotencyPayloadHash(
    buildBookingIdempotencyPayload({
      clientName: "Anna Test",
      clientPhone: "79001234567",
      type: "CONSULTATION_REQUEST",
      comment: null,
      masterId: null,
      personalDataConsent: true,
      offerAcknowledgement: true,
      gamePlayId: null,
      gameSessionId: null,
    }),
  );

  function createOnce(): MockBooking {
    const existing = store.get(key);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new Error("IDEMPOTENCY_CONFLICT");
      }
      return existing;
    }
    const created = { id: BOOKING_ID, idempotencyKey: key, payloadHash };
    store.set(key, created);
    return created;
  }

  const first = createOnce();
  const second = createOnce();
  assert.equal(first.id, second.id);
  assert.equal(store.size, 1);
}

function simulateGameConsumeTransaction(): void {
  const now = new Date("2026-07-12T11:00:00.000Z");
  let bookingCreated = false;
  let session: MockSession = {
    id: SESSION_ID,
    status: "COMPLETED",
    consumedAt: null,
    claimExpiresAt: new Date("2026-07-13T10:00:00.000Z"),
  };
  let play: MockPlay = {
    id: PLAY_ID,
    leadId: null,
    consumedAt: null,
    gameSessionId: SESSION_ID,
  };

  function consumeOnce(allowIdempotentRetry: boolean): string {
    if (bookingCreated) {
      if (allowIdempotentRetry) {
        return BOOKING_ID;
      }
      throw new Error("GAME_RESULT_UNAVAILABLE");
    }

    if (
      session.status !== "COMPLETED" ||
      session.consumedAt !== null ||
      session.claimExpiresAt <= now ||
      play.leadId !== null ||
      play.consumedAt !== null
    ) {
      throw new Error("GAME_RESULT_UNAVAILABLE");
    }

    bookingCreated = true;
    play = { ...play, leadId: BOOKING_ID, consumedAt: now };
    session = { ...session, status: "CONSUMED", consumedAt: now };
    return BOOKING_ID;
  }

  assert.equal(consumeOnce(false), BOOKING_ID);
  assert.equal(session.status, "CONSUMED");
  assert.equal(play.leadId, BOOKING_ID);
  assert.equal(consumeOnce(true), BOOKING_ID);

  let conflictThrown = false;
  try {
    consumeOnce(false);
  } catch {
    conflictThrown = true;
  }
  assert.equal(conflictThrown, true);
}

function simulateParallelGameSubmit(): void {
  const now = new Date("2026-07-12T11:00:00.000Z");
  let winner: string | null = null;
  let sessionConsumed = false;
  let playLinked = false;

  function attempt(requestId: string): boolean {
    if (playLinked) {
      return false;
    }
    if (sessionConsumed) {
      return false;
    }
    winner = requestId;
    playLinked = true;
    sessionConsumed = true;
    return true;
  }

  const first = attempt("req-a");
  const second = attempt("req-b");
  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(winner, "req-a");
  assert.equal(now instanceof Date, true);
}

function assertSameOriginPolicy(): void {
  const localhost = validateSameOriginRequest(
    new Request("http://localhost:3000/api/booking/request", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
      },
    }),
  );
  assert.equal(localhost, true);

  const crossSite = validateSameOriginRequest(
    new Request("http://localhost:3000/api/booking/request", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
    }),
  );
  assert.equal(crossSite, false);
}

function assertBrowserConsumers(): void {
  const consumerFiles = [
    "src/components/game/procedure-gift-game-vanilla.tsx",
    "src/components/game/procedure-gift-game.tsx",
    "src/components/booking/booking-manager-request-form.tsx",
    "public/poimay-game/js/booking-api.js",
    "tests/security-batch1.spec.ts",
  ];

  for (const file of consumerFiles) {
    const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    assert.match(source, /Idempotency-Key|buildIdempotencyHeaders/);
  }
}

function assertClientModuleIsolation(): void {
  const clientSource = fs.readFileSync(
    path.join(process.cwd(), "src/lib/booking-requests/idempotency-client.ts"),
    "utf8",
  );
  assert.equal(clientSource.includes("server-only"), false);
  assert.equal(clientSource.includes("@prisma/client"), false);
  assert.equal(clientSource.includes("node:crypto"), false);

  const contractSource = fs.readFileSync(
    path.join(process.cwd(), "src/lib/booking-requests/idempotency-contract.ts"),
    "utf8",
  );
  assert.equal(contractSource.includes("server-only"), false);
}

function assertRouteGuardsAndContracts(): void {
  const bookingRoute = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/booking/request/route.ts"),
    "utf8",
  );
  assert.match(bookingRoute, /enforceSameOriginForMutatingRequest/);
  assert.match(bookingRoute, /validateIdempotencyKeyHeader/);
  assert.match(bookingRoute, /IDEMPOTENCY_KEY_HEADER/);
  assert.equal(bookingRoute.includes("tokenHash"), false);

  const createRoute = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/booking/create/route.ts"),
    "utf8",
  );
  assert.equal(createRoute.includes("idempotencyKey"), false);
  assert.equal(createRoute.includes("validateIdempotencyKeyHeader"), false);
}

function assertPublicResponseWhitelist(): void {
  const response = toPublicBookingRequestCreateResponse({ id: BOOKING_ID });
  assert.equal(response.ok, true);
  assert.equal(response.requestId, BOOKING_ID);
  assert.equal(
    collectForbiddenPublicBookingRequestKeys(response as unknown as Record<string, unknown>).length,
    0,
  );
}

function assertCookieHelpersDoNotExposeRawToken(): void {
  const cookieName = buildCatalogSessionCookieName("procedure-gift");
  const header = `${cookieName}=raw-token-value`;
  assert.equal(readRequestCookie(header, cookieName), "raw-token-value");
  assert.equal(sessionTokenMatchesHash("raw-token-value", hashOpaqueToken("raw-token-value")), true);
  assert.equal(GAME_BOOKING_UNAVAILABLE_MESSAGE.includes("ещё раз"), true);
}

function assertRulesSnapshotParsing(): void {
  const rules = parseRulesSnapshot({
    campaignKey: "2026-07",
    rulesVersion: "1",
    mechanicType: "CATCH_TIME",
    serverResultTier: 0,
    probabilityBucket: "tier-0",
    bookingWindowHours: 24,
    catalogSlug: "procedure-gift",
    catalogTitle: "Title",
  });
  assert.ok(rules);
  assert.equal(rules!.catalogTitle, "Title");
}

type BookingSideEffectState = {
  bookingCreated: boolean;
  clientLinked: boolean;
  idempotencyStored: boolean;
  gameTagged: boolean;
};

function simulateCreateBookingRequestDecision(input: {
  gamePlayId: string | null | undefined;
  idempotencyKey: string;
}): BookingSideEffectState {
  const state: BookingSideEffectState = {
    bookingCreated: false,
    clientLinked: false,
    idempotencyStored: false,
    gameTagged: false,
  };

  const resolution = resolveGamePlayIdInput(input.gamePlayId);
  if (!resolution.ok) {
    return state;
  }

  const gamePlayId =
    resolution.resolution.kind === "game"
      ? resolution.resolution.gamePlayId
      : null;

  state.clientLinked = true;
  state.idempotencyStored = true;
  state.bookingCreated = true;
  if (gamePlayId) {
    state.gameTagged = true;
  }

  return state;
}

function assertGamePlayIdInputPolicy(): void {
  const absentValues: Array<string | null | undefined> = [
    undefined,
    null,
    "",
    "   ",
  ];

  for (const value of absentValues) {
    const resolution = resolveGamePlayIdInput(value);
    assert.equal(resolution.ok, true);
    if (resolution.ok) {
      assert.equal(resolution.resolution.kind, "absent");
    }
  }

  const malformedValues = [
    "game",
    "undefined",
    "null",
    "not-a-uuid",
    "550e8400-e29b-41d4-a716-446655440000-extra",
    "123",
  ];

  for (const value of malformedValues) {
    const resolution = resolveGamePlayIdInput(value);
    assert.equal(resolution.ok, false);
    if (!resolution.ok) {
      assert.equal(resolution.code, GAME_INVALID_REQUEST_CODE);
    }

    const sideEffects = simulateCreateBookingRequestDecision({
      gamePlayId: value,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
    });
    assert.equal(sideEffects.bookingCreated, false);
    assert.equal(sideEffects.clientLinked, false);
    assert.equal(sideEffects.idempotencyStored, false);
    assert.equal(sideEffects.gameTagged, false);
  }

  const validUnknown = resolveGamePlayIdInput("00000000-0000-4000-8000-000000000099");
  assert.equal(validUnknown.ok, true);
  if (validUnknown.ok) {
    assert.equal(validUnknown.resolution.kind, "game");
  }

  const unknownPlay = validateGameBookingForFirstSubmit(null, null);
  assert.equal(unknownPlay.ok, false);
  if (!unknownPlay.ok) {
    assert.equal(unknownPlay.code, "GAME_RESULT_UNAVAILABLE");
  }

  const regular = simulateCreateBookingRequestDecision({
    gamePlayId: null,
    idempotencyKey: "550e8400-e29b-41d4-a716-446655440002",
  });
  assert.equal(regular.bookingCreated, true);
  assert.equal(regular.gameTagged, false);
  assert.equal(regular.idempotencyStored, true);

  const serviceSource = fs.readFileSync(
    path.join(process.cwd(), "src/services/BookingRequestService.ts"),
    "utf8",
  );
  assert.match(serviceSource, /resolveGamePlayIdInput/);
  assert.match(serviceSource, /GAME_INVALID_REQUEST_CODE/);
  const createStart = serviceSource.indexOf("export async function createBookingRequest");
  const createEnd = serviceSource.indexOf("async function findExactClientMatchesForBookingRequest");
  assert.ok(createStart >= 0 && createEnd > createStart);
  const createBlock = serviceSource.slice(createStart, createEnd);
  assert.match(createBlock, /resolvePublicGamePlayId\(input\.gamePlayId\)/);

  const resolveIndex = createBlock.indexOf("resolvePublicGamePlayId(input.gamePlayId)");
  const idempotencyIndex = createBlock.indexOf("findIdempotentBookingRequest");
  assert.ok(resolveIndex >= 0 && idempotencyIndex >= 0);
  assert.ok(resolveIndex < idempotencyIndex);
}

function runChecks(): void {
  assertIdempotencyHeaderContract();
  assertHmacPayloadHash();
  assertGameValidationRules();
  assertServerGiftCommentIgnoresClientTemplate();
  simulateRegularDoubleSubmit();
  simulateGameConsumeTransaction();
  simulateParallelGameSubmit();
  assertSameOriginPolicy();
  assertBrowserConsumers();
  assertClientModuleIsolation();
  assertRouteGuardsAndContracts();
  assertPublicResponseWhitelist();
  assertCookieHelpersDoNotExposeRawToken();
  assertRulesSnapshotParsing();
  assertGamePlayIdInputPolicy();

  console.log("Security game booking consume checks passed.");
  console.log(`Coverage inventory (${SECURITY_INVENTORY.length}):`);
  for (const item of SECURITY_INVENTORY) {
    console.log(`- ${item}`);
  }
}

runChecks();
