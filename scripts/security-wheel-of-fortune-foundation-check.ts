process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  canActivateGameCatalog,
} from "../src/types/game-catalog";
import { canManageGameAdmin } from "../src/lib/auth/permissions";
import {
  DEFAULT_WHEEL_PRIZE_DEFINITIONS,
  sumDefaultWheelSectors,
  WHEEL_DEFAULT_SECTOR_COUNT,
  WHEEL_PRIZE_SYSTEM_KEYS,
} from "../src/lib/game/wheel/default-prizes";
import { rejectForbiddenClientWheelResultFields } from "../src/lib/game/wheel/forbidden-client-fields";
import {
  hashParticipantPhone,
  resolveCampaignKeySnapshot,
  GAME_SESSION_PHONE_CAMPAIGN_UNIQUE_INDEX,
} from "../src/lib/game/wheel/participant-phone-hash";
import {
  InMemoryPhoneAttemptRegistry,
  registerWheelPhoneAttemptConcurrentSafe,
} from "../src/lib/game/wheel/phone-attempt-registration";
import { WHEEL_REPLAY_COOLDOWN_MS } from "../src/lib/game/wheel/wheel-replay-cooldown";
import { phoneAttemptAllowed } from "../src/lib/game/wheel/phone-campaign-isolation";
import { isPrizeAllowedForProcedure } from "../src/lib/game/wheel/prize-eligibility";
import { resolvePrizeReplacement } from "../src/lib/game/wheel/prize-replacement";
import {
  assignWheelSector,
  buildWheelSectorSlots,
  validateWheelSectorConfiguration,
  type WheelSectorGift,
} from "../src/lib/game/wheel/sector-assignment";
import { buildWheelServerAssignment } from "../src/lib/game/wheel/wheel-assignment";
import {
  enrichWheelAssignmentWithPrizeSnapshot,
  type WheelPrizeCatalogGift,
} from "../src/lib/game/wheel/wheel-assignment-prize-snapshot";
import { parseWheelServerAssignment } from "../src/lib/game/wheel/parse-wheel-assignment";
import { completeWheelFromServerAssignment } from "../src/lib/game/wheel/wheel-complete";
import {
  assertNoHardcodedProductionWheelFallback,
  assertNoPublicWheelSecretsInEnvContract,
  readOptionalWheelCampaignSecret,
  resolveWheelHmacSecret,
  WheelSecretError,
} from "../src/lib/game/wheel/wheel-env-contract";
import { validateWheelClaimBody } from "../src/lib/game/wheel/wheel-claim-contract";
import {
  applyReplacementToWheelGiftSnapshot,
  buildWheelGiftSnapshotFields,
} from "../src/lib/game/wheel/wheel-gift-snapshot";
import type { WheelInterestKey } from "../src/lib/game/wheel/procedure-types";
import { resolveConfirmedZone } from "../src/lib/game/wheel/zone-resolution";
import { hashWheelAttemptId } from "../src/lib/game/wheel/attempt-id";
import { normalizeGameBookingPhoneKey } from "../src/lib/game/game-open-request-policy";
import { normalizePhone } from "../src/lib/phone/normalize-phone";

const SECURITY_INVENTORY = [
  "lips_permanent keeps biorevitalizant",
  "brows_permanent allows replacement",
  "eyelids_permanent allows replacement",
  "cover without zone keeps prize",
  "cover + lips keeps prize",
  "cover + brows replaces prize",
  "refresh without zone keeps prize",
  "refresh + lips keeps prize",
  "refresh + brows replaces prize",
  "undecided replaces lips-only prize",
  "null interest keeps prize",
  "originalPrize and finalPrize after replacement",
  "confirmedZone stored in snapshot/contract",
  "one attempt blocked inside catalog+campaignKey",
  "same phone allowed in other gameCatalog",
  "same phone allowed in other campaignKey",
  "concurrent attempts create one participation",
  "idempotent retry does not assign new prize",
  "plaintext phone/token absent from assignment",
  "catch-time has no regressions",
  "MASTER denied game admin",
  "wheel stays DRAFT / public activation blocked",
  "sector sum remains 16",
  "discount/correction rules preserved",
];

const FIXED_NOW = new Date("2026-08-03T10:00:00.000Z");
const TEST_ENV = {
  NODE_ENV: "test",
  AUTH_SECRET: "test-auth-secret-16chars-min",
} as NodeJS.ProcessEnv;

function bioAndHand() {
  const bio = DEFAULT_WHEEL_PRIZE_DEFINITIONS.find(
    (prize) => prize.systemKey === WHEEL_PRIZE_SYSTEM_KEYS.lipsBiorevitalizant,
  )!;
  const hand = DEFAULT_WHEEL_PRIZE_DEFINITIONS.find(
    (prize) => prize.systemKey === WHEEL_PRIZE_SYSTEM_KEYS.handCare,
  )!;
  return { bio, hand };
}

function replaceCase(input: {
  interest: WheelInterestKey | null;
  zone?: unknown;
}) {
  const { bio, hand } = bioAndHand();
  return resolvePrizeReplacement({
    original: { systemKey: bio.systemKey, giftId: "bio-id", name: bio.name },
    originalRules: bio.prizeRules,
    confirmedInterest: input.interest,
    confirmedZone: input.zone,
    fallbackPrize: {
      systemKey: hand.systemKey,
      giftId: "hand-id",
      name: hand.name,
    },
    now: FIXED_NOW,
  });
}

function defaultGiftsAsSectorGifts(): WheelSectorGift[] {
  return DEFAULT_WHEEL_PRIZE_DEFINITIONS.map((prize, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    systemKey: prize.systemKey,
    name: prize.name,
    isActive: prize.isActive,
    probability: prize.sectorCount,
    sortOrder: prize.sortOrder,
  }));
}

function defaultGiftsAsCatalog(): WheelPrizeCatalogGift[] {
  const sectorGifts = defaultGiftsAsSectorGifts();
  return DEFAULT_WHEEL_PRIZE_DEFINITIONS.map((definition, index) => {
    const gift = sectorGifts[index]!;
    return {
      id: gift.id,
      name: definition.name,
      shortDescription: definition.shortDescription,
      image: null,
      priority: "standard",
      cardStyle: "default",
      isActive: gift.isActive,
      probability: gift.probability,
      systemKey: definition.systemKey,
      sortOrder: gift.sortOrder,
      prizeType: definition.prizeType,
      prizeRules: definition.prizeRules,
      activationMode: "SINGLE_PAID_SERVICE" as const,
      minCourseSessions: null,
      activationConditionText: definition.activationConditionText,
    };
  });
}

function assertZoneReplacementMatrix(): void {
  assert.equal(replaceCase({ interest: "lips_permanent" }).replaced, false);
  assert.equal(replaceCase({ interest: "brows_permanent" }).replaced, true);
  assert.equal(replaceCase({ interest: "eyelids_permanent" }).replaced, true);

  assert.equal(replaceCase({ interest: "cover" }).replaced, false);
  assert.equal(
    replaceCase({ interest: "cover", zone: "lips" }).replaced,
    false,
  );
  assert.equal(
    replaceCase({ interest: "cover", zone: "brows" }).replaced,
    true,
  );

  assert.equal(replaceCase({ interest: "refresh" }).replaced, false);
  assert.equal(
    replaceCase({ interest: "refresh", zone: "lips" }).replaced,
    false,
  );
  assert.equal(
    replaceCase({ interest: "refresh", zone: "brows" }).replaced,
    true,
  );

  const undecided = replaceCase({ interest: "undecided" });
  assert.equal(undecided.replaced, true);
  if (!undecided.replaced) {
    throw new Error("expected undecided replacement");
  }
  assert.equal(undecided.final.systemKey, WHEEL_PRIZE_SYSTEM_KEYS.handCare);
  assert.equal(undecided.confirmedZone, "unknown");
  assert.equal(undecided.replacementReason, "undecided_interest");
  assert.equal(replaceCase({ interest: null }).replaced, false);

  const brows = replaceCase({ interest: "brows_permanent" });
  assert.equal(brows.replaced, true);
  if (!brows.replaced) {
    throw new Error("expected replacement");
  }
  assert.equal(brows.original.systemKey, WHEEL_PRIZE_SYSTEM_KEYS.lipsBiorevitalizant);
  assert.equal(brows.final.systemKey, WHEEL_PRIZE_SYSTEM_KEYS.handCare);
  assert.equal(brows.confirmedZone, "brows");
  assert.equal(brows.replacementReason, "confirmed_non_lips_zone");
  assert.equal(brows.replacedAt, FIXED_NOW.toISOString());

  const { bio, hand } = bioAndHand();
  const baseFields = buildWheelGiftSnapshotFields({
    prizeType: bio.prizeType,
    systemKey: bio.systemKey,
    sectorIndex: 15,
    totalSectors: 16,
    prizeRules: bio.prizeRules,
    giftId: "bio-id",
    name: bio.name,
  });
  const snapshot = applyReplacementToWheelGiftSnapshot(
    {
      giftId: "bio-id",
      name: bio.name,
      shortDescription: bio.shortDescription,
      image: null,
      priority: "standard",
      cardStyle: "default",
      ruleType: "wheel_sector",
      assignedValue: null,
      assignedAt: FIXED_NOW.toISOString(),
      activationMode: "SINGLE_PAID_SERVICE",
      minCourseSessions: null,
      activationConditionText: bio.activationConditionText,
      validityDays: 30,
      ...baseFields,
    },
    {
      finalPrize: {
        systemKey: hand.systemKey,
        giftId: "hand-id",
        name: hand.name,
      },
      finalPrizeType: hand.prizeType,
      finalPrizeRules: hand.prizeRules,
      confirmedInterest: "brows_permanent",
      confirmedZone: "brows",
      replacementReason: "confirmed_non_lips_zone",
      replacedAt: FIXED_NOW.toISOString(),
    },
  );

  assert.equal(snapshot.replacementApplied, true);
  assert.equal(snapshot.originalPrize?.systemKey, bio.systemKey);
  assert.equal(snapshot.finalPrize?.systemKey, hand.systemKey);
  assert.equal(snapshot.confirmedZone, "brows");
  assert.equal(snapshot.confirmedInterest, "brows_permanent");
  assert.equal(snapshot.replacementReason, "confirmed_non_lips_zone");
  assert.equal(snapshot.replacedAt, FIXED_NOW.toISOString());

  assert.equal(
    resolveConfirmedZone({
      confirmedInterest: "cover",
      confirmedZone: undefined,
    }),
    "unknown",
  );
  assert.equal(
    resolveConfirmedZone({
      confirmedInterest: "cover",
      confirmedZone: "eyelids",
    }),
    "eyelids",
  );

  const claimCoverNeedsZone = validateWheelClaimBody({
    gamePlayId: "play-1",
    name: "Анна",
    phone: "+7 999 111-22-33",
    selectedInterest: "cover",
    personalDataConsent: true,
    offerAcknowledgement: true,
  });
  assert.equal(claimCoverNeedsZone.ok, false);

  const claimCoverOk = validateWheelClaimBody({
    gamePlayId: "play-1",
    name: "Анна",
    phone: "+7 999 111-22-33",
    selectedInterest: "cover",
    confirmedZone: "lips",
    personalDataConsent: true,
    offerAcknowledgement: true,
  });
  assert.equal(claimCoverOk.ok, true);
  if (claimCoverOk.ok) {
    assert.equal(claimCoverOk.data.confirmedZone, "lips");
  }
}

function assertDefaultSectorLayout(): void {
  assert.equal(sumDefaultWheelSectors(), WHEEL_DEFAULT_SECTOR_COUNT);
  assert.equal(WHEEL_DEFAULT_SECTOR_COUNT, 16);

  const byKey = Object.fromEntries(
    DEFAULT_WHEEL_PRIZE_DEFINITIONS.map((prize) => [
      prize.systemKey,
      prize.sectorCount,
    ]),
  );
  assert.equal(byKey[WHEEL_PRIZE_SYSTEM_KEYS.discount10], 5);
  assert.equal(byKey[WHEEL_PRIZE_SYSTEM_KEYS.handCare], 5);
  assert.equal(byKey[WHEEL_PRIZE_SYSTEM_KEYS.discount20], 1);
  assert.equal(byKey[WHEEL_PRIZE_SYSTEM_KEYS.formulaShine], 1);
  assert.equal(byKey[WHEEL_PRIZE_SYSTEM_KEYS.coldPlasmaLips], 1);
  assert.equal(byKey[WHEEL_PRIZE_SYSTEM_KEYS.laserBiorevitalization], 1);
  assert.equal(byKey[WHEEL_PRIZE_SYSTEM_KEYS.discount15], 1);
  assert.equal(byKey[WHEEL_PRIZE_SYSTEM_KEYS.lipsBiorevitalizant], 1);

  const gifts = defaultGiftsAsSectorGifts();
  const built = buildWheelSectorSlots(gifts, 16);
  assert.equal(built.ok, true);
  const validation = validateWheelSectorConfiguration(gifts, 16);
  assert.equal(validation.ok, true);
}

function assertInactiveExcluded(): void {
  const gifts = defaultGiftsAsSectorGifts().map((gift) =>
    gift.systemKey === WHEEL_PRIZE_SYSTEM_KEYS.discount20
      ? { ...gift, isActive: false }
      : gift,
  );
  const built = buildWheelSectorSlots(gifts, 16);
  assert.equal(built.ok, false);
  if (!built.ok) {
    assert.equal(built.totalSectors, 15);
  }
  const assigned = assignWheelSector(gifts, {
    expectedSectorCount: 15,
    randomInt: () => 0,
  });
  assert.ok(assigned);
  assert.notEqual(assigned!.systemKey, WHEEL_PRIZE_SYSTEM_KEYS.discount20);
}

function assertServerOnlyAssignmentAndIdempotency(): void {
  const gifts = defaultGiftsAsSectorGifts();
  const assignment = buildWheelServerAssignment({
    catalogCampaignKey: "permanent-wheel",
    catalogRulesVersion: "1",
    settingsRaw: {
      version: 1,
      campaign: { key: "permanent-wheel", rulesVersion: "1" },
      wheel: {
        version: 1,
        expectedSectorCount: 16,
        confirmWindowDays: 7,
        procedureWindowDays: 30,
      },
    },
    gifts,
    now: FIXED_NOW,
    randomInt: () => 10,
  });
  assert.ok(assignment);
  assert.equal(assignment!.mechanicType, "WHEEL_OF_FORTUNE");
  const catalog = defaultGiftsAsCatalog();
  const enriched = enrichWheelAssignmentWithPrizeSnapshot(assignment!, catalog);
  assert.ok(enriched);
  assert.equal(parseWheelServerAssignment(enriched)?.sectorIndex, 10);

  const giftDefs = DEFAULT_WHEEL_PRIZE_DEFINITIONS.map((definition, index) => {
    const gift = gifts[index]!;
    return {
      id: gift.id,
      name: definition.name,
      shortDescription: definition.shortDescription,
      image: null,
      priority: "standard",
      cardStyle: "default",
      activationMode: "SINGLE_PAID_SERVICE" as const,
      minCourseSessions: null,
      activationConditionText: definition.activationConditionText,
      systemKey: definition.systemKey,
      prizeType: definition.prizeType,
      prizeRules: definition.prizeRules,
    };
  });

  const first = completeWheelFromServerAssignment({
    assignment: enriched,
    gifts: giftDefs,
    existingGiftSnapshot: null,
    clientBody: {},
    now: FIXED_NOW,
  });
  assert.equal(first.ok, true);
  if (!first.ok) {
    throw new Error(first.error);
  }
  assert.equal(first.idempotent, false);

  const second = completeWheelFromServerAssignment({
    assignment: enriched,
    gifts: giftDefs,
    existingGiftSnapshot: first.giftSnapshot,
    clientBody: {},
    now: new Date("2026-08-03T11:00:00.000Z"),
  });
  assert.equal(second.ok, true);
  if (!second.ok) {
    throw new Error(second.error);
  }
  assert.equal(second.idempotent, true);
  assert.equal(second.giftSnapshot.giftId, first.giftSnapshot.giftId);

  assert.equal(
    completeWheelFromServerAssignment({
      assignment: enriched,
      gifts: giftDefs,
      existingGiftSnapshot: null,
      clientBody: { sectorIndex: 0 },
      now: FIXED_NOW,
    }).ok,
    false,
  );
  assert.equal(
    completeWheelFromServerAssignment({
      assignment: enriched,
      gifts: giftDefs,
      existingGiftSnapshot: null,
      clientBody: { prizeId: "evil" },
      now: FIXED_NOW,
    }).ok,
    false,
  );
  assert.equal(
    rejectForbiddenClientWheelResultFields({ sectorIndex: 3 }).ok,
    false,
  );

  const assignmentJson = JSON.stringify(assignment);
  assert.doesNotMatch(assignmentJson, /7999|\+7|token|secret|password|NEXT_PUBLIC_/i);
  assert.doesNotMatch(assignmentJson, /"probability"|"weight"/);
}

function assertPhoneCampaignInMemoryIsolation(): void {
  // Unit-level concurrent semantics via InMemoryPhoneAttemptRegistry.
  // Real PostgreSQL unique-index / P2002 proof lives in
  // scripts/security-wheel-phone-attempt-db-check.ts — do not treat this as DB proof.
  const existing = [
    {
      normalizedPhone: "79991234567",
      gameCatalogId: "wheel-catalog",
      campaignKey: "permanent-wheel",
    },
  ];

  assert.equal(
    phoneAttemptAllowed({
      normalizedPhone: "79991234567",
      gameCatalogId: "wheel-catalog",
      campaignKey: "permanent-wheel",
      existingParticipations: existing,
      env: TEST_ENV,
    }),
    false,
  );
  assert.equal(
    phoneAttemptAllowed({
      normalizedPhone: "79991234567",
      gameCatalogId: "catch-time-catalog",
      campaignKey: "procedure-gift",
      existingParticipations: existing,
      env: TEST_ENV,
    }),
    true,
  );
  assert.equal(
    phoneAttemptAllowed({
      normalizedPhone: "79991234567",
      gameCatalogId: "wheel-catalog",
      campaignKey: "permanent-wheel-v2",
      existingParticipations: existing,
      env: TEST_ENV,
    }),
    true,
  );

  const snapA = resolveCampaignKeySnapshot("permanent-wheel", "wheel-catalog");
  const snapB = resolveCampaignKeySnapshot("permanent-wheel-v2", "wheel-catalog");
  assert.notEqual(snapA, snapB);

  const hashA = hashParticipantPhone({
    normalizedPhone: "79991234567",
    gameCatalogId: "wheel-catalog",
    campaignKeySnapshot: snapA,
    env: TEST_ENV,
  });
  const hashB = hashParticipantPhone({
    normalizedPhone: "79991234567",
    gameCatalogId: "wheel-catalog",
    campaignKeySnapshot: snapB,
    env: TEST_ENV,
  });
  const hashOtherCatalog = hashParticipantPhone({
    normalizedPhone: "79991234567",
    gameCatalogId: "catch-time-catalog",
    campaignKeySnapshot: resolveCampaignKeySnapshot(
      "procedure-gift",
      "catch-time-catalog",
    ),
    env: TEST_ENV,
  });
  assert.equal(hashA.length, 64);
  assert.notEqual(hashA, hashB);
  assert.notEqual(hashA, hashOtherCatalog);
  assert.doesNotMatch(hashA, /79991234567/);

  const phoneFormats = [
    "79991234567",
    "+7 999 123-45-67",
    "8 (999) 123-45-67",
  ] as const;
  const formatHashes = phoneFormats.map((phone) => {
    const canonical = normalizeGameBookingPhoneKey(phone);
    assert.equal(canonical, "79991234567");
    assert.equal(normalizePhone(phone), "79991234567");
    return hashParticipantPhone({
      normalizedPhone: canonical!,
      gameCatalogId: "wheel-catalog",
      campaignKeySnapshot: snapA,
      env: TEST_ENV,
    });
  });
  assert.equal(formatHashes[0], formatHashes[1]);
  assert.equal(formatHashes[0], formatHashes[2]);

  const registry = new InMemoryPhoneAttemptRegistry();
  const assignment = { sectorIndex: 3, prizeSystemKey: "x" };
  const attemptHashA = hashWheelAttemptId(
    "11111111-1111-4111-8111-111111111111",
    TEST_ENV,
  );

  const first = registerWheelPhoneAttemptConcurrentSafe({
    registry,
    normalizedPhone: "79991234567",
    gameCatalogId: "wheel-catalog",
    campaignKey: "permanent-wheel",
    browserVisitorHash: "visitor-a",
    attemptIdHash: attemptHashA,
    sessionId: "session-1",
    sessionToken: "token-a",
    assignment,
    env: TEST_ENV,
  });
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.kind, "created");
  }

  const concurrentOtherVisitor = registerWheelPhoneAttemptConcurrentSafe({
    registry,
    normalizedPhone: "79991234567",
    gameCatalogId: "wheel-catalog",
    campaignKey: "permanent-wheel",
    browserVisitorHash: "visitor-b",
    attemptIdHash: hashWheelAttemptId(
      "22222222-2222-4222-8222-222222222222",
      TEST_ENV,
    ),
    sessionId: "session-2",
    sessionToken: "token-b",
    assignment: { sectorIndex: 9, prizeSystemKey: "y" },
    env: TEST_ENV,
  });
  assert.equal(concurrentOtherVisitor.ok, false);
  if (!concurrentOtherVisitor.ok) {
    assert.equal(concurrentOtherVisitor.error, "WHEEL_COOLDOWN_ACTIVE");
  }
  assert.equal(registry.size(), 1);

  const idempotentSameVisitor = registerWheelPhoneAttemptConcurrentSafe({
    registry,
    normalizedPhone: "79991234567",
    gameCatalogId: "wheel-catalog",
    campaignKey: "permanent-wheel",
    browserVisitorHash: "visitor-a",
    attemptIdHash: attemptHashA,
    sessionId: "session-3",
    sessionToken: "token-a",
    assignment: { sectorIndex: 1, prizeSystemKey: "z" },
    env: TEST_ENV,
  });
  assert.equal(idempotentSameVisitor.ok, true);
  if (idempotentSameVisitor.ok) {
    assert.equal(idempotentSameVisitor.kind, "idempotent_reuse");
    assert.equal(idempotentSameVisitor.existingSessionId, "session-1");
    assert.deepEqual(idempotentSameVisitor.existingAssignment, assignment);
    assert.equal(idempotentSameVisitor.sessionToken, "token-a");
  }

  const otherCampaign = registerWheelPhoneAttemptConcurrentSafe({
    registry,
    normalizedPhone: "79991234567",
    gameCatalogId: "wheel-catalog",
    campaignKey: "permanent-wheel-v2",
    browserVisitorHash: "visitor-a",
    attemptIdHash: attemptHashA,
    sessionId: "session-4",
    sessionToken: "token-c",
    assignment: { sectorIndex: 0 },
    env: TEST_ENV,
  });
  assert.equal(otherCampaign.ok, true);
  if (otherCampaign.ok) {
    assert.equal(otherCampaign.kind, "created");
  }

  const otherCatalog = registerWheelPhoneAttemptConcurrentSafe({
    registry,
    normalizedPhone: "79991234567",
    gameCatalogId: "catch-time-catalog",
    campaignKey: "procedure-gift",
    browserVisitorHash: "visitor-a",
    attemptIdHash: attemptHashA,
    sessionId: "session-5",
    sessionToken: "token-d",
    assignment: { sectorIndex: 0 },
    env: TEST_ENV,
  });
  assert.equal(otherCatalog.ok, true);
  assert.equal(registry.size(), 3);

  // Race: many concurrent inserts — only one participation row.
  const raceRegistry = new InMemoryPhoneAttemptRegistry();
  const raceResults = Array.from({ length: 20 }, (_, index) =>
    registerWheelPhoneAttemptConcurrentSafe({
      registry: raceRegistry,
      normalizedPhone: "79990001122",
      gameCatalogId: "wheel-catalog",
      campaignKey: "permanent-wheel",
      browserVisitorHash: `visitor-race-${index}`,
      attemptIdHash: hashWheelAttemptId(
        `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
        TEST_ENV,
      ),
      sessionId: `race-session-${index}`,
      sessionToken: `race-token-${index}`,
      assignment: { sectorIndex: index },
      env: TEST_ENV,
    }),
  );
  const created = raceResults.filter((r) => r.ok && r.kind === "created");
  const blocked = raceResults.filter((r) => !r.ok);
  assert.equal(created.length, 1);
  assert.equal(blocked.length, 19);
  assert.equal(raceRegistry.size(), 1);
  for (const row of blocked) {
    assert.equal(row.ok, false);
    if (!row.ok) {
      assert.equal(row.error, "WHEEL_COOLDOWN_ACTIVE");
    }
  }

  // After cooldown window, a new attempt is allowed
  const afterCooldown = registerWheelPhoneAttemptConcurrentSafe({
    registry,
    normalizedPhone: "79991234567",
    gameCatalogId: "wheel-catalog",
    campaignKey: "permanent-wheel",
    browserVisitorHash: "visitor-after",
    attemptIdHash: hashWheelAttemptId(
      "44444444-4444-4444-8444-444444444444",
      TEST_ENV,
    ),
    sessionId: "session-after",
    sessionToken: "token-after",
    assignment: { sectorIndex: 2 },
    env: TEST_ENV,
    now: new Date(Date.now() + WHEEL_REPLAY_COOLDOWN_MS),
  });
  assert.equal(afterCooldown.ok, true);
  if (afterCooldown.ok) {
    assert.equal(afterCooldown.kind, "created");
  }
  assert.equal(registry.size(), 4);

  const migrationSql = fs.readFileSync(
    path.join(
      process.cwd(),
      "prisma/migrations/20260803140000_wheel_phone_campaign_attempt_unique/migration.sql",
    ),
    "utf8",
  );
  assert.match(migrationSql, /participant_phone_hash/);
  assert.match(migrationSql, /campaign_key_snapshot/);
  assert.match(
    migrationSql,
    new RegExp(GAME_SESSION_PHONE_CAMPAIGN_UNIQUE_INDEX),
  );

  const cooldownMigration = fs.readFileSync(
    path.join(
      process.cwd(),
      "prisma/migrations/20260804180000_wheel_phone_replay_cooldown/migration.sql",
    ),
    "utf8",
  );
  assert.match(
    cooldownMigration,
    /DROP INDEX IF EXISTS "game_sessions_catalog_campaign_phone_hash_uidx"/,
  );
  assert.match(
    cooldownMigration,
    /game_sessions_catalog_campaign_phone_started_idx/,
  );
  assert.match(migrationSql, /WHERE "participant_phone_hash" IS NOT NULL/);
  assert.match(
    migrationSql,
    /Existing booking_requests_open_game_phone_catalog_uidx is NOT modified/,
  );
  assert.doesNotMatch(migrationSql, /DROP INDEX.*booking_requests_open_game/i);
  assert.doesNotMatch(
    migrationSql,
    /DROP INDEX IF EXISTS "booking_requests_open_game_phone_catalog_uidx"/,
  );
}

function assertClientAttemptIdModuleSplit(): void {
  const root = process.cwd();
  const clientSource = fs.readFileSync(
    path.join(root, "src/lib/game/wheel/client-attempt-id.ts"),
    "utf8",
  );
  assert.doesNotMatch(clientSource, /from\s+["']node:crypto["']/);
  assert.doesNotMatch(clientSource, /require\(\s*["']node:crypto["']\s*\)/);
  assert.doesNotMatch(clientSource, /createHmac/);
  assert.doesNotMatch(clientSource, /wheel-env-contract/);
  assert.doesNotMatch(clientSource, /["']server-only["']/);
  assert.doesNotMatch(
    clientSource,
    /AUTH_SECRET|NEXTAUTH_SECRET|WHEEL_OF_FORTUNE_CAMPAIGN_SECRET/,
  );
  assert.match(clientSource, /createWheelAttemptId/);
  assert.match(clientSource, /globalThis\.crypto|cryptoApi\.randomUUID/);

  const serverSource = fs.readFileSync(
    path.join(root, "src/lib/game/wheel/attempt-id.ts"),
    "utf8",
  );
  assert.match(serverSource, /import "server-only"/);
  assert.match(serverSource, /createHmac/);
  assert.doesNotMatch(serverSource, /export function createWheelAttemptId/);

  // Client components must not import the server HMAC module.
  for (const relative of [
    "src/components",
    "src/app",
  ]) {
    const absoluteRoot = path.join(root, relative);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }
    walkClientFiles(absoluteRoot, (filePath) => {
      if (!/\.(tsx|ts|jsx|js)$/.test(filePath)) {
        return;
      }
      if (filePath.includes(`${path.sep}api${path.sep}`)) {
        return;
      }
      const source = fs.readFileSync(filePath, "utf8");
      if (source.includes('"server-only"') || source.includes("'server-only'")) {
        return;
      }
      assert.doesNotMatch(
        source,
        /@\/lib\/game\/wheel\/attempt-id/,
        `${filePath} must not import server wheel attempt crypto`,
      );
      assert.doesNotMatch(
        source,
        /@\/lib\/game\/wheel\/(participant-phone-hash|wheel-env-contract|register-phone-bound-session)/,
        `${filePath} must not import server wheel phone/hash modules`,
      );
    });
  }
}

function walkClientFiles(dir: string, visit: (filePath: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkClientFiles(fullPath, visit);
    } else {
      visit(fullPath);
    }
  }
}

function assertEligibilityRules(): void {
  const discount10 = DEFAULT_WHEEL_PRIZE_DEFINITIONS.find(
    (prize) => prize.systemKey === WHEEL_PRIZE_SYSTEM_KEYS.discount10,
  )!;
  const discount20 = DEFAULT_WHEEL_PRIZE_DEFINITIONS.find(
    (prize) => prize.systemKey === WHEEL_PRIZE_SYSTEM_KEYS.discount20,
  )!;
  const biorevitalizant = DEFAULT_WHEEL_PRIZE_DEFINITIONS.find(
    (prize) => prize.systemKey === WHEEL_PRIZE_SYSTEM_KEYS.lipsBiorevitalizant,
  )!;

  assert.equal(
    isPrizeAllowedForProcedure(discount10.prizeRules, "refresh").ok,
    true,
  );
  assert.equal(
    isPrizeAllowedForProcedure(discount20.prizeRules, "refresh").ok,
    false,
  );

  for (const prize of DEFAULT_WHEEL_PRIZE_DEFINITIONS) {
    assert.equal(
      isPrizeAllowedForProcedure(prize.prizeRules, "correction").ok,
      false,
      `${prize.systemKey} must forbid correction`,
    );
  }

  assert.equal(
    isPrizeAllowedForProcedure(discount10.prizeRules, "cover").ok,
    true,
  );
  assert.equal(
    isPrizeAllowedForProcedure(discount20.prizeRules, "cover").ok,
    true,
  );
  assert.equal(
    isPrizeAllowedForProcedure(biorevitalizant.prizeRules, "lips_permanent_primary")
      .ok,
    true,
  );
  assert.equal(
    isPrizeAllowedForProcedure(biorevitalizant.prizeRules, "lips_refresh").ok,
    true,
  );
  assert.equal(
    isPrizeAllowedForProcedure(biorevitalizant.prizeRules, "permanent_primary")
      .ok,
    false,
  );
}

function assertCatchTimeAndAccessUnchanged(): void {
  assert.equal(canActivateGameCatalog("wheel_of_fortune", "active"), true);
  assert.equal(canActivateGameCatalog("wheel_of_fortune", "draft"), true);
  assert.equal(canActivateGameCatalog("catch_time", "active"), true);

  assert.equal(canManageGameAdmin("OWNER"), true);
  assert.equal(canManageGameAdmin("MASTER"), false);
  assert.equal(canManageGameAdmin("MANAGER"), false);

  const sessionService = fs.readFileSync(
    path.join(process.cwd(), "src/services/GameSessionService.ts"),
    "utf8",
  );
  // Legacy Catch-Time session routes still reject wheel; public wheel uses /api/game/wheel/*.
  assert.match(sessionService, /GAME_MECHANIC_UNSUPPORTED/);
}

function assertSecretsAndClaimContract(): void {
  assertNoPublicWheelSecretsInEnvContract();
  assert.equal(readOptionalWheelCampaignSecret({}), null);

  assert.throws(
    () =>
      resolveWheelHmacSecret({
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof WheelSecretError,
  );

  assert.throws(
    () =>
      resolveWheelHmacSecret({
        NODE_ENV: "production",
        WHEEL_OF_FORTUNE_CAMPAIGN_SECRET: "short",
      } as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof WheelSecretError,
  );

  assert.equal(
    resolveWheelHmacSecret({
      NODE_ENV: "production",
      AUTH_SECRET: "auth-secret-16chars",
    } as NodeJS.ProcessEnv),
    "auth-secret-16chars",
  );

  const envSources = [
    "src/lib/game/wheel/participant-phone-hash.ts",
    "src/lib/game/wheel/register-phone-bound-session.ts",
    "src/services/WheelGameSessionService.ts",
  ];
  for (const rel of envSources) {
    const source = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    assertNoHardcodedProductionWheelFallback(source);
  }

  const claim = validateWheelClaimBody({
    gamePlayId: "play-1",
    name: "Анна",
    phone: "+7 999 111-22-33",
    selectedInterest: "lips_permanent",
    personalDataConsent: true,
    offerAcknowledgement: true,
  });
  assert.equal(claim.ok, true);
  if (claim.ok) {
    assert.equal(claim.data.confirmedZone, "lips");
  }

  assert.equal(
    validateWheelClaimBody({
      gamePlayId: "play-1",
      name: "Анна",
      phone: "+7 999 111-22-33",
      selectedInterest: "lips_permanent",
      personalDataConsent: true,
      offerAcknowledgement: true,
      prizeId: "hack",
    }).ok,
    false,
  );
}

function runChecks(): void {
  assert.equal(SECURITY_INVENTORY.length, 24);
  assertZoneReplacementMatrix();
  assertDefaultSectorLayout();
  assertInactiveExcluded();
  assertServerOnlyAssignmentAndIdempotency();
  assertPhoneCampaignInMemoryIsolation();
  assertClientAttemptIdModuleSplit();
  assertEligibilityRules();
  assertCatchTimeAndAccessUnchanged();
  assertSecretsAndClaimContract();
  console.log("security-wheel-of-fortune-foundation-check: OK");
}

runChecks();
