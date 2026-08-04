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
  buildTestWheelServerAssignment,
  buildWheelAssignmentPrizeSnapshot,
} from "../src/lib/game/wheel/wheel-assignment-prize-snapshot";
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

function sampleAssignment(sectorIndex = 3) {
  const gifts = buildDefaultGifts();
  const gift = gifts[sectorIndex] ?? gifts[0]!;
  const prizeSnapshot = buildWheelAssignmentPrizeSnapshot(gift.id, gifts);
  assert.ok(prizeSnapshot);
  return buildTestWheelServerAssignment({
    sectorIndex,
    giftId: gift.id,
    prizeSystemKey: gift.systemKey!,
    prizeSnapshot,
  });
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
  assert.ok(parseWheelServerAssignment(sampleAssignment(3)));
  assert.equal(
    parseWheelServerAssignment({
      version: 1,
      mechanicType: "WHEEL_OF_FORTUNE",
      sectorIndex: 3,
    }),
    null,
  );
}

/** Public success keys for POST /api/game/wheel/start (WheelPublicStartResponse). */
const WHEEL_START_PUBLIC_JSON_KEYS = [
  "ok",
  "status",
  "expiresAt",
  "created",
  "animation",
] as const;

/**
 * Forbid leaking WheelPublicStartServiceResult into HTTP JSON.
 * Allows result.cookieOperations only via applyCookieOperations (HttpOnly cookies).
 */
function assertWheelStartRouteForbidsInternalResultLeak(startRoute: string): void {
  assert.doesNotMatch(
    startRoute,
    /NextResponse\.json\(\s*result\s*[,)]/,
    "public /start must not return NextResponse.json(result)",
  );
  assert.doesNotMatch(
    startRoute,
    /\.\.\.\s*result\b/,
    "public /start must not spread service result (...result) into JSON",
  );
  assert.doesNotMatch(
    startRoute,
    /NextResponse\.json\([\s\S]*?\bsessionToken\s*:/,
    "public /start JSON must not include sessionToken",
  );
  assert.doesNotMatch(
    startRoute,
    /NextResponse\.json\([\s\S]*?\bcookieOperations\s*:/,
    "public /start JSON must not include cookieOperations",
  );
  assert.doesNotMatch(
    startRoute,
    /sessionToken:\s*result\.sessionToken/,
    "public /start must not assign result.sessionToken into JSON",
  );
}

function assertWheelStartRouteAllowlistedPublicPayload(startRoute: string): void {
  // Cookie path stays internal — raw token never needs to appear in route source.
  assert.match(
    startRoute,
    /applyCookieOperations\(\s*response\s*,\s*result\.cookieOperations\s*\)/,
    "start route must set HttpOnly cookies via result.cookieOperations",
  );

  const success = startRoute.match(
    /NextResponse\.json\(\s*\{\s*ok:\s*true\s*,([\s\S]*?)\}\s*\)/,
  );
  assert.ok(
    success,
    "success /start response must use explicit NextResponse.json({ ok: true, ... })",
  );
  const body = `ok: true,${success[1]}`;
  assert.doesNotMatch(
    body,
    /\.\.\./,
    "success /start JSON object must not use object spread",
  );
  assert.doesNotMatch(body, /\bsessionToken\b/);
  assert.doesNotMatch(body, /\bcookieOperations\b/);

  const keys = [
    ...body.matchAll(/(?:^|[,{])\s*([A-Za-z_][\w]*)\s*:/g),
  ].map((match) => match[1]!);
  const uniqueKeys = [...new Set(keys)];
  for (const key of uniqueKeys) {
    assert.ok(
      (WHEEL_START_PUBLIC_JSON_KEYS as readonly string[]).includes(key),
      `unexpected public /start JSON key: ${key}`,
    );
  }
  for (const required of WHEEL_START_PUBLIC_JSON_KEYS) {
    assert.ok(
      uniqueKeys.includes(required),
      `missing required public /start JSON key: ${required}`,
    );
  }
  assert.match(
    body,
    /status:\s*result\.status/,
  );
  assert.match(
    body,
    /expiresAt:\s*result\.expiresAt/,
  );
  assert.match(
    body,
    /created:\s*result\.created/,
  );
  assert.match(
    body,
    /animation:\s*result\.animation/,
  );
}

function assertWheelStartRoutePublicJsonContract(startRoute: string): void {
  assertWheelStartRouteForbidsInternalResultLeak(startRoute);
  assertWheelStartRouteAllowlistedPublicPayload(startRoute);
}

function assertWheelStartRouteLeakGuardsSelfTest(): void {
  assert.throws(
    () =>
      assertWheelStartRouteForbidsInternalResultLeak(
        "NextResponse.json(result)",
      ),
    /NextResponse\.json\(result\)/,
  );
  assert.throws(
    () =>
      assertWheelStartRouteForbidsInternalResultLeak(
        "NextResponse.json({ ...result })",
      ),
    /\.\.\.\s*result/,
  );
  assert.throws(
    () =>
      assertWheelStartRouteForbidsInternalResultLeak(
        "NextResponse.json({ ok: true, animation: result.animation, ...result })",
      ),
    /\.\.\.\s*result/,
  );
  assert.throws(
    () =>
      assertWheelStartRouteForbidsInternalResultLeak(
        "const payload = { ...result };\nNextResponse.json(payload)",
      ),
    /\.\.\.\s*result/,
  );
  assert.throws(
    () =>
      assertWheelStartRouteForbidsInternalResultLeak(
        "NextResponse.json({ ok: true, sessionToken: result.sessionToken })",
      ),
    /sessionToken/,
  );
  assert.throws(
    () =>
      assertWheelStartRouteForbidsInternalResultLeak(
        "NextResponse.json({ ok: true, cookieOperations: result.cookieOperations })",
      ),
    /cookieOperations/,
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
  assert.match(client, /mapUiPreferencesToCompletePayload/);
  assert.match(client, /WheelFortuneView/);
  assert.match(
    client,
    /setPhase\("intro"\)|setPhase\("ready"\)|setPhase\("result"\)/,
  );
  assert.match(client, /setPhase\("submitted"\)|setPhase\("restored"\)/);
  assert.match(client, /\/api\/game\/wheel\/start/);
  assert.match(client, /\/api\/game\/wheel\/complete/);
  assert.match(client, /\/api\/game\/wheel\/result/);
  assert.match(client, /data-testid=["']wheel-phone-input["']/);
  assert.match(client, /aria-label=["']Номер телефона["']/);
  assert.match(client, /type=["']tel["']/);
  assert.match(client, /data-testid=["']wheel-error-alert["']/);
  assert.match(client, /startRequestSerial|startSucceededRef/);
  assert.doesNotMatch(client, /wheel_lead_|persistLead|sessionStorage\.setItem\([^)]*phone|sessionStorage\.setItem\([^)]*name/i);

  const adapter = read("src/components/game/wheel-public-ui-adapter.ts");
  assert.match(adapter, /interest:\s*zone/);
  assert.match(adapter, /interest:\s*"undecided"/);
  assert.doesNotMatch(adapter, /interest:\s*"primary"/);

  const countrySelect = read("src/components/booking/phone-country-select.tsx");
  assert.match(countrySelect, /aria-label=["']Код страны["']/);

  const promo = read("src/app/promo/[slug]/page.tsx");
  assert.match(promo, /WheelFortunePublic/);
  assert.match(promo, /assertWheelCatalogReadyForActivation/);

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
  assert.throws(
    () => assertSafeWheelPublicPayload({ ok: true, sessionToken: "secret" }),
    /sessionToken/,
  );

  assertWheelStartRouteLeakGuardsSelfTest();
  const startRoute = read("src/app/api/game/wheel/start/route.ts");
  assertWheelStartRoutePublicJsonContract(startRoute);

  const dto = read("src/lib/game/wheel/wheel-public-dto.ts");
  assert.match(dto, /"sessionToken"/);
  assert.match(dto, /FORBIDDEN_PUBLIC_KEYS[\s\S]*sessionToken/);
  const startResponseType = dto.match(
    /export type WheelPublicStartResponse = \{([^}]+)\}/,
  );
  assert.ok(startResponseType, "WheelPublicStartResponse type must exist");
  assert.doesNotMatch(
    startResponseType[1]!,
    /sessionToken|cookieOperations/,
    "WheelPublicStartResponse must not declare credential fields",
  );
  assert.match(
    dto,
    /export type WheelPublicStartServiceResult = WheelPublicStartResponse & \{\s*sessionToken: string;/,
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
  const legalAcceptances: Array<{ gamePlayId: string | null }> = [];
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
        if (where.id && row.id === where.id) {
          return true;
        }
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

    async updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) {
      let count = 0;
      for (const row of sessions) {
        if (args.where.id && row.id !== args.where.id) {
          continue;
        }
        if (args.where.status && row.status !== args.where.status) {
          continue;
        }
        if (
          Array.isArray(args.where.status?.in) &&
          !(args.where.status.in as string[]).includes(row.status)
        ) {
          continue;
        }
        Object.assign(row, args.data);
        count += 1;
      }
      return { count };
    },
  };

  const gamePlay = {
    async create(args: {
      data: {
        gameSessionId: string;
        selectedGiftId: string;
        giftSnapshot: unknown;
        rulesSnapshot: unknown;
      };
      select: { id: boolean };
    }) {
      const conflict = sessions.find(
        (row) => row.gamePlay?.id && row.id === args.data.gameSessionId,
      );
      if (conflict?.gamePlay) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
          code: "P2002",
          clientVersion: "test",
          meta: { target: ["game_session_id"] },
        });
      }
      const session = sessions.find((row) => row.id === args.data.gameSessionId);
      assert.ok(session);
      const play = {
        id: randomUUID(),
        leadId: null as string | null,
        giftSnapshot: args.data.giftSnapshot,
        selectedGiftId: args.data.selectedGiftId,
      };
      session.gamePlay = play;
      session.status = "COMPLETED";
      return { id: play.id };
    },
    async findUnique(args: {
      where: { gameSessionId?: string; id?: string };
      select?: Record<string, unknown>;
    }) {
      if (args.where.gameSessionId) {
        const session = sessions.find((row) => row.id === args.where.gameSessionId);
        return session?.gamePlay ?? null;
      }
      for (const session of sessions) {
        if (session.gamePlay?.id === args.where.id) {
          return {
            ...session.gamePlay,
            gameSessionId: session.id,
            gameCatalogId: session.gameCatalogId,
            consumedAt: null,
          };
        }
      }
      return null;
    },
    async updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) {
      let count = 0;
      for (const session of sessions) {
        if (!session.gamePlay || session.gamePlay.id !== args.where.id) {
          continue;
        }
        if (args.where.leadId === null && session.gamePlay.leadId !== null) {
          continue;
        }
        Object.assign(session.gamePlay, args.data);
        if (args.data.leadId) {
          session.status = "CONSUMED";
        }
        count += 1;
      }
      return { count };
    },
  };

  const bookingRequest = {
    async findUnique(args: {
      where: { id?: string; idempotencyKey?: string };
      select?: Record<string, unknown>;
      include?: Record<string, unknown>;
    }) {
      if (args.where.id) {
        return bookings.get(args.where.id) ?? null;
      }
      if (args.where.idempotencyKey) {
        for (const booking of bookings.values()) {
          if ((booking as { idempotencyKey?: string }).idempotencyKey === args.where.idempotencyKey) {
            return booking;
          }
        }
      }
      return null;
    },
    async create(args: {
      data: { idempotencyKey: string };
      include?: Record<string, unknown>;
    }) {
      const id = randomUUID();
      const row = {
        id,
        idempotencyKey: args.data.idempotencyKey,
        idempotencyPayloadHash: "hash",
      };
      bookings.set(id, row);
      return row;
    },
  };

  const legalAcceptance = {
    async create(args: { data: { gamePlayId?: string | null } }) {
      legalAcceptances.push({ gamePlayId: args.data.gamePlayId ?? null });
      return { id: randomUUID() };
    },
  };

  const db = {
    gameCatalog,
    gameGift,
    gameSession,
    gamePlay,
    bookingRequest,
    legalAcceptance,
    async $transaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
      return fn(db);
    },
    async $executeRaw() {
      return 0;
    },
  } as unknown as PrismaClient;

  return {
    db,
    sessions,
    bookings,
    legalAcceptances,
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
  // Public JSON contract excludes sessionToken; service still returns it for cookies/tests.
  assertSafeWheelPublicPayload({
    ok: started.ok,
    status: started.status,
    expiresAt: started.expiresAt,
    created: started.created,
    animation: started.animation,
  });
  assert.doesNotMatch(
    JSON.stringify({
      ok: started.ok,
      status: started.status,
      expiresAt: started.expiresAt,
      created: started.created,
      animation: started.animation,
    }),
    /prizeSystemKey|HMAC|probability|attemptIdHash|sessionToken/,
  );
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

  await assert.rejects(
    () =>
      completeWheelPublicGame({
        catalogSlug: CATALOG_SLUG,
        interest: "lips",
        name: "Анна",
        phone: "+79990000000",
        personalDataConsent: true,
        offerAcknowledgement: true,
        auth: {
          visitorToken: VISITOR_TOKEN,
          sessionToken: started.sessionToken,
        },
        request: new Request("http://localhost/api/game/wheel/complete", {
          method: "POST",
        }),
        idempotencyKey: "idem-wheel-phone-mismatch",
        now,
        db: fake.db,
        env: TEST_ENV,
      }),
    (error: unknown) =>
      error instanceof WheelPublicGameError &&
      error.code === "GAME_SESSION_FORBIDDEN",
  );

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
  let bookingCreates = 0;
  const completed = await completeWheelPublicGame({
    catalogSlug: CATALOG_SLUG,
    interest: "lips",
    name: "Мария",
    phone: "8 (999) 765-43-21",
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
    env: TEST_ENV,
    createBookingRequestFn: async () => {
      bookingCreates += 1;
      completeFake.bookings.set(bookingId, { id: bookingId });
      const session = completeFake.sessions[0]!;
      assert.ok(session.gamePlay);
      session.gamePlay.leadId = bookingId;
      session.status = "CONSUMED";
      completeFake.legalAcceptances.push({ gamePlayId: session.gamePlay.id });
      return {
        id: bookingId,
        clientName: "Мария",
        clientPhone: "79997654321",
        status: "NEW",
        type: "CONSULTATION_REQUEST",
        createdAt: now.toISOString(),
        isFromGame: true,
        serviceNameSnapshot: null,
        appointmentServiceName: null,
      };
    },
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.bookingRequestId, bookingId);
  assert.equal(bookingCreates, 1);
  assert.equal(completeFake.legalAcceptances.length, 1);
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
    env: TEST_ENV,
    createBookingRequestFn: async () => {
      bookingCreates += 1;
      return {
        id: bookingId,
        clientName: "Мария",
        clientPhone: "79997654321",
        status: "NEW",
        type: "CONSULTATION_REQUEST",
        createdAt: now.toISOString(),
        isFromGame: true,
        serviceNameSnapshot: null,
        appointmentServiceName: null,
      };
    },
  });
  assert.equal(completedAgain.bookingRequestId, bookingId);
  assert.equal(bookingCreates, 1);
  assert.equal(
    completedAgain.originalPrizeDisplayName,
    completeStart.animation.prizeDisplayName,
  );

  completeFake.gifts[0]!.name = "MUTATED";
  completeFake.gifts[0]!.isActive = false;
  completeFake.setCatalogStatus("DISABLED");
  const afterMutation = await getWheelPublicResult({
    catalogSlug: CATALOG_SLUG,
    auth: {
      visitorToken: VISITOR_TOKEN,
      sessionToken: completeStart.sessionToken,
    },
    now,
    db: completeFake.db,
  });
  assert.equal(
    afterMutation.animation?.sectorIndex,
    completeStart.animation.sectorIndex,
  );
  assert.equal(
    afterMutation.prizeDisplayName,
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
