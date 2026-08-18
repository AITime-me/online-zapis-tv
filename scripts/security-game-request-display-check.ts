/**
 * Compact game booking display + historical gift snapshot.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildServerGameBookingComment,
  extractGameBookingCommentForPayload,
  resolveGameGiftFromPlay,
  type GamePlayBookingRow,
} from "../src/lib/game/game-booking-consume-rules";
import { isManagerGameMessageTemplate } from "../src/lib/game/game-booking-comment";
import { buildGiftSnapshot } from "../src/lib/game/session/game-session-snapshot";
import {
  buildGameBookingRequestDisplay,
  formatGameBookingRequestCompactComment,
  LEGACY_CATCH_TIME_GAME_TITLE,
} from "../src/lib/schedule/game-booking-request-display";
import {
  extractGiftFromBookingComment,
  getScheduleBookingRequestSourceLabel,
  toMasterScheduleBookingRequest,
  type FullScheduleBookingRequestDto,
} from "../src/lib/schedule/booking-request-schedule";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const CATALOG_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const PLAY_ID = "33333333-3333-4333-8333-333333333333";
const GIFT_ID = "55555555-5555-4555-8555-555555555555";

function basePlay(overrides: Partial<GamePlayBookingRow> = {}): GamePlayBookingRow {
  return {
    id: PLAY_ID,
    gameDirection: "faceCare",
    gameCatalogId: CATALOG_ID,
    gameSessionId: SESSION_ID,
    selectedGiftId: GIFT_ID,
    leadId: null,
    consumedAt: null,
    giftSnapshot: buildGiftSnapshot(
      {
        id: GIFT_ID,
        name: "Скидка 15%",
        shortDescription: "Скидка на процедуру",
        image: null,
        priority: "standard",
        cardStyle: "default",
        activationMode: "SINGLE_PAID_SERVICE",
        minCourseSessions: null,
        activationConditionText: "К одной оплаченной услуге",
      },
      new Date("2026-08-01T10:00:00.000Z"),
    ),
    rulesSnapshot: {
      campaignKey: "wheel-v1",
      rulesVersion: "1",
      mechanicType: "WHEEL_OF_FORTUNE",
      serverResultTier: 0,
      probabilityBucket: "tier-0",
      bookingWindowHours: 72,
      catalogSlug: "wheel-of-fortune",
      catalogTitle: "Колесо фортуны",
    },
    selectedGift: {
      name: "Живой подарок (не должен побеждать snapshot)",
      shortDescription: "live",
    },
    gameCatalog: {
      id: CATALOG_ID,
      slug: "wheel-of-fortune",
      title: "Колесо фортуны",
    },
    gameSession: {
      id: SESSION_ID,
      gameCatalogId: CATALOG_ID,
      tokenHash: "hash",
      status: "COMPLETED",
      claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      consumedAt: null,
    },
    ...overrides,
  };
}

function assertWheelCompactDisplay(): void {
  const play = basePlay({
    gameDirection: "wheel",
    giftSnapshot: {
      ...buildGiftSnapshot(
        {
          id: GIFT_ID,
          name: "Уход для рук в подарок",
          shortDescription: "Уход",
          image: null,
          priority: "standard",
          cardStyle: "default",
          activationMode: "SINGLE_PAID_SERVICE",
          minCourseSessions: null,
          activationConditionText: "К одной оплаченной услуге",
        },
        new Date("2026-08-01T10:00:00.000Z"),
      ),
      confirmedInterest: "refresh",
      confirmedZone: "brows",
      originalPrize: {
        giftId: "orig",
        name: "Биоревитализант к перманенту губ в подарок",
        systemKey: "lips_biorevitalizant_upgrade",
      },
      finalPrize: {
        giftId: GIFT_ID,
        name: "Уход для рук в подарок",
        systemKey: "hand_care_gift",
      },
    },
  });

  const display = buildGameBookingRequestDisplay({
    serviceNameSnapshot: null,
    comment: [
      "Клиент прошёл игру «Колесо фортуны».",
      "",
      "Интерес: Рефреш",
      "Зона: brows",
      "Исходный приз: Биоревитализант к перманенту губ в подарок",
      "Итоговый приз: Уход для рук в подарок",
    ].join("\n"),
    play,
  });

  assert.ok(display);
  assert.equal(display!.catalogTitle, "Колесо фортуны");
  assert.equal(display!.procedure, "Рефреш");
  assert.equal(display!.zone, "Брови");
  assert.equal(display!.giftName, "Уход для рук в подарок");
  assert.equal(display!.clientMessage, null);

  const compact = formatGameBookingRequestCompactComment(display!);
  assert.equal(
    compact,
    [
      "Процедура: Рефреш",
      "Зона: Брови",
      "Итоговый подарок: Уход для рук в подарок",
    ].join("\n"),
  );
  assert.doesNotMatch(compact, /Клиент прошёл игру/);
  assert.doesNotMatch(compact, /Условие получения/);
  assert.doesNotMatch(compact, /\bbrows\b/);
  assert.doesNotMatch(compact, /^—$/m);
}

function assertProcedureAndClientMessage(): void {
  const play = basePlay({
    gameDirection: "faceCare",
    rulesSnapshot: {
      campaignKey: null,
      rulesVersion: "1",
      mechanicType: "CATCH_TIME",
      serverResultTier: 1,
      probabilityBucket: "tier-1",
      bookingWindowHours: 48,
      catalogSlug: "procedure-gift",
      catalogTitle: "Поймай своё время",
    },
    gameCatalog: {
      id: CATALOG_ID,
      slug: "procedure-gift",
      title: "Поймай своё время",
    },
  });

  const display = buildGameBookingRequestDisplay({
    serviceNameSnapshot: "Массаж лица",
    comment: [
      "Клиент прошёл игру «Поймай своё время».",
      "",
      "Подарок (назначен сервером):",
      "Скидка 15%",
      "",
      "Сообщение клиента:",
      "Можно после 18:00",
    ].join("\n"),
    play,
  });

  assert.ok(display);
  assert.equal(display!.procedure, "Массаж лица");
  assert.equal(display!.zone, "Уход за кожей лица");
  assert.equal(display!.giftName, "Скидка 15%");
  assert.equal(display!.clientMessage, "Можно после 18:00");

  const compact = formatGameBookingRequestCompactComment(display!);
  assert.match(compact, /^Процедура: Массаж лица$/m);
  assert.match(compact, /^Зона: Уход за кожей лица$/m);
  assert.match(compact, /^Итоговый подарок: Скидка 15%$/m);
  assert.match(compact, /^Сообщение клиента: Можно после 18:00$/m);
}

function assertHistoricalGiftSnapshotWinsOverLiveGift(): void {
  const play = basePlay({
    giftSnapshot: buildGiftSnapshot(
      {
        id: GIFT_ID,
        name: "Исторический подарок",
        shortDescription: "как было на момент игры",
        image: null,
        priority: "standard",
        cardStyle: "default",
        activationMode: "SINGLE_PAID_SERVICE",
        minCourseSessions: null,
        activationConditionText: "Старое условие",
      },
      new Date("2026-07-01T10:00:00.000Z"),
    ),
    selectedGift: {
      name: "Новое название после редактирования",
      shortDescription: "новое описание",
    },
  });

  const resolved = resolveGameGiftFromPlay(play);
  assert.equal(resolved?.giftName, "Исторический подарок");

  const display = buildGameBookingRequestDisplay({
    serviceNameSnapshot: null,
    comment: null,
    play,
  });
  assert.equal(display?.giftName, "Исторический подарок");
}

function assertCommentBeatsLiveGiftWhenSnapshotMissing(): void {
  const play = basePlay({
    giftSnapshot: null,
    selectedGift: {
      name: "Новое название после редактирования",
      shortDescription: "новое",
    },
  });

  const display = buildGameBookingRequestDisplay({
    serviceNameSnapshot: null,
    comment: "Подарок (назначен сервером):\nИсторический из комментария",
    play,
  });
  assert.equal(display?.giftName, "Исторический из комментария");
}

function assertLegacyFallbackWithoutCatalogTitle(): void {
  const play = basePlay({
    rulesSnapshot: null,
    gameCatalog: null,
    gameDirection: "faceMassage",
  });

  const display = buildGameBookingRequestDisplay({
    serviceNameSnapshot: null,
    comment: null,
    play,
  });

  assert.equal(display?.catalogTitle, LEGACY_CATCH_TIME_GAME_TITLE);
  assert.equal(
    getScheduleBookingRequestSourceLabel({
      type: "CONSULTATION_REQUEST",
      isFromGame: true,
      gameDisplay: display!,
    }),
    `Игра «${LEGACY_CATCH_TIME_GAME_TITLE}»`,
  );
}

function assertOrdinaryRequestUnchanged(): void {
  const full: FullScheduleBookingRequestDto = {
    id: "req-1",
    createdAt: "2026-08-01T10:00:00.000Z",
    clientName: "Анна",
    clientPhone: "+79001112233",
    comment: "Обычный комментарий",
    status: "NEW",
    type: "MANAGER_REQUEST",
    isFromGame: false,
    gameDisplay: null,
    masterName: null,
    serviceId: null,
    serviceNameSnapshot: "Чистка",
    appointmentId: null,
    appointmentStartsAt: null,
    appointmentServiceName: null,
    appointmentScheduleHref: null,
  };

  assert.equal(
    getScheduleBookingRequestSourceLabel(full),
    "Онлайн-запись",
  );
  const master = toMasterScheduleBookingRequest(full);
  assert.equal(master.gameDisplay, null);
  assert.equal(master.serviceNameSnapshot, "Чистка");
  assert.equal("comment" in master, false);
}

function assertGiftCommentMarkers(): void {
  assert.equal(
    extractGiftFromBookingComment(
      "Подарок (назначен сервером):\nСкидка 20%",
    ),
    "Скидка 20%",
  );
  assert.equal(
    extractGiftFromBookingComment("Итоговый приз:\nУход за руками"),
    "Уход за руками",
  );
  assert.equal(
    extractGiftFromBookingComment("Итоговый подарок:\nУход для рук в подарок"),
    "Уход для рук в подарок",
  );
  assert.equal(extractGiftFromBookingComment("Подарок:\nСтарый формат"), "Старый формат");
}

function assertWheelManagerCommentNotUserMessage(): void {
  const wheelComment = [
    "Клиент прошёл игру «Колесо фортуны».",
    "",
    "Интерес: Губы",
    "Зона: lips",
    "Итоговый приз: Скидка 10%",
  ].join("\n");

  assert.equal(isManagerGameMessageTemplate(wheelComment), true);
  assert.equal(extractGameBookingCommentForPayload(wheelComment), null);

  const play = basePlay({ gameDirection: "wheel" });
  const comment = buildServerGameBookingComment({
    play,
    gift: resolveGameGiftFromPlay(play)!,
    userMessage: extractGameBookingCommentForPayload(wheelComment),
  });
  assert.match(comment, /Клиент прошёл игру «Колесо фортуны»/);
  assert.doesNotMatch(comment, /Сообщение клиента:[\s\S]*Клиент прошёл игру/);
}

function assertStaticWiring(): void {
  const card = read("src/components/schedule/schedule-booking-request-card.tsx");
  assert.match(card, /formatGameBookingRequestCompactComment/);
  assert.match(card, /gameDisplay/);
  assert.doesNotMatch(card, /Игра «Поймай своё время»/);

  const scheduleLib = read("src/lib/schedule/booking-request-schedule.ts");
  assert.match(scheduleLib, /gameDisplay/);
  assert.match(scheduleLib, /LEGACY_CATCH_TIME_GAME_TITLE/);

  const service = read("src/services/BookingRequestService.ts");
  assert.match(service, /buildGameBookingRequestDisplay/);
  assert.match(service, /giftSnapshot:\s*true/);
}

function main(): void {
  assertWheelCompactDisplay();
  assertProcedureAndClientMessage();
  assertHistoricalGiftSnapshotWinsOverLiveGift();
  assertCommentBeatsLiveGiftWhenSnapshotMissing();
  assertLegacyFallbackWithoutCatalogTitle();
  assertOrdinaryRequestUnchanged();
  assertGiftCommentMarkers();
  assertWheelManagerCommentNotUserMessage();
  assertStaticWiring();
  console.log("security-game-request-display-check: OK");
}

main();
