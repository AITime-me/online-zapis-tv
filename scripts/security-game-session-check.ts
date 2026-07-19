process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildCatalogScopedGiftPool } from "../src/lib/game/session/catalog-gift-pool";
import {
  buildCatalogSessionCookieName,
  buildCookieBaseOptions,
  GAME_VISITOR_COOKIE,
  PLAY_WINDOW_MS,
  readRequestCookie,
  SESSION_START_LIMIT,
} from "../src/lib/game/session/game-session-cookie";
import {
  validateSessionCompleteBody,
  validateSessionStartBody,
} from "../src/lib/game/session/game-session-contract";
import { GameSessionError } from "../src/lib/game/session/game-session-errors";
import {
  resolveLazyExpirationStatus,
  shouldExpireActiveSession,
  shouldExpireCompletedSession,
} from "../src/lib/game/session/game-session-expiration-rules";
import {
  canRestartSession,
  isPlayRewardConsumed,
  resolveEffectiveSessionStatus,
  shouldReuseSessionForStart,
} from "../src/lib/game/session/game-session-reuse-rules";
import {
  GAME_BOOKING_ALREADY_SUBMITTED_MESSAGE,
} from "../src/lib/game/session/game-session-errors";
import {
  buildGiftSnapshot,
  buildRulesSnapshot,
  parseGiftSnapshot,
} from "../src/lib/game/session/game-session-snapshot";
import {
  generateOpaqueToken,
  hashOpaqueToken,
  isValidTokenHash,
} from "../src/lib/game/session/game-session-token";
import { buildServerEligibleGiftPool } from "../src/lib/game/server-gift-pool";
import { validateSameOriginRequest } from "../src/lib/security/csrf";
import { PUBLIC_MUTATING_API_PATHS } from "../src/lib/security/csrf-route-rules";
import { RATE_LIMITED_API_PATHS } from "../src/lib/security/rate-limit/route-rules";

type MockGift = {
  id: string;
  name: string;
  isActive: boolean;
  probability: number;
  requiredPremiumLevel: number;
  gameCatalogId: string | null;
};

const CATALOG_A = "11111111-1111-4111-8111-111111111111";
const CATALOG_B = "22222222-2222-4222-8222-222222222222";

const MOCK_GIFTS: MockGift[] = [
  {
    id: "aaaa1111-1111-4111-8111-111111111111",
    name: "Standard gift",
    isActive: true,
    probability: 80,
    requiredPremiumLevel: 0,
    gameCatalogId: CATALOG_A,
  },
  {
    id: "bbbb2222-2222-4222-8222-222222222222",
    name: "Premium gift",
    isActive: true,
    probability: 20,
    requiredPremiumLevel: 2,
    gameCatalogId: CATALOG_A,
  },
  {
    id: "cccc3333-3333-4333-8333-333333333333",
    name: "Legacy global gift",
    isActive: true,
    probability: 100,
    requiredPremiumLevel: 0,
    gameCatalogId: null,
  },
];

function assertTokenSecurity(): void {
  const token = generateOpaqueToken();
  assert.ok(token.length >= 32);
  assert.match(token, /^[A-Za-z0-9_-]+$/);

  const hash = hashOpaqueToken(token);
  assert.equal(hash.length, 64);
  assert.ok(isValidTokenHash(hash));
  assert.notEqual(token, hash);

  const raw = randomBytes(32);
  assert.notEqual(raw.toString("base64url"), hashOpaqueToken(raw.toString("hex")));
}

function assertCookiePolicy(): void {
  const base = buildCookieBaseOptions();
  assert.equal(base.httpOnly, true);
  assert.equal(base.sameSite, "lax");
  assert.equal(base.path, "/");
  assert.equal(base.secure, process.env.NODE_ENV === "production");

  const slugA = buildCatalogSessionCookieName("procedure-gift");
  const slugB = buildCatalogSessionCookieName("wheel-fortune");
  const slugA2 = buildCatalogSessionCookieName("procedure-gift");
  assert.equal(slugA, slugA2);
  assert.notEqual(slugA, slugB);
  assert.match(slugA, /^gs_[a-f0-9]{24}$/);

  const token = "abc123";
  const header = `${GAME_VISITOR_COOKIE}=${token}; other=value`;
  assert.equal(readRequestCookie(header, GAME_VISITOR_COOKIE), token);
  assert.equal(readRequestCookie(header, "missing"), null);
}

function assertValidationContracts(): void {
  const startOk = validateSessionStartBody({ catalogSlug: "procedure-gift" });
  assert.equal(startOk.ok, true);

  const startBad = validateSessionStartBody({ catalogSlug: "!!!" });
  assert.equal(startBad.ok, false);

  const completeOk = validateSessionCompleteBody({
    catalogSlug: "procedure-gift",
    gameDirection: "faceCare",
    skinNeed: "dry",
    resultType: "result-a",
    premiumLevel: 999,
  });
  assert.equal(completeOk.ok, true);
  if (completeOk.ok) {
    assert.equal(completeOk.data.premiumLevel, 999);
  }

  const giftIdRejected = validateSessionCompleteBody({
    catalogSlug: "procedure-gift",
    gameDirection: "faceCare",
    skinNeed: "dry",
    resultType: "result-a",
    giftId: "hack",
  });
  assert.equal(giftIdRejected.ok, false);
}

function assertGiftPoolPolicy(): void {
  const scoped = buildCatalogScopedGiftPool(MOCK_GIFTS, CATALOG_A, 0);
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0]?.name, "Standard gift");

  const premiumAttempt = buildCatalogScopedGiftPool(MOCK_GIFTS, CATALOG_A, 0);
  assert.ok(!premiumAttempt.some((gift) => gift.requiredPremiumLevel > 0));

  const nullCatalog = buildCatalogScopedGiftPool(MOCK_GIFTS, CATALOG_B, 0);
  assert.equal(nullCatalog.length, 0);

  const legacyPool = buildServerEligibleGiftPool(
    MOCK_GIFTS.map(({ gameCatalogId: _ignored, ...gift }) => gift),
  );
  assert.equal(legacyPool.length, 2);
}

function assertSnapshots(): void {
  const assignedAt = new Date("2026-07-12T10:00:00.000Z");
  const snapshot = buildGiftSnapshot(
    {
      id: MOCK_GIFTS[0]!.id,
      name: MOCK_GIFTS[0]!.name,
      shortDescription: "Desc",
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

  assert.equal(snapshot.ruleType, "weighted_pool");
  assert.equal(snapshot.assignedAt, assignedAt.toISOString());
  assert.equal("probability" in snapshot, false);
  assert.equal(snapshot.activationMode, "SINGLE_PAID_SERVICE");
  assert.equal(snapshot.validityDays, 30);

  const rules = buildRulesSnapshot({
    campaignKey: "2026-07",
    rulesVersion: "1",
    mechanicType: "CATCH_TIME",
    serverResultTier: 0,
    catalogSlug: "procedure-gift",
    catalogTitle: "Title",
    bookingWindowHours: 24,
  });
  assert.equal(rules.probabilityBucket, "tier-0");
  assert.equal("probability" in rules, false);

  const parsed = parseGiftSnapshot(snapshot);
  assert.ok(parsed);
  parsed!.name = "Changed live gift";
  const original = parseGiftSnapshot(snapshot);
  assert.equal(original!.name, MOCK_GIFTS[0]!.name);
}

function assertExpirationRules(): void {
  const now = new Date("2026-07-12T12:00:00.000Z");
  const active = {
    status: "ACTIVE" as const,
    playExpiresAt: new Date("2026-07-12T11:00:00.000Z"),
    claimExpiresAt: null,
  };
  assert.equal(shouldExpireActiveSession(active, now), true);
  assert.equal(resolveLazyExpirationStatus(active, now), "EXPIRED");

  const completed = {
    status: "COMPLETED" as const,
    playExpiresAt: new Date("2026-07-12T11:00:00.000Z"),
    claimExpiresAt: new Date("2026-07-12T11:30:00.000Z"),
  };
  assert.equal(shouldExpireCompletedSession(completed, now), true);
  assert.equal(resolveLazyExpirationStatus(completed, now), "EXPIRED");
}

function assertSessionLimit(): void {
  assert.equal(SESSION_START_LIMIT, 3);
  assert.ok(3 >= SESSION_START_LIMIT);
  assert.ok(2 < SESSION_START_LIMIT);
}

function assertOriginPolicy(): void {
  const localhostOk = validateSameOriginRequest(
    new Request("http://localhost:3000/api/game/session/start", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
      },
    }),
  );
  assert.equal(localhostOk, true);

  const crossSiteBlocked = validateSameOriginRequest(
    new Request("http://localhost:3000/api/game/session/start", {
      method: "POST",
      headers: {
        "sec-fetch-site": "cross-site",
      },
    }),
  );
  assert.equal(crossSiteBlocked, false);
}

function assertRouteInventory(): void {
  assert.ok(PUBLIC_MUTATING_API_PATHS.has("/api/game/session/start"));
  assert.ok(PUBLIC_MUTATING_API_PATHS.has("/api/game/session/complete"));
  assert.ok(PUBLIC_MUTATING_API_PATHS.has("/api/game/play"));

  const ratePaths = RATE_LIMITED_API_PATHS.map(
    (entry) => `${entry.method} ${entry.pathname}`,
  );
  assert.ok(ratePaths.includes("POST /api/game/session/start"));
  assert.ok(ratePaths.includes("POST /api/game/session/complete"));
  assert.ok(ratePaths.includes("GET /api/game/session/result"));
}

function assertNoServerOnlyInClientOrMiddleware(): void {
  const middlewareSource = fs.readFileSync(
    path.join(process.cwd(), "src", "middleware.ts"),
    "utf8",
  );
  assert.equal(middlewareSource.includes("GameSessionService"), false);
  assert.equal(middlewareSource.includes("game-session-token"), false);

  const gameComponentsDir = path.join(process.cwd(), "src", "components", "game");
  for (const file of fs.readdirSync(gameComponentsDir)) {
    if (!file.endsWith(".tsx") && !file.endsWith(".ts")) {
      continue;
    }
    const source = fs.readFileSync(path.join(gameComponentsDir, file), "utf8");
    assert.equal(source.includes("GameSessionService"), false, file);
    assert.equal(source.includes("game-session-token"), false, file);
    assert.equal(source.includes("server-only"), false, file);
  }
}

function assertPlayRouteUsesAdapter(): void {
  const playRoute = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "api", "game", "play", "route.ts"),
    "utf8",
  );
  assert.match(playRoute, /runGamePlayAdapter/);
  assert.equal(playRoute.includes("createGamePlayAndSelectGift"), false);

  for (const routeFile of [
    "src/app/api/game/session/start/route.ts",
    "src/app/api/game/session/complete/route.ts",
  ]) {
    const source = fs.readFileSync(path.join(process.cwd(), routeFile), "utf8");
    assert.match(source, /enforceSameOriginForMutatingRequest/);
  }
}

function assertPublicDtoHasNoSecrets(): void {
  const startRoute = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "api", "game", "session", "start", "route.ts"),
    "utf8",
  );
  assert.equal(startRoute.includes("tokenHash"), false);
  assert.equal(startRoute.includes("sessionToken"), false);

  const resultRoute = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "api", "game", "session", "result", "route.ts"),
    "utf8",
  );
  assert.equal(resultRoute.includes("tokenHash"), false);
}

function assertCookieNameCollisionResistance(): void {
  const leftName = buildCatalogSessionCookieName("procedure-gift");
  const rightName = buildCatalogSessionCookieName("wheel-fortune");
  assert.notEqual(leftName, rightName);

  const normalizedLeft = buildCatalogSessionCookieName("Procedure-Gift");
  assert.equal(leftName, normalizedLeft);
}

function assertErrorCodes(): void {
  const error = new GameSessionError(
    "GAME_SESSION_EXPIRED",
    "Время игры истекло. Начните заново.",
  );
  assert.equal(error.code, "GAME_SESSION_EXPIRED");
  assert.equal(error.httpStatus, 400);
}

function assertPlayWindowConstant(): void {
  assert.equal(PLAY_WINDOW_MS, 30 * 60 * 1000);
}

function assertHashUsesSha256(): void {
  const token = "test-token-value";
  const expected = createHash("sha256").update(token, "utf8").digest("hex");
  assert.equal(hashOpaqueToken(token), expected);
}

function assertSessionReuseRegression(): void {
  const consumedPlayId = "33333333-3333-4333-8333-333333333333";
  const consumedLeadId = "44444444-4444-4444-8444-444444444444";

  assert.equal(
    shouldReuseSessionForStart({
      status: "CONSUMED",
      play: { leadId: consumedLeadId, consumedAt: new Date() },
    }),
    false,
  );
  assert.equal(
    shouldReuseSessionForStart({
      status: "COMPLETED",
      play: { leadId: consumedLeadId, consumedAt: new Date() },
    }),
    false,
  );
  assert.equal(
    shouldReuseSessionForStart({
      status: "COMPLETED",
      play: { leadId: null, consumedAt: null },
    }),
    true,
  );
  assert.equal(
    resolveEffectiveSessionStatus({
      status: "COMPLETED",
      play: { leadId: consumedPlayId, consumedAt: new Date() },
    }),
    "CONSUMED",
  );
  assert.equal(isPlayRewardConsumed({ leadId: null, consumedAt: new Date() }), true);

  assert.equal(
    canRestartSession({
      status: "COMPLETED",
      play: { leadId: null, consumedAt: null },
    }),
    true,
  );
  assert.equal(
    canRestartSession({
      status: "CONSUMED",
      play: { leadId: consumedLeadId, consumedAt: new Date() },
    }),
    false,
  );

  const sessionService = fs.readFileSync(
    path.join(process.cwd(), "src/services/GameSessionService.ts"),
    "utf8",
  );
  assert.match(sessionService, /reconcileCompletedSessionConsumption/);
  assert.match(sessionService, /shouldReuseSessionForStart/);
  assert.match(sessionService, /restartGameSession/);
  assert.match(sessionService, /assertVisitorCanStartNewGameAttempt/);
  assert.match(sessionService, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);

  const restartRoute = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/game/session/restart/route.ts"),
    "utf8",
  );
  assert.match(restartRoute, /restartGameSession/);
  assert.match(restartRoute, /enforceSameOriginForMutatingRequest/);

  const resultRoute = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/game/session/result/route.ts"),
    "utf8",
  );
  assert.match(resultRoute, /bookingSubmitted/);

  const csrfRules = fs.readFileSync(
    path.join(process.cwd(), "src/lib/security/csrf-route-rules.ts"),
    "utf8",
  );
  assert.match(csrfRules, /\/api\/game\/session\/restart/);

  const vanilla = fs.readFileSync(
    path.join(process.cwd(), "src/components/game/procedure-gift-game-vanilla.tsx"),
    "utf8",
  );
  assert.match(vanilla, /\/api\/game\/session\/restart/);
  assert.match(vanilla, /Оставить телефон и получить подарок/);
  assert.match(vanilla, /Сыграть ещё раз/);
  assert.match(vanilla, /type="button"/);
  assert.match(vanilla, /onClick=\{\(\) => void playAgain\(\)\}/);
  assert.ok(!vanilla.includes('data-action="go-rules"') || !/Заявка уже отправлена[\s\S]*data-action="go-rules"[\s\S]*Сыграть ещё раз/.test(vanilla));
  assert.match(vanilla, /PoimayGameFlowGate/);
  assert.match(vanilla, /bookingSubmittedFromServer/);
  assert.match(GAME_BOOKING_ALREADY_SUBMITTED_MESSAGE, /Заявка по игре уже отправлена/);

  const playSessionJs = fs.readFileSync(
    path.join(process.cwd(), "public/poimay-game/js/play-session.js"),
    "utf8",
  );
  assert.match(playSessionJs, /beginNewAttempt/);
  assert.match(playSessionJs, /poimay-game:new-attempt/);

  const appJs = fs.readFileSync(
    path.join(process.cwd(), "public/poimay-game/js/app.js"),
    "utf8",
  );
  assert.match(appJs, /PoimayGameFlowGate/);
  assert.match(appJs, /beforeStartGame/);
  assert.match(appJs, /showScreen/);

  const giftApiJs = fs.readFileSync(
    path.join(process.cwd(), "public/poimay-game/js/gift-api.js"),
    "utf8",
  );
  assert.match(giftApiJs, /credentials:\s*'same-origin'/);
  assert.match(vanilla, /buildGameBookingScope/);
  assert.match(vanilla, /BOOKING_SUBMITTED_PLAY_ID_KEY/);
}

function runChecks(): void {
  assertTokenSecurity();
  assertCookiePolicy();
  assertValidationContracts();
  assertGiftPoolPolicy();
  assertSnapshots();
  assertExpirationRules();
  assertSessionLimit();
  assertOriginPolicy();
  assertRouteInventory();
  assertNoServerOnlyInClientOrMiddleware();
  assertPlayRouteUsesAdapter();
  assertPublicDtoHasNoSecrets();
  assertCookieNameCollisionResistance();
  assertErrorCodes();
  assertPlayWindowConstant();
  assertHashUsesSha256();
  assertSessionReuseRegression();
}

runChecks();
console.log("security-game-session-check: OK");
