process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateGamePlayBody } from "../src/lib/game/play-contract";
import { buildServerGameManagerComment } from "../src/lib/game/game-lead-messages";
import {
  extractGameBookingUserMessage,
  isClientGameMessageTemplate,
  isManagerGameMessageTemplate,
} from "../src/lib/game/game-booking-comment";
import {
  buildGamePlayConsumeWhere,
  GAME_PLAY_BOOKING_MAX_AGE_MS,
  shouldRejectGamePlayLink,
  validateGamePlayBookingRecord,
} from "../src/lib/game/game-play-booking";
import { buildServerEligibleGiftPool } from "../src/lib/game/server-gift-pool";
import {
  normalizeGiftWeight,
  weightedGiftPick,
} from "../src/lib/game/weighted-gift-pick";
import { getRateLimitPolicy } from "../src/lib/security/rate-limit/policies";

type MockGift = {
  id: string;
  name: string;
  isActive: boolean;
  probability: number;
  requiredPremiumLevel: number;
  allowedGameDirections: string[];
  allowedResultTypes: string[];
};

const SEED_GIFTS: MockGift[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Уход для рук",
    isActive: true,
    probability: 50,
    requiredPremiumLevel: 0,
    allowedGameDirections: [],
    allowedResultTypes: [],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Холодная плазма губ",
    isActive: true,
    probability: 25,
    requiredPremiumLevel: 0,
    allowedGameDirections: ["faceCare", "faceMassage"],
    allowedResultTypes: [],
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Лазерная биоревитализация",
    isActive: true,
    probability: 18,
    requiredPremiumLevel: 0,
    allowedGameDirections: ["faceCare", "recovery", "toneCare"],
    allowedResultTypes: [],
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Формула сияния",
    isActive: true,
    probability: 7,
    requiredPremiumLevel: 2,
    allowedGameDirections: ["toneCare", "recovery"],
    allowedResultTypes: [],
  },
];

function resolveServerPool(_clientInput: {
  premiumLevel: number;
  gameDirection: string;
  resultType: string;
}): MockGift[] {
  return buildServerEligibleGiftPool(SEED_GIFTS);
}

function runPremiumSpoofTests(): void {
  const pool = resolveServerPool({
    premiumLevel: 999,
    gameDirection: "recovery",
    resultType: "recovery",
  });

  assert.equal(
    pool.some((gift) => gift.name === "Формула сияния"),
    false,
    "premiumLevel:999 must not open premium gift pool",
  );
  assert.ok(pool.length > 0, "standard gift pool remains available");
}

function runDirectionSpoofTests(): void {
  const faceCarePool = resolveServerPool({
    premiumLevel: 0,
    gameDirection: "faceCare",
    resultType: "faceCare",
  });
  const recoveryPool = resolveServerPool({
    premiumLevel: 999,
    gameDirection: "recovery",
    resultType: "recovery",
  });

  assert.deepEqual(
    faceCarePool.map((gift) => gift.id),
    recoveryPool.map((gift) => gift.id),
    "client direction/result must not change server pool composition",
  );
  assert.equal(
    faceCarePool.some((gift) => gift.name === "Формула сияния"),
    false,
    "direction spoof must not unlock premium gift",
  );
}

function runGiftIdContractTests(): void {
  const rejected = validateGamePlayBody({
    giftId: "44444444-4444-4444-8444-444444444444",
    gameDirection: "faceCare",
    skinNeed: "hydration",
    resultType: "faceCare",
    premiumLevel: 0,
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.match(rejected.error, /giftId/i);
  }

  const accepted = validateGamePlayBody({
    gameDirection: "faceCare",
    skinNeed: "hydration",
    resultType: "faceCare",
    premiumLevel: 0,
  });
  assert.equal(accepted.ok, true);
}

function runInactiveGamePolicyTests(): void {
  const source = fs.readFileSync(
    path.join("src", "services", "GamePlayService.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /selectedGiftId:\s*null[\s\S]*return\s+\{\s*playId/,
    "inactive game must not create GamePlay with null gift",
  );
  assert.match(source, /throw new GamePlayUnavailableError/);
}

function runGamePlayBookingValidationTests(): void {
  const now = new Date("2026-07-11T12:00:00.000Z");

  const missing = validateGamePlayBookingRecord(null, now);
  assert.equal(missing.ok, false);

  const stale = validateGamePlayBookingRecord(
    {
      id: "play-stale",
      leadId: null,
      createdAt: new Date(now.getTime() - GAME_PLAY_BOOKING_MAX_AGE_MS - 1),
      gameDirection: "faceCare",
      selectedGiftId: "11111111-1111-4111-8111-111111111111",
      selectedGift: { name: "Уход для рук" },
    },
    now,
  );
  assert.equal(stale.ok, false);

  const withoutGift = validateGamePlayBookingRecord(
    {
      id: "play-no-gift",
      leadId: null,
      createdAt: now,
      gameDirection: "faceCare",
      selectedGiftId: null,
      selectedGift: null,
    },
    now,
  );
  assert.equal(withoutGift.ok, false);

  const used = validateGamePlayBookingRecord(
    {
      id: "play-used",
      leadId: "lead-1",
      createdAt: now,
      gameDirection: "faceCare",
      selectedGiftId: "11111111-1111-4111-8111-111111111111",
      selectedGift: { name: "Уход для рук" },
    },
    now,
  );
  assert.equal(used.ok, false);

  const valid = validateGamePlayBookingRecord(
    {
      id: "play-valid",
      leadId: null,
      createdAt: now,
      gameDirection: "recovery",
      selectedGiftId: "33333333-3333-4333-8333-333333333333",
      selectedGift: { name: "Лазерная биоревитализация" },
    },
    now,
  );
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.giftName, "Лазерная биоревитализация");
  }
}

function runAtomicLinkTests(): void {
  assert.equal(shouldRejectGamePlayLink(0), true);
  assert.equal(shouldRejectGamePlayLink(1), false);
  assert.equal(shouldRejectGamePlayLink(2), true);

  const minCreatedAt = new Date(Date.now() - GAME_PLAY_BOOKING_MAX_AGE_MS);
  const where = buildGamePlayConsumeWhere("play-id", minCreatedAt);
  assert.equal(where.id, "play-id");
  assert.equal(where.leadId, null);
  assert.deepEqual(where.selectedGiftId, { not: null });
  assert.ok(where.createdAt.gte instanceof Date);
}

function runServerGiftCommentTests(): void {
  const comment = buildServerGameManagerComment({
    gameDirection: "recovery",
    giftName: "Уход для рук",
    userMessage: "Хочу записаться на выходных",
  });

  assert.match(comment, /Подарок \(назначен сервером\):/);
  assert.match(comment, /Уход для рук/);
  assert.match(comment, /Хочу записаться на выходных/);
  assert.doesNotMatch(comment, /Лазерная биоревитализация/);

  const withoutUser = buildServerGameManagerComment({
    gameDirection: "toneCare",
    giftName: "Уход для рук",
    userMessage: null,
  });
  assert.doesNotMatch(withoutUser, /Сообщение клиента:/);

  const spoofed = buildServerGameManagerComment({
    gameDirection: "faceCare",
    giftName: "Уход для рук",
    userMessage: "serviceName spoof",
  });
  assert.doesNotMatch(spoofed, /serviceName spoof.*Подарок/);
}

function runGameCommentRegressionTests(): void {
  const legacyClientTemplate = [
    "Здравствуйте! Я прошла игру «Поймай своё время».",
    "",
    "Мой результат:",
    "Упругость и сияние кожи",
    "",
    "Мой подарок:",
    "Лазерная биоревитализация",
    "",
    "Хочу узнать подробнее и получить подарок к записи.",
  ].join("\n");

  assert.equal(extractGameBookingUserMessage(legacyClientTemplate), null);

  const nestedManagerTemplate = buildServerGameManagerComment({
    gameDirection: "toneCare",
    giftName: "Уход для рук",
    userMessage: legacyClientTemplate,
  });
  const serverComment = buildServerGameManagerComment({
    gameDirection: "toneCare",
    giftName: "Уход для рук",
    userMessage: extractGameBookingUserMessage(nestedManagerTemplate),
  });

  assert.equal(
    (serverComment.match(/Подарок \(назначен сервером\):/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(serverComment, /Лазерная биоревитализация/);
  assert.doesNotMatch(serverComment, /Сообщение клиента:/);

  const realUserText = "Можно записаться в субботу после 15:00";
  const withRealUser = buildServerGameManagerComment({
    gameDirection: "toneCare",
    giftName: "Уход для рук",
    userMessage: extractGameBookingUserMessage(realUserText),
  });
  assert.match(withRealUser, /Сообщение клиента:/);
  assert.equal(
    (withRealUser.match(/Можно записаться в субботу после 15:00/g) ?? []).length,
    1,
  );

  assert.equal(isClientGameMessageTemplate(legacyClientTemplate), true);
  assert.equal(isManagerGameMessageTemplate(serverComment), true);
}

function runVanillaGameMountRegressionTests(): void {
  const appSource = fs.readFileSync(
    path.join("public", "poimay-game", "js", "app.js"),
    "utf8",
  );
  assert.match(appSource, /window\.PoimayGameApp/);
  assert.match(appSource, /mount:\s*mountApp/);
  assert.match(appSource, /destroy:\s*destroyApp/);
  assert.doesNotMatch(appSource, /DOMContentLoaded/);

  const gameSource = fs.readFileSync(
    path.join("public", "poimay-game", "js", "game.js"),
    "utf8",
  );
  assert.match(gameSource, /destroy:\s*destroy/);

  const reactSource = fs.readFileSync(
    path.join("src", "components", "game", "procedure-gift-game-vanilla.tsx"),
    "utf8",
  );
  assert.match(reactSource, /PoimayGameApp/);
  assert.match(reactSource, /poimayApp\?\.mount/);
  assert.match(reactSource, /poimayApp\?\.destroy/);
  assert.match(reactSource, /gameRuntimeReady/);
  assert.doesNotMatch(reactSource, /buildManagerGameComment/);
  assert.match(reactSource, /comment: userComment/);
  assert.match(reactSource, /buildIdempotencyHeaders/);
}

function runNonGameBookingRegressionTests(): void {
  const source = fs.readFileSync(
    path.join("src", "services", "BookingRequestService.ts"),
    "utf8",
  );
  assert.match(source, /if \(resolvedGamePlayId\)/);
  assert.match(source, /createRegularBookingRequest/);
  assert.match(source, /resolveLeadSource\(null\)/);
  assert.match(source, /resolveGamePlayIdInput/);
  assert.match(source, /GAME_INVALID_REQUEST_CODE/);
}

function runWeightedPickerTests(): void {
  assert.equal(normalizeGiftWeight(-5), 0);
  assert.equal(normalizeGiftWeight(0), 0);
  assert.equal(normalizeGiftWeight(12.9), 12);

  const onlyZero = weightedGiftPick([
    { probability: 0 },
    { probability: -3 },
  ]);
  assert.equal(onlyZero, null);

  const relative = weightedGiftPick([
    { probability: 50, id: "a" },
    { probability: 25, id: "b" },
  ] as Array<{ probability: number; id: string }>);
  assert.ok(relative);
}

function runGameRateLimitPolicyTest(): void {
  const policy = getRateLimitPolicy("gamePlay");
  assert.equal(policy.windowMs, 10 * 60 * 1000);
  assert.equal(policy.maxRequests, 5);

  const bookingPolicy = getRateLimitPolicy("bookingRequest");
  assert.equal(bookingPolicy.maxRequests, 10);
}

function runMiddlewareCryptoIsolationTest(): void {
  const middlewareSource = fs.readFileSync(
    path.join("src", "middleware.ts"),
    "utf8",
  );
  assert.doesNotMatch(middlewareSource, /node:crypto|from "crypto"/);
}

function runBookingServiceAtomicTransactionTests(): void {
  const source = fs.readFileSync(
    path.join("src", "services", "BookingRequestService.ts"),
    "utf8",
  );
  assert.match(source, /\$transaction/);
  assert.match(source, /updateMany/);
  assert.match(source, /playUpdated\.count !== 1/);
  assert.match(source, /sessionUpdated\.count !== 1/);
  assert.match(source, /buildServerGameBookingComment/);
  assert.match(source, /extractGameBookingCommentForPayload/);
  assert.doesNotMatch(
    source,
    /\/\/ Связка optional: заявку не блокируем/,
  );
}

function main(): void {
  runPremiumSpoofTests();
  runDirectionSpoofTests();
  runGiftIdContractTests();
  runInactiveGamePolicyTests();
  runGamePlayBookingValidationTests();
  runAtomicLinkTests();
  runServerGiftCommentTests();
  runGameCommentRegressionTests();
  runVanillaGameMountRegressionTests();
  runNonGameBookingRegressionTests();
  runWeightedPickerTests();
  runGameRateLimitPolicyTest();
  runMiddlewareCryptoIsolationTest();
  runBookingServiceAtomicTransactionTests();
  console.log("Security Batch 2B C0 checks passed.");
}

main();
