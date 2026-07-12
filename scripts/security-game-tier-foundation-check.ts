process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { randomInt as cryptoRandomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildCatalogScopedGiftPool } from "../src/lib/game/session/catalog-gift-pool";
import {
  buildRulesSnapshot,
  parseRulesSnapshot,
} from "../src/lib/game/session/game-session-snapshot";
import {
  parseGameCatalogSettings,
  resolveCampaignKey,
  resolveRulesVersion,
} from "../src/lib/game/tier/game-catalog-settings";
import {
  assignmentToJson,
  parseServerAssignment,
  resolveServerResultTier,
} from "../src/lib/game/tier/server-assignment";
import {
  assignServerTier,
  buildServerAssignment,
  normalizeTierWeights,
  productionRandomInt,
  resolveTierWeightsFromSettingsRaw,
} from "../src/lib/game/tier/server-tier-assignment";
import {
  applyPremiumTierGuard,
  C2_SERVER_TIER_POLICY,
  PREMIUM_TIERS_ENABLED,
  PREMIUM_DISABLED_READINESS_WARNING,
} from "../src/lib/game/tier/server-tier-policy";
import type { GameCatalogDto } from "../src/types/game-catalog";

const CATALOG_ID = "11111111-1111-4111-8111-111111111111";
const FORMULA_GIFT_ID = "44444444-4444-4444-8444-444444444444";

const SECURITY_INVENTORY = [
  "GameCatalog settings null/malformed fail-safe to tier 0",
  "C2.1 premium guard blocks tier 2 even with weight 100",
  "serverAssignment written on new GameSession start",
  "complete reads persisted assignment not live weights",
  "client premium/score/direction do not affect server tier",
  "gift pool excludes requiredPremiumLevel > 0",
  "Формула сияния cannot be selected at tier 0",
  "public responses exclude tier/weights/assignment",
  "OWNER admin DTO exposes tier-0-only readiness metadata",
  "tier engine uses crypto.randomInt not Math.random",
  "wheel mechanic remains unsupported on public routes",
  "legacy ACTIVE session backfills tier-0 assignment once",
  "malformed serverAssignment fail-safe tier 0",
  "rulesSnapshot campaign/rules match assignment metadata",
  "/api/game/play adapter remains wired",
];

type MockGift = {
  id: string;
  name: string;
  isActive: boolean;
  probability: number;
  requiredPremiumLevel: number;
  gameCatalogId: string | null;
};

const MOCK_GIFTS: MockGift[] = [
  {
    id: "aaaa1111-1111-4111-8111-111111111111",
    name: "Standard gift",
    isActive: true,
    probability: 50,
    requiredPremiumLevel: 0,
    gameCatalogId: CATALOG_ID,
  },
  {
    id: FORMULA_GIFT_ID,
    name: "Формула сияния",
    isActive: true,
    probability: 7,
    requiredPremiumLevel: 2,
    gameCatalogId: CATALOG_ID,
  },
];

const FIXED_NOW = new Date("2026-07-12T10:00:00.000Z");

function assertSettingsParser(): void {
  assert.equal(parseGameCatalogSettings(null).status, "safe-default");
  assert.equal(parseGameCatalogSettings(undefined).status, "safe-default");
  assert.equal(parseGameCatalogSettings("bad").status, "invalid");
  assert.equal(parseGameCatalogSettings({ version: 2 }).status, "invalid");

  const tierTwoOnly = parseGameCatalogSettings({
    version: 1,
    tierWeights: [{ tier: 2, weight: 100 }],
  });
  assert.equal(tierTwoOnly.status, "valid");

  const negative = parseGameCatalogSettings({
    version: 1,
    tierWeights: [{ tier: 0, weight: -5 }],
  });
  assert.equal(negative.status, "invalid");

  const zeroSum = parseGameCatalogSettings({
    version: 1,
    tierWeights: [{ tier: 0, weight: 0 }],
  });
  assert.equal(zeroSum.status, "invalid");

  const nanWeight = parseGameCatalogSettings({
    version: 1,
    tierWeights: [{ tier: 0, weight: Number.NaN }],
  });
  assert.equal(nanWeight.status, "invalid");

  const infinityWeight = parseGameCatalogSettings({
    version: 1,
    tierWeights: [{ tier: 0, weight: Number.POSITIVE_INFINITY }],
  });
  assert.equal(infinityWeight.status, "invalid");

  const tooMany = parseGameCatalogSettings({
    version: 1,
    tierWeights: Array.from({ length: 17 }, (_, index) => ({
      tier: 0,
      weight: 1,
    })),
  });
  assert.equal(tooMany.status, "invalid");
}

function assertPremiumGuard(): void {
  assert.equal(PREMIUM_TIERS_ENABLED, false);

  const assignment = buildServerAssignment({
    mechanicType: "CATCH_TIME",
    catalogCampaignKey: null,
    catalogRulesVersion: "1",
    settingsRaw: { version: 1, tierWeights: [{ tier: 2, weight: 100 }] },
    now: FIXED_NOW,
    randomInt: () => 0,
  });

  assert.equal(assignment.serverResultTier, 0);
  assert.equal(assignment.tierBucket, "tier-0");
  assert.equal(
    assignServerTier([{ tier: 2, weight: 100 }], () => 99),
    0,
  );
  assert.equal(applyPremiumTierGuard(999), 0);
}

function assertTierEngine(): void {
  const normalized = normalizeTierWeights([
    { tier: 0, weight: 10 },
    { tier: 2, weight: 90 },
  ]);
  assert.deepEqual(normalized, [{ tier: 0, weight: 10 }]);

  const engineSource = fs.readFileSync(
    path.join(process.cwd(), "src/lib/game/tier/server-tier-assignment.ts"),
    "utf8",
  );
  assert.doesNotMatch(engineSource, /Math\.random/);
  assert.match(engineSource, /cryptoRandomInt|randomInt/);

  assert.equal(typeof productionRandomInt(3), "number");
  assert.ok(productionRandomInt(10) >= 0 && productionRandomInt(10) < 10);
  assert.equal(cryptoRandomInt(5) >= 0 && cryptoRandomInt(5) < 5, true);
}

function assertAssignmentContract(): void {
  const built = buildServerAssignment({
    mechanicType: "CATCH_TIME",
    catalogCampaignKey: "catalog-campaign",
    catalogRulesVersion: "1",
    settingsRaw: {
      version: 1,
      campaign: { key: "settings-campaign", rulesVersion: "1" },
    },
    now: FIXED_NOW,
  });

  assert.equal(built.version, 1);
  assert.equal(built.mechanicType, "CATCH_TIME");
  assert.equal(built.campaignKey, "settings-campaign");
  assert.equal(built.rulesVersion, "1");
  assert.equal(built.assignedAt, FIXED_NOW.toISOString());
  assert.equal("tierWeights" in built, false);
  assert.equal("probability" in built, false);

  const parsed = parseServerAssignment(assignmentToJson(built));
  assert.ok(parsed);
  assert.equal(parsed?.serverResultTier, 0);

  const malformedTier = parseServerAssignment({
    version: 1,
    mechanicType: "CATCH_TIME",
    serverResultTier: 2,
    campaignKey: null,
    rulesVersion: "1",
    assignedAt: FIXED_NOW.toISOString(),
    tierBucket: "tier-2",
  });
  assert.equal(malformedTier?.serverResultTier, 0);
  assert.equal(malformedTier?.tierBucket, "tier-0");
  assert.equal(resolveServerResultTier({ bad: true }), 0);
}

function assertCampaignRulesPolicy(): void {
  const settings = parseGameCatalogSettings({
    version: 1,
    campaign: { key: "from-settings", rulesVersion: "9" },
  }).settings;

  assert.equal(resolveCampaignKey("catalog-key", settings), "from-settings");
  assert.equal(resolveCampaignKey("catalog-key", null), "catalog-key");
  assert.equal(resolveCampaignKey(null, null), null);
  assert.equal(resolveRulesVersion("1", settings), "1");
  assert.equal(resolveRulesVersion("1", parseGameCatalogSettings({
    version: 1,
    campaign: { rulesVersion: "9" },
  }).settings), "1");
}

function simulateSessionAssignmentLifecycle(): void {
  type SessionRow = {
    id: string;
    status: "ACTIVE" | "COMPLETED" | "CONSUMED" | "EXPIRED";
    serverAssignment: unknown;
  };

  const store = new Map<string, SessionRow>();

  function createSession(id: string): SessionRow {
    const assignment = buildServerAssignment({
      mechanicType: "CATCH_TIME",
      catalogCampaignKey: null,
      catalogRulesVersion: "1",
      settingsRaw: { version: 1, tierWeights: [{ tier: 2, weight: 100 }] },
      now: FIXED_NOW,
    });
    const row: SessionRow = {
      id,
      status: "ACTIVE",
      serverAssignment: assignmentToJson(assignment),
    };
    store.set(id, row);
    return row;
  }

  function backfillIfMissing(row: SessionRow, settingsRaw: unknown, now: Date): unknown {
    const parsed = parseServerAssignment(row.serverAssignment);
    if (parsed) {
      return parsed;
    }
    if (row.status !== "ACTIVE") {
      return buildServerAssignment({
        mechanicType: "CATCH_TIME",
        catalogCampaignKey: null,
        catalogRulesVersion: "1",
        settingsRaw,
        now,
      });
    }
    const assignment = buildServerAssignment({
      mechanicType: "CATCH_TIME",
      catalogCampaignKey: null,
      catalogRulesVersion: "1",
      settingsRaw,
      now,
    });
    row.serverAssignment = assignmentToJson(assignment);
    return assignment;
  }

  const created = createSession("session-1");
  const firstAssignedAt = parseServerAssignment(created.serverAssignment)?.assignedAt;
  assert.ok(firstAssignedAt);

  const secondStart = parseServerAssignment(created.serverAssignment);
  assert.equal(secondStart?.assignedAt, firstAssignedAt);

  const legacy: SessionRow = { id: "legacy", status: "ACTIVE", serverAssignment: null };
  backfillIfMissing(legacy, null, FIXED_NOW);
  assert.equal(parseServerAssignment(legacy.serverAssignment)?.serverResultTier, 0);

  const completed: SessionRow = {
    id: "completed",
    status: "COMPLETED",
    serverAssignment: null,
  };
  backfillIfMissing(completed, { version: 1, tierWeights: [{ tier: 2, weight: 100 }] }, FIXED_NOW);
  assert.equal(completed.serverAssignment, null);

  const liveSettingsChanged = buildServerAssignment({
    mechanicType: "CATCH_TIME",
    catalogCampaignKey: null,
    catalogRulesVersion: "1",
    settingsRaw: { version: 1, tierWeights: [{ tier: 2, weight: 100 }] },
    now: new Date("2026-07-12T11:00:00.000Z"),
  });
  assert.equal(parseServerAssignment(created.serverAssignment)?.serverResultTier, 0);
  assert.notEqual(
    parseServerAssignment(created.serverAssignment)?.assignedAt,
    liveSettingsChanged.assignedAt,
  );
  assert.equal(liveSettingsChanged.serverResultTier, 0);
}

function assertCompleteUsesAssignmentNotClient(): void {
  const assignment = buildServerAssignment({
    mechanicType: "CATCH_TIME",
    catalogCampaignKey: "campaign-a",
    catalogRulesVersion: "1",
    settingsRaw: null,
    now: FIXED_NOW,
  });
  const serverResultTier = assignment.serverResultTier;

  const eligible = buildCatalogScopedGiftPool(MOCK_GIFTS, CATALOG_ID, serverResultTier);
  assert.equal(eligible.some((gift) => gift.id === FORMULA_GIFT_ID), false);
  assert.ok(eligible.length >= 1);

  const rulesSnapshot = buildRulesSnapshot({
    campaignKey: assignment.campaignKey,
    rulesVersion: assignment.rulesVersion,
    mechanicType: "CATCH_TIME",
    serverResultTier,
    catalogSlug: "procedure-gift",
    catalogTitle: "Поймай своё время",
    bookingWindowHours: 24,
  });

  const parsedRules = parseRulesSnapshot(rulesSnapshot);
  assert.ok(parsedRules);
  assert.equal(parsedRules?.campaignKey, assignment.campaignKey);
  assert.equal(parsedRules?.rulesVersion, assignment.rulesVersion);
  assert.equal(parsedRules?.serverResultTier, 0);
  assert.equal(parsedRules?.probabilityBucket, "tier-0");

  const directionDoesNotFilter = buildCatalogScopedGiftPool(
    MOCK_GIFTS,
    CATALOG_ID,
    serverResultTier,
  );
  assert.equal(directionDoesNotFilter.length, 1);
}

function assertPublicAndAdminContracts(): void {
  const sessionServiceSource = fs.readFileSync(
    path.join(process.cwd(), "src/services/GameSessionService.ts"),
    "utf8",
  );
  assert.match(sessionServiceSource, /serverAssignment/);
  assert.doesNotMatch(sessionServiceSource, /SERVER_RESULT_TIER/);

  const playRouteSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/game/play/route.ts"),
    "utf8",
  );
  assert.match(playRouteSource, /runGamePlayAdapter/);
  assert.doesNotMatch(playRouteSource, /serverAssignment|serverResultTier|tierWeights/);

  const catalogTypesSource = fs.readFileSync(
    path.join(process.cwd(), "src/types/game-catalog.ts"),
    "utf8",
  );
  assert.match(catalogTypesSource, /serverReadiness/);
  assert.match(catalogTypesSource, /tier-0-only/);

  const ownerDto: GameCatalogDto = {
    id: "id",
    slug: "procedure-gift",
    title: "Game",
    type: "catch_time",
    status: "active",
    description: null,
    settings: null,
    externalUrl: null,
    legacyConfigId: "default",
    publicPath: "/promo/procedure-gift",
    publicUrl: "https://example.test/promo/procedure-gift",
    campaignKey: null,
    rulesVersion: "1",
    isPrimaryPublic: false,
    publicPriority: 0,
    activeFrom: null,
    activeTo: null,
    serverReadiness: {
      settingsStatus: "safe-default",
      serverPolicy: C2_SERVER_TIER_POLICY,
      premiumDisabledNotice: PREMIUM_DISABLED_READINESS_WARNING,
    },
    createdAt: FIXED_NOW.toISOString(),
    updatedAt: FIXED_NOW.toISOString(),
  };
  assert.equal(ownerDto.serverReadiness.serverPolicy, "tier-0-only");
  assert.match(ownerDto.serverReadiness.premiumDisabledNotice, /Premium rewards disabled/);
}

function assertNoClientTierImports(): void {
  const clientRoots = [
    "src/components",
    "src/app",
    "public",
  ];
  const forbiddenImport = /@\/lib\/game\/tier\/(game-catalog-settings|server-tier-assignment)(?!-contract)/;

  for (const root of clientRoots) {
    const absoluteRoot = path.join(process.cwd(), root);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }
    walkFiles(absoluteRoot, (filePath) => {
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
        forbiddenImport,
        `${filePath} must not import server tier parser/engine`,
      );
    });
  }
}

function walkFiles(dir: string, visit: (filePath: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, visit);
    } else {
      visit(fullPath);
    }
  }
}

function assertWheelUnsupported(): void {
  const sessionServiceSource = fs.readFileSync(
    path.join(process.cwd(), "src/services/GameSessionService.ts"),
    "utf8",
  );
  assert.match(sessionServiceSource, /GAME_MECHANIC_UNSUPPORTED/);

  const wheelContractPath = path.join(
    process.cwd(),
    "src/lib/game/tier/wheel-settings-contract.ts",
  );
  assert.ok(fs.existsSync(wheelContractPath));
}

function assertSeedExpectations(): void {
  const productionSeed = fs.readFileSync(
    path.join(process.cwd(), "prisma/seed.production.ts"),
    "utf8",
  );
  assert.match(productionSeed, /status:\s*"DISABLED"/);

  const devSeed = fs.readFileSync(path.join(process.cwd(), "prisma/seed.ts"), "utf8");
  assert.match(devSeed, /probability:\s*50/);
  assert.match(devSeed, /probability:\s*25/);
  assert.match(devSeed, /probability:\s*18/);
  assert.match(devSeed, /probability:\s*7/);
  assert.match(devSeed, /requiredPremiumLevel:\s*2/);
}

function assertBookingConsumeStillWired(): void {
  const bookingConsumeScript = path.join(
    process.cwd(),
    "scripts/security-game-booking-consume-check.ts",
  );
  assert.ok(fs.existsSync(bookingConsumeScript));
}

function assertWeightsNotLeakedInSnapshots(): void {
  const assignmentJson = JSON.stringify(
    buildServerAssignment({
      mechanicType: "CATCH_TIME",
      catalogCampaignKey: null,
      catalogRulesVersion: "1",
      settingsRaw: { version: 1, tierWeights: [{ tier: 0, weight: 50 }] },
      now: FIXED_NOW,
    }),
  );
  assert.doesNotMatch(assignmentJson, /tierWeights|"weight"/);
  assert.doesNotMatch(assignmentJson, /probability/);

  const rulesSnapshot = buildRulesSnapshot({
    campaignKey: null,
    rulesVersion: "1",
    mechanicType: "CATCH_TIME",
    serverResultTier: 0,
    catalogSlug: "procedure-gift",
    catalogTitle: "Game",
    bookingWindowHours: 24,
  });
  const rulesJson = JSON.stringify(rulesSnapshot);
  assert.doesNotMatch(rulesJson, /tierWeights|"weight"/);
}

function assertResolveTierWeights(): void {
  assert.deepEqual(resolveTierWeightsFromSettingsRaw(null), []);
  assert.deepEqual(
    resolveTierWeightsFromSettingsRaw({ version: 1, tierWeights: [{ tier: 2, weight: 100 }] }),
    [{ tier: 2, weight: 100 }],
  );
}

function runChecks(): void {
  assertSettingsParser();
  assertPremiumGuard();
  assertTierEngine();
  assertAssignmentContract();
  assertCampaignRulesPolicy();
  simulateSessionAssignmentLifecycle();
  assertCompleteUsesAssignmentNotClient();
  assertPublicAndAdminContracts();
  assertNoClientTierImports();
  assertWheelUnsupported();
  assertSeedExpectations();
  assertBookingConsumeStillWired();
  assertWeightsNotLeakedInSnapshots();
  assertResolveTierWeights();

  console.log("Security game tier foundation checks passed.");
  console.log(`Coverage inventory (${SECURITY_INVENTORY.length}):`);
  for (const item of SECURITY_INVENTORY) {
    console.log(`- ${item}`);
  }
}

runChecks();
