process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createWheelAttemptId } from "../src/lib/game/wheel/client-attempt-id";
import {
  DEFAULT_WHEEL_PRIZE_DEFINITIONS,
  buildDefaultWheelCatalogSettings,
  serializeDefaultPrizeRules,
} from "../src/lib/game/wheel/default-prizes";
import { parseWheelServerAssignment } from "../src/lib/game/wheel/parse-wheel-assignment";
import {
  mapToWheelInterestKey,
  wheelInterestToPublicKey,
} from "../src/lib/game/wheel/public-interest";
import { resolvePrizeReplacement } from "../src/lib/game/wheel/prize-replacement";
import { parsePrizeRules } from "../src/lib/game/wheel/prize-rules-contract";
import { assertSafeWheelPublicPayload } from "../src/lib/game/wheel/wheel-public-dto";
import { PUBLIC_MUTATING_API_PATHS } from "../src/lib/security/csrf-route-rules";
import { RATE_LIMITED_API_PATHS } from "../src/lib/security/rate-limit/route-rules";
import { canActivateGameCatalog } from "../src/types/game-catalog";
import {
  WheelPublicGameError,
  completeWheelPublicGame,
  getWheelPublicResult,
  startWheelPublicGame,
} from "../src/services/WheelPublicGameService";
import { hashOpaqueToken } from "../src/lib/game/session/game-session-token";

const ROOT = process.cwd();
const TEST_ENV = {
  NODE_ENV: "test",
  AUTH_SECRET: "test-auth-secret-16chars-min",
  SECURITY_BATCH_TEST: "1",
} as NodeJS.ProcessEnv;

const CATALOG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CATALOG_SLUG = "permanent-wheel";
const VISITOR_TOKEN = "visitor-token-public-flow-01";
const VISITOR_HASH = hashOpaqueToken(VISITOR_TOKEN);

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function assertStrictAssignmentInRegister(): void {
  const source = read("src/lib/game/wheel/register-phone-bound-session.ts");
  assert.match(source, /parseWheelServerAssignment/);
  assert.doesNotMatch(
    source,
    /serverAssignment\?\.mechanicType\s*!==\s*["']WHEEL_OF_FORTUNE["']/,
  );
  assert.doesNotMatch(
    source,
    /parseStoredAssignment\([^)]+\)\s*\?\?\s*input\.serverAssignment/,
  );
  assert.ok(
    parseWheelServerAssignment({
      version: 1,
      mechanicType: "WHEEL_OF_FORTUNE",
      serverResultTier: 0,
      campaignKey: "permanent-wheel",
      rulesVersion: "1",
      assignedAt: "2026-08-03T10:00:00.000Z",
      tierBucket: "tier-0",
      sectorIndex: 3,
      totalSectors: 16,
      prizeSystemKey: "hand_care_gift",
      giftId: "00000000-0000-4000-8000-000000000003",
    }),
  );
  assert.equal(
    parseWheelServerAssignment({
      version: 1,
      mechanicType: "WHEEL_OF_FORTUNE",
      sectorIndex: 3,
    }),
    null,
  );
}

function assertPublicContracts(): void {
  assert.equal(canActivateGameCatalog("wheel_of_fortune", "active"), true);
  assert.ok(PUBLIC_MUTATING_API_PATHS.has("/api/game/wheel/start"));
  assert.ok(PUBLIC_MUTATING_API_PATHS.has("/api/game/wheel/complete"));
  assert.ok(
    RATE_LIMITED_API_PATHS.some(
      (entry) =>
        entry.pathname === "/api/game/wheel/start" && entry.method === "POST",
    ),
  );
  assert.ok(
    RATE_LIMITED_API_PATHS.some(
      (entry) =>
        entry.pathname === "/api/game/wheel/result" && entry.method === "GET",
    ),
  );

  const client = read("src/components/game/wheel-fortune-public.tsx");
  assert.match(client, /"use client"/);
  assert.doesNotMatch(client, /from\s+["']node:crypto["']/);
  assert.doesNotMatch(client, /wheel-env-contract/);
  assert.doesNotMatch(client, /@\/lib\/game\/wheel\/attempt-id/);
  assert.match(client, /client-attempt-id/);
  assert.match(client, /prefers-reduced-motion/);
  assert.match(client, /aria-live/);
  assert.match(client, /spinningLock/);
  assert.match(client, /WHEEL_PUBLIC_INTEREST_KEYS/);
  assert.match(client, /phase.*lead|setPhase\("lead"\)/);
  assert.match(client, /setPhase\("claim"\)|setPhase\("submitted"\)/);
  assert.match(client, /\/api\/game\/wheel\/start/);
  assert.match(client, /\/api\/game\/wheel\/complete/);
  assert.match(client, /\/api\/game\/wheel\/result/);
  assert.doesNotMatch(client, /prizeSystemKey|serverAssignment|HMAC|probability/);

  const promo = read("src/app/promo/[slug]/page.tsx");
  assert.match(promo, /WheelFortunePublic/);
  assert.match(promo, /wheel_of_fortune/);

  assert.equal(mapToWheelInterestKey("lips"), "lips_permanent");
  assert.equal(mapToWheelInterestKey("brows"), "brows_permanent");
  assert.equal(mapToWheelInterestKey("cover"), "cover");
  assert.equal(mapToWheelInterestKey("refresh"), "refresh");
  assert.equal(mapToWheelInterestKey("undecided"), "undecided");
  assert.equal(wheelInterestToPublicKey("lips_permanent"), "lips");

  const safe = {
    ok: true,
    animation: { sectorIndex: 1, prizeDisplayName: "Уход", totalSectors: 16 },
  };
  assertSafeWheelPublicPayload(safe);
  assert.throws(() =>
    assertSafeWheelPublicPayload({ prizeSystemKey: "x", ok: true }),
  );
  assert.throws(() =>
    assertSafeWheelPublicPayload({
      ok: true,
      serverAssignment: { sectorIndex: 1 },
    }),
  );

  const biorevitalizant = DEFAULT_WHEEL_PRIZE_DEFINITIONS.find(
    (prize) => prize.systemKey === "lips_biorevitalizant_upgrade",
  )!;
  const handCare = DEFAULT_WHEEL_PRIZE_DEFINITIONS.find(
    (prize) => prize.systemKey === "hand_care_gift",
  )!;
  const rules = parsePrizeRules(serializeDefaultPrizeRules(biorevitalizant));
  assert.ok(rules);
  const replaced = resolvePrizeReplacement({
    original: {
      systemKey: biorevitalizant.systemKey,
      giftId: "g1",
      name: biorevitalizant.name,
    },
    originalRules: rules!,
    confirmedInterest: "brows_permanent",
    fallbackPrize: {
      systemKey: handCare.systemKey,
      giftId: "g2",
      name: handCare.name,
    },
  });
  assert.equal(replaced.replaced, true);

  const schema = read("prisma/schema.prisma");
  assert.match(schema, /game_sessions_catalog_campaign_phone_hash_uidx/);

  const service = read("src/services/WheelPublicGameService.ts");
  assert.match(service, /import "server-only"/);
  assert.match(service, /registerWheelPhoneBoundSession/);
  assert.match(service, /createBookingRequest/);
  assert.match(service, /INACTIVE after start|source of truth/i);
  assert.match(service, /GAME_CLAIM|createBookingRequest/);

  const catalogService = read("src/services/GameCatalogService.ts");
  assert.match(catalogService, /assertWheelCatalogReadyForActivation/);

  const roleAccess = read("scripts/security-role-access-check.ts");
  assert.match(roleAccess, /api\/game\/wheel\/start\/route\.ts/);
  assert.match(roleAccess, /api\/game\/wheel\/complete\/route\.ts/);
  assert.match(roleAccess, /api\/game\/wheel\/result\/route\.ts/);

  const createForm = read("src/components/admin/game-catalog-create-form.tsx");
  assert.doesNotMatch(
    createForm,
    /WHEEL_OF_FORTUNE[\s\S]{0,80}недоступн|не поддерживается/,
  );

  const foundationName = read(
    "scripts/security-wheel-of-fortune-foundation-check.ts",
  );
  assert.match(foundationName, /assertPhoneCampaignInMemoryIsolation/);
  assert.doesNotMatch(
    foundationName,
    /assertPhoneCampaignDbBackedIsolation/,
  );
}

type FakeSession = {
  id: string;
  gameCatalogId: string;
  tokenHash: string;
  browserVisitorHash: string;
  participantPhoneHash: string;
  campaignKeySnapshot: string;
  attemptIdHash: string;
  playExpiresAt: Date;
  claimExpiresAt: Date | null;
  status: string;
  serverAssignment: unknown;
  gamePlay: {
    id: string;
    leadId: string | null;
    giftSnapshot: unknown;
    selectedGiftId: string | null;
  } | null;
};

function buildDefaultGifts() {
  return DEFAULT_WHEEL_PRIZE_DEFINITIONS.map((definition, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: definition.name,
    shortDescription: definition.shortDescription,
    image: null,
    priority:
      definition.systemKey === "permanent_discount_20" ? "jackpot" : "standard",
    cardStyle: "default",
    isActive: definition.isActive,
    probability: definition.sectorCount,
    systemKey: definition.systemKey,
    sortOrder: definition.sortOrder,
    prizeType: definition.prizeType,
    prizeRules: serializeDefaultPrizeRules(definition),
    activationMode: "SINGLE_PAID_SERVICE",
    minCourseSessions: null,
    activationConditionText: definition.activationConditionText,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  }));
}

function createPublicFlowFakePrisma(options?: {
  catalogStatus?: "ACTIVE" | "DRAFT" | "DISABLED";
}) {
  const catalogStatus = options?.catalogStatus ?? "ACTIVE";
  const gifts = buildDefaultGifts();
  const sessions: FakeSession[] = [];
  const bookings = new Map<string, { id: string }>();
  let createCalls = 0;

  const catalogRow = {
    id: CATALOG_ID,
    slug: CATALOG_SLUG,
    title: "Колесо фортуны",
    type: "WHEEL_OF_FORTUNE" as const,
    status: catalogStatus,
    settings: buildDefaultWheelCatalogSettings(),
    campaignKey: "permanent-wheel",
    rulesVersion: "1",
    activeFrom: null,
    activeTo: null,
  };

  const gameCatalog = {
    async findUnique(args: {
      where: { slug?: string; id?: string };
      select: Record<string, boolean>;
    }) {
      if (args.where.slug && args.where.slug !== CATALOG_SLUG) {
        return null;
      }
      if (args.where.id && args.where.id !== CATALOG_ID) {
        return null;
      }
      return catalogRow;
    },
  };

  const gameGift = {
    async findMany() {
      return gifts;
    },
  };

  const gameSession = {
    async create(args: {
      data: {
        gameCatalogId: string;
        tokenHash: string;
        browserVisitorHash: string;
        participantPhoneHash: string;
        campaignKeySnapshot: string;
        attemptIdHash: string;
        playExpiresAt: Date;
        serverAssignment: unknown;
      };
      select: Record<string, boolean>;
    }) {
      const phoneConflict = sessions.find(
        (row) =>
          row.gameCatalogId === args.data.gameCatalogId &&
          row.campaignKeySnapshot === args.data.campaignKeySnapshot &&
          row.participantPhoneHash === args.data.participantPhoneHash,
      );
      if (phoneConflict) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
          code: "P2002",
          clientVersion: "test",
          meta: {
            target: [
              "game_catalog_id",
              "campaign_key_snapshot",
              "participant_phone_hash",
            ],
          },
        });
      }
      const tokenConflict = sessions.find(
        (row) => row.tokenHash === args.data.tokenHash,
      );
      if (tokenConflict) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
          code: "P2002",
          clientVersion: "test",
          meta: { target: ["token_hash"] },
        });
      }
      createCalls += 1;
      const row: FakeSession = {
        id: randomUUID(),
        gameCatalogId: args.data.gameCatalogId,
        tokenHash: args.data.tokenHash,
        browserVisitorHash: args.data.browserVisitorHash,
        participantPhoneHash: args.data.participantPhoneHash,
        campaignKeySnapshot: args.data.campaignKeySnapshot,
        attemptIdHash: args.data.attemptIdHash,
        playExpiresAt: args.data.playExpiresAt,
        claimExpiresAt: null,
        status: "ACTIVE",
        serverAssignment: args.data.serverAssignment,
        gamePlay: null,
      };
      sessions.push(row);
      return {
        id: row.id,
        playExpiresAt: row.playExpiresAt,
        serverAssignment: row.serverAssignment,
      };
    },

    async findFirst(args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) {
      const where = args.where;
      const found = sessions.find((row) => {
        if (
          where.gameCatalogId &&
          where.campaignKeySnapshot &&
          where.participantPhoneHash
        ) {
          return (
            row.gameCatalogId === where.gameCatalogId &&
            row.campaignKeySnapshot === where.campaignKeySnapshot &&
            row.participantPhoneHash === where.participantPhoneHash
          );
        }
        if (where.tokenHash) {
          return (
            row.gameCatalogId === where.gameCatalogId &&
            row.tokenHash === where.tokenHash
          );
        }
        return false;
      });
      return found ?? null;
    },

    async update() {
      throw new Error("gameSession.update must not rewrite assignment");
    },

    async updateMany() {
      return { count: 0 };
    },
  };

  const bookingRequest = {
    async findUnique(args: { where: { id: string }; select: { id: boolean } }) {
      return bookings.get(args.where.id) ?? null;
    },
  };

  return {
    db: {
      gameCatalog,
      gameGift,
      gameSession,
      bookingRequest,
    } as unknown as PrismaClient,
    sessions,
    bookings,
    gifts,
    getCreateCalls: () => createCalls,
    setCatalogStatus(status: "ACTIVE" | "DRAFT" | "DISABLED") {
      catalogRow.status = status;
    },
    corruptAssignment(sessionId: string) {
      const row = sessions.find((session) => session.id === sessionId);
      assert.ok(row);
      row.serverAssignment = { mechanicType: "WHEEL_OF_FORTUNE" };
    },
    markConsumed(sessionId: string, bookingId: string, giftSnapshot: unknown) {
      const row = sessions.find((session) => session.id === sessionId);
      assert.ok(row);
      row.status = "CONSUMED";
      row.gamePlay = {
        id: randomUUID(),
        leadId: bookingId,
        giftSnapshot,
        selectedGiftId: null,
      };
      bookings.set(bookingId, { id: bookingId });
    },
  };
}

async function assertFakePrismaPublicFlow(): Promise<void> {
  const now = new Date("2026-08-03T10:00:00.000Z");
  const attemptId = createWheelAttemptId();
  const fake = createPublicFlowFakePrisma();
  const auth = {
    visitorToken: VISITOR_TOKEN,
    sessionToken: null as string | null,
  };

  await assert.rejects(
    () =>
      startWheelPublicGame({
        catalogSlug: CATALOG_SLUG,
        name: "Анна",
        phone: "+7 999 123-45-67",
        attemptId,
        personalDataConsent: false,
        offerAcknowledgement: true,
        auth,
        now,
        db: fake.db,
        env: TEST_ENV,
        isGameEnabled: true,
      }),
    (error: unknown) =>
      error instanceof WheelPublicGameError &&
      error.code === "WHEEL_CONSENT_REQUIRED",
  );

  const draftFake = createPublicFlowFakePrisma({ catalogStatus: "DRAFT" });
  await assert.rejects(
    () =>
      startWheelPublicGame({
        catalogSlug: CATALOG_SLUG,
        name: "Анна",
        phone: "+7 999 123-45-67",
        attemptId,
        personalDataConsent: true,
        offerAcknowledgement: true,
        auth,
        now,
        db: draftFake.db,
        env: TEST_ENV,
        isGameEnabled: true,
      }),
    (error: unknown) =>
      error instanceof WheelPublicGameError &&
      error.code === "GAME_UNAVAILABLE",
  );

  const started = await startWheelPublicGame({
    catalogSlug: CATALOG_SLUG,
    name: "Анна",
    phone: "+7 999 123-45-67",
    attemptId,
    personalDataConsent: true,
    offerAcknowledgement: true,
    auth,
    now,
    db: fake.db,
    env: TEST_ENV,
    isGameEnabled: true,
  });
  assert.equal(started.ok, true);
  assert.equal(started.created, true);
  assert.equal(started.status, "ACTIVE");
  assert.ok(started.sessionToken);
  assert.ok(started.animation);
  assert.equal(started.animation.totalSectors, 16);
  assert.ok(started.animation.sectorIndex >= 0);
  assert.ok(started.animation.sectorIndex <= 15);
  assertSafeWheelPublicPayload(started);
  assert.doesNotMatch(JSON.stringify(started), /prizeSystemKey|HMAC|probability|attemptIdHash/);
  assert.equal(fake.getCreateCalls(), 1);
  assert.equal(fake.sessions[0]!.browserVisitorHash, VISITOR_HASH);

  const retry = await startWheelPublicGame({
    catalogSlug: CATALOG_SLUG,
    name: "Анна",
    phone: "8 (999) 123-45-67",
    attemptId,
    personalDataConsent: true,
    offerAcknowledgement: true,
    auth,
    now,
    db: fake.db,
    env: TEST_ENV,
    isGameEnabled: true,
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.created, false);
  assert.equal(retry.sessionToken, started.sessionToken);
  assert.equal(retry.animation.sectorIndex, started.animation.sectorIndex);
  assert.equal(fake.getCreateCalls(), 1);

  const otherAttempt = await assert.rejects(
    () =>
      startWheelPublicGame({
        catalogSlug: CATALOG_SLUG,
        name: "Анна",
        phone: "79991234567",
        attemptId: createWheelAttemptId(),
        personalDataConsent: true,
        offerAcknowledgement: true,
        auth,
        now,
        db: fake.db,
        env: TEST_ENV,
        isGameEnabled: true,
      }),
    (error: unknown) =>
      error instanceof WheelPublicGameError &&
      error.code === "WHEEL_ATTEMPT_EXISTS",
  );
  void otherAttempt;

  const result = await getWheelPublicResult({
    catalogSlug: CATALOG_SLUG,
    auth: { visitorToken: VISITOR_TOKEN, sessionToken: started.sessionToken },
    now,
    db: fake.db,
  });
  assert.equal(result.ok, true);
  assert.equal(result.animation?.sectorIndex, started.animation.sectorIndex);
  assert.equal(result.bookingSubmitted, false);
  assertSafeWheelPublicPayload(result);

  await assert.rejects(
    () =>
      getWheelPublicResult({
        catalogSlug: CATALOG_SLUG,
        auth: {
          visitorToken: "other-visitor-token-xx",
          sessionToken: started.sessionToken,
        },
        now,
        db: fake.db,
      }),
    (error: unknown) =>
      error instanceof WheelPublicGameError &&
      error.code === "GAME_SESSION_FORBIDDEN",
  );

  await assert.rejects(
    () =>
      getWheelPublicResult({
        catalogSlug: CATALOG_SLUG,
        auth: {
          visitorToken: VISITOR_TOKEN,
          sessionToken: "bad-token-value-here",
        },
        now,
        db: fake.db,
      }),
    (error: unknown) =>
      error instanceof WheelPublicGameError &&
      error.code === "GAME_SESSION_NOT_FOUND",
  );

  fake.corruptAssignment(fake.sessions[0]!.id);
  await assert.rejects(
    () =>
      getWheelPublicResult({
        catalogSlug: CATALOG_SLUG,
        auth: {
          visitorToken: VISITOR_TOKEN,
          sessionToken: started.sessionToken,
        },
        now,
        db: fake.db,
      }),
    (error: unknown) =>
      error instanceof WheelPublicGameError &&
      error.code === "RESULT_UNAVAILABLE",
  );

  // Restore valid assignment for complete idempotency path.
  const restoredAssignment = parseWheelServerAssignment(
    // Re-run start path uses winner assignment; rebuild from retry snapshot via second catalog start is blocked.
    // Use a fresh fake for complete idempotency.
    null,
  );
  void restoredAssignment;

  const completeFake = createPublicFlowFakePrisma();
  const completeStart = await startWheelPublicGame({
    catalogSlug: CATALOG_SLUG,
    name: "Мария",
    phone: "+79997654321",
    attemptId: createWheelAttemptId(),
    personalDataConsent: true,
    offerAcknowledgement: true,
    auth,
    now,
    db: completeFake.db,
    env: TEST_ENV,
    isGameEnabled: true,
  });
  const bookingId = randomUUID();
  completeFake.markConsumed(completeFake.sessions[0]!.id, bookingId, {
    name: completeStart.animation.prizeDisplayName,
    originalPrize: {
      name: completeStart.animation.prizeDisplayName,
      systemKey: "hand_care_gift",
    },
    finalPrize: {
      name: completeStart.animation.prizeDisplayName,
      systemKey: "hand_care_gift",
    },
    replacementApplied: false,
    confirmedInterest: "lips_permanent",
    confirmedZone: "lips",
  });
  // Catalog inactivated after start must not lose assigned result on complete retry.
  completeFake.setCatalogStatus("DISABLED");
  const completed = await completeWheelPublicGame({
    catalogSlug: CATALOG_SLUG,
    interest: "brows",
    name: "Мария",
    phone: "+79997654321",
    personalDataConsent: true,
    offerAcknowledgement: true,
    auth: {
      visitorToken: VISITOR_TOKEN,
      sessionToken: completeStart.sessionToken,
    },
    request: new Request("http://localhost/api/game/wheel/complete", {
      method: "POST",
    }),
    idempotencyKey: "idem-wheel-complete-1",
    now,
    db: completeFake.db,
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.bookingRequestId, bookingId);
  assert.equal(completed.bookingSubmitted, true);
  assert.equal(completed.replacementApplied, false);
  assertSafeWheelPublicPayload(completed);

  const completedAgain = await completeWheelPublicGame({
    catalogSlug: CATALOG_SLUG,
    interest: "eyelids",
    name: "Мария",
    phone: "+79997654321",
    personalDataConsent: true,
    offerAcknowledgement: true,
    auth: {
      visitorToken: VISITOR_TOKEN,
      sessionToken: completeStart.sessionToken,
    },
    request: new Request("http://localhost/api/game/wheel/complete", {
      method: "POST",
    }),
    idempotencyKey: "idem-wheel-complete-2",
    now,
    db: completeFake.db,
  });
  assert.equal(completedAgain.bookingRequestId, bookingId);
  assert.equal(
    completedAgain.originalPrizeDisplayName,
    completeStart.animation.prizeDisplayName,
  );
}

async function main(): Promise<void> {
  assertStrictAssignmentInRegister();
  assertPublicContracts();
  await assertFakePrismaPublicFlow();
  console.log("security-wheel-of-fortune-public-check: OK");
}

void main();
