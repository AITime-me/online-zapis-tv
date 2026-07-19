process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CANONICAL_GIFT_ACTIVATION,
  DEFAULT_COURSE_MIN_SESSIONS,
  FORBIDDEN_CLIENT_GIFT_ACTIVATION_KEYS,
  GIFT_STACKING_RULE_TEXT,
  GIFT_VALIDITY_DAYS,
  SINGLE_PAID_SERVICE_CONDITION_TEXT,
  buildCourseMinSessionsConditionText,
  buildGiftActivationSnapshotFields,
  collectForbiddenClientGiftActivationKeys,
  generateActivationConditionText,
  resolveCanonicalGiftActivation,
  validateGiftActivationInput,
} from "../src/lib/game/gift-activation";
import {
  buildClientGameMessage,
  buildServerGameManagerComment,
} from "../src/lib/game/game-lead-messages";
import {
  buildServerGameBookingComment,
  resolveGameGiftFromPlay,
  type GamePlayBookingRow,
} from "../src/lib/game/game-booking-consume-rules";
import {
  buildGiftSnapshot,
  parseGiftSnapshot,
  publicGiftFromSnapshot,
} from "../src/lib/game/session/game-session-snapshot";
import { validateSessionCompleteBody } from "../src/lib/game/session/game-session-contract";
import { validateGamePlayBody } from "../src/lib/game/play-contract";
import { buildCatalogScopedGiftPool } from "../src/lib/game/session/catalog-gift-pool";
import { PREMIUM_TIERS_ENABLED } from "../src/lib/game/tier/server-tier-policy";
import { CANONICAL_GAME_GIFTS } from "./ops/lib/game-promotions-canonical";
import {
  computeGameGiftActivationPreflightCounters,
  GAME_GIFT_ACTIVATION_PREFLIGHT_COUNTER_ORDER,
  giftActivationSchemaForm,
  parseGameGiftActivationPreflightPsqlRow,
  preflightCountersAreClean,
  HANDS_GIFT_ID,
  COURSE_GIFT_IDS,
} from "./ops/lib/game-gift-activation-preflight-counters";

const ROOT = process.cwd();
const MIGRATION_SQL = path.join(
  ROOT,
  "prisma",
  "migrations",
  "20260720120000_game_gift_activation_conditions",
  "migration.sql",
);
const PREFLIGHT_SQL = path.join(
  ROOT,
  "scripts",
  "ops",
  "lib",
  "game-gift-activation-preflight.sql",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertActivationModesAndValidation(): void {
  const single = validateGiftActivationInput({
    activationMode: "SINGLE_PAID_SERVICE",
    minCourseSessions: 5,
    activationConditionText: "",
  });
  assert.equal(single.ok, true);
  if (single.ok) {
    assert.equal(single.value.minCourseSessions, null);
    assert.equal(
      single.value.activationConditionText,
      SINGLE_PAID_SERVICE_CONDITION_TEXT,
    );
  }

  const course = validateGiftActivationInput({
    activationMode: "COURSE_MIN_SESSIONS",
    minCourseSessions: DEFAULT_COURSE_MIN_SESSIONS,
  });
  assert.equal(course.ok, true);
  if (course.ok) {
    assert.equal(course.value.minCourseSessions, 5);
    assert.equal(
      course.value.activationConditionText,
      buildCourseMinSessionsConditionText(5),
    );
  }

  const badCourse = validateGiftActivationInput({
    activationMode: "COURSE_MIN_SESSIONS",
    minCourseSessions: null,
  });
  assert.equal(badCourse.ok, false);

  const badZero = validateGiftActivationInput({
    activationMode: "COURSE_MIN_SESSIONS",
    minCourseSessions: 0,
  });
  assert.equal(badZero.ok, false);

  const tooLong = validateGiftActivationInput({
    activationMode: "SINGLE_PAID_SERVICE",
    activationConditionText: "x".repeat(501),
  });
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) {
    assert.match(tooLong.error, /500/);
    assert.doesNotMatch(tooLong.error, /xxxxx/);
  }

  const atLimit = validateGiftActivationInput({
    activationMode: "SINGLE_PAID_SERVICE",
    activationConditionText: "y".repeat(500),
  });
  assert.equal(atLimit.ok, true);

  assert.throws(() =>
    buildGiftActivationSnapshotFields({
      activationMode: "SINGLE_PAID_SERVICE",
      minCourseSessions: null,
      activationConditionText: "z".repeat(501),
    }),
  );
}

function assertCanonicalFourGifts(): void {
  const hands = resolveCanonicalGiftActivation(
    "11111111-1111-4111-8111-111111111111",
  );
  assert.ok(hands);
  assert.equal(hands!.activationMode, "SINGLE_PAID_SERVICE");
  assert.equal(hands!.minCourseSessions, null);
  assert.equal(hands!.activationConditionText, SINGLE_PAID_SERVICE_CONDITION_TEXT);

  for (const id of [
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  ]) {
    const rule = resolveCanonicalGiftActivation(id);
    assert.ok(rule);
    assert.equal(rule!.activationMode, "COURSE_MIN_SESSIONS");
    assert.equal(rule!.minCourseSessions, 5);
    assert.match(rule!.activationConditionText, /минимум из 5 процедур/);
  }

  assert.equal(Object.keys(CANONICAL_GIFT_ACTIVATION).length, 4);

  for (const gift of CANONICAL_GAME_GIFTS) {
    const expected = CANONICAL_GIFT_ACTIVATION[gift.id];
    assert.ok(expected);
    assert.equal(gift.activationMode, expected.activationMode);
    assert.equal(gift.minCourseSessions, expected.minCourseSessions);
    assert.equal(
      gift.activationConditionText,
      generateActivationConditionText(
        expected.activationMode,
        expected.minCourseSessions,
      ),
    );
  }
}

function assertServerSideSnapshotImmutable(): void {
  const assignedAt = new Date("2026-07-19T12:00:00.000Z");
  const snapshot = buildGiftSnapshot(
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Уход для рук",
      shortDescription: "desc",
      image: null,
      priority: "main",
      cardStyle: "default",
      activationMode: "SINGLE_PAID_SERVICE",
      minCourseSessions: null,
      activationConditionText: SINGLE_PAID_SERVICE_CONDITION_TEXT,
    },
    assignedAt,
  );

  assert.equal(snapshot.activationMode, "SINGLE_PAID_SERVICE");
  assert.equal(snapshot.validityDays, GIFT_VALIDITY_DAYS);
  assert.equal(snapshot.activationConditionText, SINGLE_PAID_SERVICE_CONDITION_TEXT);
  assert.equal("probability" in snapshot, false);

  const publicGift = publicGiftFromSnapshot(snapshot)!;
  assert.equal(publicGift.activationConditionText, SINGLE_PAID_SERVICE_CONDITION_TEXT);
  assert.equal(publicGift.validityDays, 30);
  assert.equal("activationMode" in publicGift, false);
  assert.equal("minCourseSessions" in publicGift, false);
  assert.equal("giftId" in publicGift, false);

  // Editing live gift after snapshot must not change parsed snapshot.
  const frozen = structuredClone(snapshot);
  const liveEdited = buildGiftActivationSnapshotFields({
    activationMode: "COURSE_MIN_SESSIONS",
    minCourseSessions: 10,
    activationConditionText: "CHANGED AFTER EDIT",
  });
  assert.notEqual(frozen.activationConditionText, liveEdited.activationConditionText);

  const reparsed = parseGiftSnapshot(frozen);
  assert.equal(reparsed!.activationConditionText, SINGLE_PAID_SERVICE_CONDITION_TEXT);
  assert.equal(reparsed!.activationMode, "SINGLE_PAID_SERVICE");

  // Legacy snapshots without activation fields still parse with a neutral fallback.
  const legacy = parseGiftSnapshot({
    giftId: "x",
    name: "Old",
    shortDescription: "s",
    image: null,
    priority: "standard",
    cardStyle: "default",
    ruleType: "weighted_pool",
    assignedValue: null,
    assignedAt: assignedAt.toISOString(),
  });
  assert.ok(legacy);
  assert.equal(legacy!.activationMode, null);
  assert.equal(legacy!.minCourseSessions, null);
  assert.match(legacy!.activationConditionText, /на момент игры|менеджер/i);
  assert.doesNotMatch(
    legacy!.activationConditionText,
    /одну оплачиваемую процедуру/,
  );
  assert.doesNotMatch(legacy!.activationConditionText, /курс минимум/);
  assert.equal(legacy!.validityDays, 30);

  // New snapshots always carry a concrete business mode.
  assert.ok(snapshot.activationMode === "SINGLE_PAID_SERVICE");
}

function assertBodySpoofRejected(): void {
  const complete = validateSessionCompleteBody({
    catalogSlug: "procedure-gift",
    gameDirection: "faceCare",
    skinNeed: "need",
    resultType: "type",
    giftId: "attacker-gift",
    activationMode: "COURSE_MIN_SESSIONS",
    minCourseSessions: 1,
    activationConditionText: "spoofed",
    validityDays: 999,
  });
  assert.equal(complete.ok, false);

  const play = validateGamePlayBody({
    gameDirection: "faceCare",
    skinNeed: "need",
    resultType: "type",
    activationConditionText: "spoofed",
  });
  assert.equal(play.ok, false);

  const giftSnapshotComplete = validateSessionCompleteBody({
    catalogSlug: "procedure-gift",
    gameDirection: "faceCare",
    skinNeed: "need",
    resultType: "type",
    giftSnapshot: {
      giftId: "spoof",
      activationConditionText: "client override",
    },
  });
  assert.equal(giftSnapshotComplete.ok, false);
  if (!giftSnapshotComplete.ok) {
    assert.match(giftSnapshotComplete.error, /giftSnapshot не поддерживается/);
    assert.doesNotMatch(giftSnapshotComplete.error, /client override|spoof/);
  }

  const giftSnapshotPlay = validateGamePlayBody({
    gameDirection: "faceCare",
    skinNeed: "need",
    resultType: "type",
    giftSnapshot: { name: "hacked" },
  });
  assert.equal(giftSnapshotPlay.ok, false);
  if (!giftSnapshotPlay.ok) {
    assert.match(giftSnapshotPlay.error, /giftSnapshot не поддерживается/);
  }

  const keys = collectForbiddenClientGiftActivationKeys({
    giftId: "x",
    giftSnapshot: {},
    activationMode: "SINGLE_PAID_SERVICE",
    foo: 1,
  });
  assert.ok(keys.includes("giftId"));
  assert.ok(keys.includes("giftSnapshot"));
  assert.ok(keys.includes("activationMode"));
  assert.ok(!keys.includes("foo" as never));
  assert.ok(FORBIDDEN_CLIENT_GIFT_ACTIVATION_KEYS.includes("validityDays"));
  assert.ok(FORBIDDEN_CLIENT_GIFT_ACTIVATION_KEYS.includes("giftSnapshot"));

  const bookingRoute = read("src/app/api/booking/request/route.ts");
  assert.match(bookingRoute, /rejectForbiddenClientGiftActivationFields/);
  assert.match(
    read("src/lib/game/session/game-session-contract.ts"),
    /rejectForbiddenClientGiftActivationFields/,
  );
  assert.match(
    read("src/lib/game/play-contract.ts"),
    /rejectForbiddenClientGiftActivationFields/,
  );
}

function assertMessagesAndBookingComment(): void {
  const comment = buildServerGameBookingComment({
    play: {
      id: "play-1",
      gameDirection: "faceCare",
      gameCatalogId: "cat",
      gameSessionId: "sess",
      selectedGiftId: "11111111-1111-4111-8111-111111111111",
      leadId: null,
      consumedAt: null,
      giftSnapshot: buildGiftSnapshot(
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Уход для рук",
          shortDescription: "мягкий уход",
          image: null,
          priority: "main",
          cardStyle: "default",
          activationMode: "SINGLE_PAID_SERVICE",
          minCourseSessions: null,
          activationConditionText: SINGLE_PAID_SERVICE_CONDITION_TEXT,
        },
        new Date("2026-07-19T12:00:00.000Z"),
      ),
      rulesSnapshot: {
        campaignKey: null,
        rulesVersion: "1",
        mechanicType: "CATCH_TIME",
        serverResultTier: 0,
        probabilityBucket: "tier-0",
        bookingWindowHours: 24,
        catalogSlug: "procedure-gift",
        catalogTitle: "Поймай своё время",
      },
      selectedGift: null,
      gameCatalog: { id: "cat", slug: "procedure-gift", title: "Поймай своё время" },
      gameSession: null,
    } satisfies GamePlayBookingRow,
    gift: resolveGameGiftFromPlay({
      id: "play-1",
      gameDirection: "faceCare",
      gameCatalogId: "cat",
      gameSessionId: "sess",
      selectedGiftId: "11111111-1111-4111-8111-111111111111",
      leadId: null,
      consumedAt: null,
      giftSnapshot: buildGiftSnapshot(
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Уход для рук",
          shortDescription: "мягкий уход",
          image: null,
          priority: "main",
          cardStyle: "default",
          activationMode: "SINGLE_PAID_SERVICE",
          minCourseSessions: null,
          activationConditionText: SINGLE_PAID_SERVICE_CONDITION_TEXT,
        },
        new Date("2026-07-19T12:00:00.000Z"),
      ),
      rulesSnapshot: null,
      selectedGift: null,
      gameCatalog: null,
      gameSession: null,
    })!,
    userMessage: "хочу записаться",
  });

  assert.match(comment, /Уход за кожей лица/);
  assert.match(comment, /Уход для рук/);
  assert.match(comment, /Условие получения/);
  assert.match(comment, new RegExp(SINGLE_PAID_SERVICE_CONDITION_TEXT));
  assert.match(comment, /30 календарных дней/);
  assert.match(comment, /подтверждает менеджер/i);
  assert.doesNotMatch(comment, /spoofed|attacker/);

  const clientMsg = buildClientGameMessage({
    playId: "p",
    giftId: null,
    giftName: "Холодная плазма губ",
    gameDirection: "faceCare",
    skinNeed: null,
    resultType: null,
    premiumLevel: null,
    activationConditionText: buildCourseMinSessionsConditionText(5),
    validityDays: 30,
  });
  assert.match(clientMsg, /минимум из 5 процедур/);
  assert.match(clientMsg, /не суммируются/);

  const manager = buildServerGameManagerComment({
    gameDirection: "toneCare",
    giftName: "Формула сияния",
    activationConditionText: buildCourseMinSessionsConditionText(5),
    validityDays: 30,
  });
  assert.match(manager, /Формула сияния/);
  assert.match(manager, /Условие получения/);
  assert.match(manager, new RegExp(GIFT_STACKING_RULE_TEXT));
}

function assertEligibilityUnchanged(): void {
  assert.equal(PREMIUM_TIERS_ENABLED, false);
  const gifts = [
    {
      id: "1",
      isActive: true,
      gameCatalogId: "cat",
      requiredPremiumLevel: 0,
      probability: 50,
    },
    {
      id: "2",
      isActive: true,
      gameCatalogId: "cat",
      requiredPremiumLevel: 2,
      probability: 7,
    },
  ];
  const pool = buildCatalogScopedGiftPool(gifts, "cat", 0);
  assert.equal(pool.length, 1);
  assert.equal(pool[0]!.id, "1");
}

function assertOpenRequestAndClosedReplayContracts(): void {
  const openReq = read("src/lib/game/game-open-request-policy.ts");
  assert.match(openReq, /NEW|CONTACTED/);
  assert.doesNotMatch(openReq, /lifetime|monthly.*ban|phone.?ban/i);

  const service = read("src/services/BookingRequestService.ts");
  assert.match(service, /OPEN_GAME_BOOKING_REQUEST_STATUSES/);
  assert.doesNotMatch(service, /lifetimePhoneBan|monthlyPhoneBan/);

  // After CLOSED, uniqueness partial index no longer applies — contract in migration.
  const openMigration = read(
    "prisma/migrations/20260719120000_booking_request_open_game_phone_catalog/migration.sql",
  );
  assert.match(openMigration, /status.*IN.*NEW.*CONTACTED/);
  assert.doesNotMatch(openMigration, /CLOSED/);
}

function assertUiContracts(): void {
  const vanilla = read("src/components/game/procedure-gift-game-vanilla.tsx");
  assert.match(vanilla, /Условия получения зависят от выпавшего подарка/);
  assert.match(vanilla, /будут показаны вместе с/);
  assert.match(vanilla, /gift-activation-condition/);
  assert.match(vanilla, /не суммируются/);

  const reactQuiz = read("src/components/game/procedure-gift-game.tsx");
  assert.match(reactQuiz, /activationConditionText/);
  assert.match(reactQuiz, /Срок действия подарка/);
  assert.match(reactQuiz, /календарных дней/);
  assert.match(reactQuiz, /подтверждает менеджер/);
  assert.match(reactQuiz, /не суммируются/);

  const admin = read("src/components/admin/game-panel.tsx");
  assert.match(admin, /activationMode/);
  assert.match(admin, /minCourseSessions/);
  assert.match(admin, /activationConditionText/);
  assert.match(admin, /COURSE_MIN_SESSIONS/);
  assert.match(admin, /ACTIVATION_CONDITION_TEXT_MAX_LENGTH|maxLength=\{ACTIVATION_CONDITION_TEXT_MAX_LENGTH\}/);
  assert.match(admin, /maxLength=\{ACTIVATION_CONDITION_TEXT_MAX_LENGTH\}/);
}

function assertMigrationAndPreflight(): void {
  assert.ok(fs.existsSync(MIGRATION_SQL));
  assert.ok(fs.existsSync(PREFLIGHT_SQL));
  const sql = fs.readFileSync(MIGRATION_SQL, "utf8");
  assert.match(sql, /GameGiftActivationMode/);
  assert.match(sql, /activation_mode/);
  assert.match(sql, /min_course_sessions/);
  assert.match(sql, /activation_condition_text/);
  assert.match(sql, /11111111-1111-4111-8111-111111111111/);
  assert.match(sql, /COURSE_MIN_SESSIONS/);
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /RAISE EXCEPTION/);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /UPDATE\s+"booking_requests"/i);
  assert.doesNotMatch(sql, /UPDATE\s+"game_plays"/i);

  const preflight = fs.readFileSync(PREFLIGHT_SQL, "utf8");
  assert.match(preflight, /hands_gift_missing_count/);
  assert.match(preflight, /course_gifts_missing_count/);
  assert.match(preflight, /partial_schema_count/);
  assert.match(preflight, /empty_condition_count/);
  assert.match(preflight, /course_missing_min_count/);
  assert.match(preflight, /hands_gift_mismatch_count/);
  assert.match(preflight, /course_gifts_mismatch_count/);
  const preflightWithoutComments = preflight
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(preflightWithoutComments, /\bUPDATE\b|\bDELETE\b|\bINSERT\b|\bCREATE\b|\bALTER\b/i);
  // PostgreSQL parses missing column identifiers even inside CASE branches.
  // Preflight must read new fields only via to_jsonb / JSON keys (or dual queries).
  assert.match(preflightWithoutComments, /to_jsonb\s*\(/);
  assert.match(preflightWithoutComments, /j->>'activation_mode'/);
  assert.match(preflightWithoutComments, /j->>'activation_condition_text'/);
  assert.match(preflightWithoutComments, /j->>'min_course_sessions'/);
  assert.match(preflightWithoutComments, /partial_schema_count/);
  // Forbid planner traps used to abort partial schema.
  assert.doesNotMatch(
    preflightWithoutComments,
    /'partial GameGift activation schema[^']*'::\s*int/i,
  );
  assert.doesNotMatch(preflightWithoutComments, /'[^{']+'::\s*int/);
  assert.doesNotMatch(preflightWithoutComments, /\b1\s*\/\s*0\b/);
  assert.doesNotMatch(preflightWithoutComments, /\b0\s*\/\s*0\b/);
  assert.doesNotMatch(preflightWithoutComments, /partial_guard/);
  assert.doesNotMatch(preflightWithoutComments, /"activation_mode"/);
  assert.doesNotMatch(preflightWithoutComments, /"activation_condition_text"/);
  assert.doesNotMatch(preflightWithoutComments, /"min_course_sessions"/);
  // Unquoted identifier forms (exclude information_schema string literals and JSON keys).
  const withoutSafeStringLiterals = preflightWithoutComments
    .replace(/column_name\s*=\s*'activation_mode'/g, "column_name = <ok>")
    .replace(/column_name\s*=\s*'activation_condition_text'/g, "column_name = <ok>")
    .replace(/column_name\s*=\s*'min_course_sessions'/g, "column_name = <ok>")
    .replace(/->>'activation_mode'/g, "-><ok>")
    .replace(/->>'activation_condition_text'/g, "-><ok>")
    .replace(/->>'min_course_sessions'/g, "-><ok>");
  assert.doesNotMatch(
    withoutSafeStringLiterals,
    /(?<![\w])activation_mode(?![\w])/,
  );
  assert.doesNotMatch(
    withoutSafeStringLiterals,
    /(?<![\w])activation_condition_text(?![\w])/,
  );
  assert.doesNotMatch(
    withoutSafeStringLiterals,
    /(?<![\w])min_course_sessions(?![\w])/,
  );

  const schema = read("prisma/schema.prisma");
  assert.match(schema, /enum GameGiftActivationMode/);
  assert.match(schema, /activationMode\s+GameGiftActivationMode/);
  assert.match(schema, /minCourseSessions/);
  assert.match(schema, /activationConditionText/);

  for (const scriptRel of [
    "scripts/ops/staging-preflight-game-gift-activation.sh",
    "scripts/ops/production-preflight-game-gift-activation.sh",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, scriptRel)));
    const script = read(scriptRel);
    assert.match(script, /hands_gift_missing_count=/);
    assert.match(script, /course_gifts_missing_count=/);
    assert.match(script, /partial_schema_count=/);
    assert.match(script, /empty_condition_count=/);
    assert.match(script, /partial_schema" != "0"/);
    assert.match(script, /ops_die "preflight failed/);
    assert.match(script, /preflight returned non-integer counter values/);
    assert.doesNotMatch(script, /echo\s+"\$pg_user"|printf.*PASSWORD|DATABASE_URL=/);
  }

  assertPgRegressionHarnessContract();
}

function assertPreflightMissingGiftCounters(): void {
  const postCols = {
    hasActivationMode: true,
    hasConditionText: true,
    hasMinSessions: true,
  };
  const preCols = {
    hasActivationMode: false,
    hasConditionText: false,
    hasMinSessions: false,
  };

  const canonicalOk = CANONICAL_GAME_GIFTS.map((g) => ({
    id: g.id,
    activationMode: g.activationMode,
    minCourseSessions: g.minCourseSessions,
    activationConditionText: g.activationConditionText,
  }));

  const allOk = computeGameGiftActivationPreflightCounters(canonicalOk, postCols);
  assert.equal(allOk.hands_gift_missing_count, 0);
  assert.equal(allOk.course_gifts_missing_count, 0);
  assert.ok(preflightCountersAreClean(allOk));

  const missingHands = computeGameGiftActivationPreflightCounters(
    canonicalOk.filter((g) => g.id !== HANDS_GIFT_ID),
    postCols,
  );
  assert.equal(missingHands.hands_gift_missing_count, 1);
  assert.equal(missingHands.course_gifts_missing_count, 0);
  assert.equal(preflightCountersAreClean(missingHands), false);

  const missingOneCourse = computeGameGiftActivationPreflightCounters(
    canonicalOk.filter((g) => g.id !== COURSE_GIFT_IDS[0]),
    postCols,
  );
  assert.equal(missingOneCourse.course_gifts_missing_count, 1);
  assert.equal(missingOneCourse.hands_gift_missing_count, 0);

  const missingAllCourse = computeGameGiftActivationPreflightCounters(
    canonicalOk.filter((g) => g.id === HANDS_GIFT_ID),
    postCols,
  );
  assert.equal(missingAllCourse.course_gifts_missing_count, 3);
  assert.equal(missingAllCourse.hands_gift_missing_count, 0);

  const wrongUuidSameName = computeGameGiftActivationPreflightCounters(
    [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        activationMode: "SINGLE_PAID_SERVICE",
        minCourseSessions: null,
        activationConditionText: SINGLE_PAID_SERVICE_CONDITION_TEXT,
      },
      ...canonicalOk.filter((g) => g.id !== HANDS_GIFT_ID),
    ],
    postCols,
  );
  assert.equal(wrongUuidSameName.hands_gift_missing_count, 1);

  // Pre-migration: activation mismatch counters stay 0; missing still checked by id.
  assert.equal(giftActivationSchemaForm(preCols), "absent");
  const preMigrationOk = computeGameGiftActivationPreflightCounters(
    canonicalOk.map(({ id }) => ({ id })),
    preCols,
  );
  assert.equal(preMigrationOk.gift_total, 4);
  assert.equal(preMigrationOk.partial_schema_count, 0);
  assert.equal(preMigrationOk.empty_condition_count, 0);
  assert.equal(preMigrationOk.course_missing_min_count, 0);
  assert.equal(preMigrationOk.hands_gift_mismatch_count, 0);
  assert.equal(preMigrationOk.course_gifts_mismatch_count, 0);
  assert.equal(preMigrationOk.hands_gift_missing_count, 0);
  assert.equal(preMigrationOk.course_gifts_missing_count, 0);
  assert.ok(preflightCountersAreClean(preMigrationOk));

  const preMigrationMissing = computeGameGiftActivationPreflightCounters([], preCols);
  assert.equal(preMigrationMissing.hands_gift_missing_count, 1);
  assert.equal(preMigrationMissing.course_gifts_missing_count, 3);
  assert.equal(preMigrationMissing.partial_schema_count, 0);
  assert.equal(preflightCountersAreClean(preMigrationMissing), false);

  // Partial schema: diagnostic counter=1; SQL/TS still return a row (shell fails).
  const partialCols = {
    hasActivationMode: true,
    hasConditionText: false,
    hasMinSessions: false,
  };
  assert.equal(giftActivationSchemaForm(partialCols), "partial");
  const partialCounters = computeGameGiftActivationPreflightCounters(
    canonicalOk,
    partialCols,
  );
  assert.equal(partialCounters.partial_schema_count, 1);
  assert.equal(partialCounters.empty_condition_count, 0);
  assert.equal(partialCounters.hands_gift_mismatch_count, 0);
  assert.equal(preflightCountersAreClean(partialCounters), false);

  // Post-migration mismatch must fail clean check.
  const postMismatch = computeGameGiftActivationPreflightCounters(
    [
      {
        id: HANDS_GIFT_ID,
        activationMode: "COURSE_MIN_SESSIONS",
        minCourseSessions: 5,
        activationConditionText: SINGLE_PAID_SERVICE_CONDITION_TEXT,
      },
      ...canonicalOk.filter((g) => g.id !== HANDS_GIFT_ID),
    ],
    postCols,
  );
  assert.equal(postMismatch.hands_gift_mismatch_count, 1);
  assert.equal(postMismatch.partial_schema_count, 0);
  assert.equal(preflightCountersAreClean(postMismatch), false);

  assert.equal(GAME_GIFT_ACTIVATION_PREFLIGHT_COUNTER_ORDER.length, 8);
  assert.equal(parseGameGiftActivationPreflightPsqlRow(""), null);
  assert.equal(parseGameGiftActivationPreflightPsqlRow("1\t2\t3"), null);
  assert.equal(parseGameGiftActivationPreflightPsqlRow("1\t2\t3\t4\t5\t6\t7"), null);
  assert.equal(
    parseGameGiftActivationPreflightPsqlRow("a\tb\tc\td\te\tf\tg\th"),
    null,
  );
  const parsed = parseGameGiftActivationPreflightPsqlRow(
    "4\t0\t0\t0\t0\t0\t0\t0",
  );
  assert.ok(parsed);
  assert.equal(parsed!.gift_total, 4);
  assert.equal(parsed!.partial_schema_count, 0);
  assert.ok(preflightCountersAreClean(parsed!));
  assert.equal(
    preflightCountersAreClean(
      parseGameGiftActivationPreflightPsqlRow("4\t1\t0\t0\t0\t0\t0\t0")!,
    ),
    false,
  );
  assert.equal(
    preflightCountersAreClean(
      parseGameGiftActivationPreflightPsqlRow("4\t0\t0\t1\t0\t0\t0\t0")!,
    ),
    false,
  );

  // SQL SELECT order must match parser (8 counters).
  const preflightSql = fs.readFileSync(PREFLIGHT_SQL, "utf8");
  const selectIdx = preflightSql.lastIndexOf("SELECT");
  const selectTail = preflightSql.slice(selectIdx);
  assert.match(
    selectTail,
    /gift_total[\s\S]*hands_gift_missing_count[\s\S]*course_gifts_missing_count[\s\S]*partial_schema_count[\s\S]*empty_condition_count[\s\S]*course_missing_min_count[\s\S]*hands_gift_mismatch_count[\s\S]*course_gifts_mismatch_count/,
  );
}

function resolveBashExecutable(): string | null {
  const candidates = [
    process.env.BASH_PATH,
    path.join("C:", "Program Files", "Git", "bin", "bash.exe"),
    path.join("C:", "Program Files (x86)", "Git", "bin", "bash.exe"),
    "/bin/bash",
    "/usr/bin/bash",
  ].filter((v): v is string => Boolean(v));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  // On Windows, bare `bash` often resolves to a broken WSL shim — skip it.
  if (process.platform === "win32") {
    return null;
  }
  return "bash";
}

function assertPgRegressionHarnessContract(): void {
  const harnessRel =
    "scripts/ops/lib/game-gift-activation-preflight-pg-regression.sh";
  const harnessPath = path.join(ROOT, harnessRel);
  assert.ok(fs.existsSync(harnessPath), "PG regression harness must exist");
  const harness = fs.readFileSync(harnessPath, "utf8");
  assert.match(harness, /SKIP: Docker daemon unavailable/);
  assert.match(harness, /SKIP_EXIT=77/);
  assert.match(harness, /exit "\$SKIP_EXIT"/);
  assert.doesNotMatch(harness, /docker info[\s\S]{0,120}exit 0\b/);
  assert.match(harness, /4\\t0\\t0\\t1\\t0\\t0\\t0\\t0/);
  assert.match(harness, /postgres:16-alpine/);
  assert.doesNotMatch(harness, /\.env\.staging|\.env\.production|STAGING_|PRODUCTION_/);

  const bash = resolveBashExecutable();
  if (!bash) {
    console.log(
      "game-gift-activation-preflight-pg-regression: SKIP (no usable bash; not runtime PG proof; staging preflight remains required)",
    );
    return;
  }

  const result = spawnSync(bash, [harnessPath], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) {
    console.log(
      `game-gift-activation-preflight-pg-regression: SKIP (cannot exec bash: ${result.error.message}; not runtime PG proof; staging preflight remains required)`,
    );
    return;
  }
  const status = result.status;
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (status === 0) {
    assert.match(combined, /PASS/);
    console.log("game-gift-activation-preflight-pg-regression: PASS (runtime PG)");
    return;
  }
  if (status === 77) {
    assert.match(combined, /SKIP: Docker daemon unavailable/);
    console.log(
      "game-gift-activation-preflight-pg-regression: SKIP (exit 77; not runtime PG proof; staging preflight remains required)",
    );
    return;
  }
  assert.fail(
    `PG regression harness FAIL (exit ${String(status)}): ${combined.slice(0, 500)}`,
  );
}

function assertSeedAndServiceWire(): void {
  const seed = read("prisma/seed.ts");
  assert.match(seed, /activationMode:\s*"SINGLE_PAID_SERVICE"/);
  assert.match(seed, /activationMode:\s*"COURSE_MIN_SESSIONS"/);
  assert.match(seed, /minCourseSessions:\s*5/);

  const adminService = read("src/services/GameAdminService.ts");
  assert.match(adminService, /validateGiftActivationInput/);

  const snapshotSrc = read("src/lib/game/session/game-session-snapshot.ts");
  assert.match(snapshotSrc, /activationConditionText/);
  assert.match(snapshotSrc, /validityDays/);
  assert.match(snapshotSrc, /activationMode: GameGiftActivationMode \| null/);
}

function run(): void {
  assertActivationModesAndValidation();
  assertCanonicalFourGifts();
  assertServerSideSnapshotImmutable();
  assertBodySpoofRejected();
  assertMessagesAndBookingComment();
  assertEligibilityUnchanged();
  assertOpenRequestAndClosedReplayContracts();
  assertUiContracts();
  assertMigrationAndPreflight();
  assertPreflightMissingGiftCounters();
  assertSeedAndServiceWire();
  console.log("security-game-gift-activation-check: OK");
}

run();
