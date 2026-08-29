/**
 * BOT-CONTROL-PLANE-05 — static / unit proofs for LIVE business facts.
 */
process.env.SECURITY_BATCH_TEST = "1";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/tvoe_vremya_security_batch";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertBotInternalRouteCoverage } from "./security-bot-internal-route-coverage-check";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function testRouteCoverageAndAuth(): void {
  const routePath = "src/app/api/internal/bot/v1/live-facts/route.ts";
  const covered = assertBotInternalRouteCoverage();
  assert.ok(covered.includes(routePath), "live-facts must be under withBotInternalApi coverage");

  const route = read(routePath);
  assert.match(route, /withBotInternalApi/);
  assert.match(route, /buildBotLiveFactsPayload/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.match(route, /BOT_LIVE_FACTS_OWNERSHIP_INVARIANT/);
  assert.match(route, /status: 500/);
  assert.doesNotMatch(route, /botKnowledgeEntry|BotKnowledgePublication|botSettings/);
  assert.doesNotMatch(route, /getBookingCatalog|buildBotKnowledgeFoundation/);
  assert.doesNotMatch(stripComments(route), /\bslots\b|\bavailableDays\b|\bpromotions\b/);
}

function testServiceBoundaries(): void {
  const service = read("src/services/BotLiveFactsService.ts");
  const stripped = stripComments(service);

  assert.match(service, /buildBotLiveFactsPayload/);
  assert.match(service, /resolveServiceBookingModes/);
  assert.match(service, /getPublicStudioSettings/);
  assert.match(service, /masterServices/);
  assert.match(service, /isEnabled: true/);
  assert.match(service, /SEED_TEST_SERVICE_IDS/);

  assert.doesNotMatch(stripped, /botKnowledgeEntry/);
  assert.doesNotMatch(stripped, /BotKnowledgePublication/);
  assert.doesNotMatch(stripped, /botSettings/);
  assert.doesNotMatch(stripped, /BotSettingsPublication/);
  assert.doesNotMatch(stripped, /buildBotKnowledgeFoundation/);
  assert.doesNotMatch(stripped, /BotKnowledgeFoundationService/);
  assert.doesNotMatch(stripped, /getAvailableTimeSlots|listAvailableDays|scheduleBlock/);
  assert.doesNotMatch(stripped, /PROMO_RULES|listHomepagePromotions|gameGift/);
  assert.doesNotMatch(stripped, /priceLabel|formatPriceDisplay/);
  assert.doesNotMatch(stripped, /2000|от\s+\d/);
  assert.doesNotMatch(service, /MANAGER_ONLY.*inject|инъекц/i);
}

function testContractModule(): void {
  const contract = read("src/lib/bot-api/live-facts-contract.ts");
  assert.match(contract, /BOT_LIVE_FACTS_SCHEMA_VERSION = 1/);
  assert.match(contract, /LIVE_FACTS_WINS_OVER_KB_PROSE/);
  assert.match(contract, /LIVE_FACTS_EXCLUDES_AVAILABILITY/);
  assert.match(contract, /PROMOTIONS_GIFTS_OMITTED_V1/);
  assert.match(contract, /canonicalDecimalString/);
  assert.doesNotMatch(stripComments(contract), /Number\(/);
}

async function testPayloadSerialization(): Promise<void> {
  const {
    buildBotLiveFactsPayloadV1,
    assertValidBotLiveFactsPayloadV1,
    BOT_LIVE_FACTS_SCHEMA_VERSION,
    BOT_LIVE_FACTS_OWNERSHIP_INVARIANT,
    BOT_LIVE_FACTS_AVAILABILITY_BOUNDARY,
    BotLiveFactsPayloadError,
  } = await import("../src/lib/bot-api/live-facts-contract");

  assert.equal(BOT_LIVE_FACTS_SCHEMA_VERSION, 1);
  assert.match(BOT_LIVE_FACTS_OWNERSHIP_INVARIANT, /LIVE_FACTS_WINS/);
  assert.match(BOT_LIVE_FACTS_AVAILABILITY_BOUNDARY, /EXCLUDES_AVAILABILITY/);

  const idA = "11111111-1111-4111-8111-111111111111";
  const idB = "22222222-2222-4222-8222-222222222222";
  const idC = "33333333-3333-4333-8333-333333333333";
  const masterId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  const payload = buildBotLiveFactsPayloadV1({
    generatedAt: "2026-08-29T12:00:00.000Z",
    studio: {
      name: "Студия",
      phone: "8 912 000-00-00",
      email: "a@b.c",
      address: "Адрес",
      workingHoursText: "10–20",
      isOnlineBookingEnabled: true,
    },
    services: [
      {
        id: idB,
        name: "Бета",
        category: "Категория",
        priceFrom: "3500.00",
        priceTo: "3500.00",
        durationMinutes: 60,
        bookingMode: "ONLINE",
        isActive: true,
        isOnlineBookingEnabled: true,
        sortOrder: 2,
      },
      {
        id: idA,
        name: "Альфа",
        category: null,
        priceFrom: "2000",
        priceTo: null,
        durationMinutes: 45,
        bookingMode: "MANAGER_ONLY",
        isActive: true,
        isOnlineBookingEnabled: false,
        sortOrder: 1,
      },
      {
        id: idC,
        name: "Неактивная",
        category: "Категория",
        priceFrom: null,
        priceTo: null,
        durationMinutes: 30,
        bookingMode: "MANAGER_ONLY",
        isActive: false,
        isOnlineBookingEnabled: true,
        sortOrder: 3,
      },
    ],
    masters: [
      {
        id: masterId,
        name: "Мастер",
        isActive: true,
        isOnlineBookingEnabled: true,
        sortOrder: 1,
        serviceIds: [idB, idA],
      },
    ],
  });

  assert.equal(payload.schemaVersion, 1);
  assert.deepEqual(
    payload.services.map((s) => s.id),
    [idA, idB, idC],
    "deterministic service ordering by sortOrder then name/id",
  );
  assert.equal(payload.services[0]?.priceFrom, "2000");
  assert.equal(payload.services[0]?.bookingMode, "MANAGER_ONLY");
  assert.equal(payload.services[1]?.bookingMode, "ONLINE");
  assert.equal(payload.services[2]?.isActive, false);
  assert.deepEqual(payload.masters[0]?.serviceIds, [idA, idB], "serviceIds sorted");
  assertValidBotLiveFactsPayloadV1(payload);

  assert.equal(
    "slots" in payload || "availableDays" in payload || "availability" in payload,
    false,
  );
  assert.equal("promotions" in payload || "gifts" in payload, false);

  assert.throws(
    () =>
      buildBotLiveFactsPayloadV1({
        generatedAt: "2026-08-29T12:00:00.000Z",
        studio: payload.studio,
        services: [
          {
            id: idA,
            name: "X",
            category: null,
            priceFrom: "от 2000",
            priceTo: null,
            durationMinutes: 30,
            bookingMode: "ONLINE",
            isActive: true,
            isOnlineBookingEnabled: true,
            sortOrder: 1,
          },
        ],
        masters: [],
      }),
    BotLiveFactsPayloadError,
  );

  // Empty serviceIds is valid — linkage absent must not be fabricated.
  const noLinks = buildBotLiveFactsPayloadV1({
    generatedAt: "2026-08-29T12:00:00.000Z",
    studio: payload.studio,
    services: [],
    masters: [
      {
        id: masterId,
        name: "Мастер",
        isActive: true,
        isOnlineBookingEnabled: true,
        sortOrder: 0,
        serviceIds: [],
      },
    ],
  });
  assert.deepEqual(noLinks.masters[0]?.serviceIds, []);
}

async function testAuthRejectsMissingBearer(): Promise<void> {
  const previous = process.env.BOT_INTERNAL_API_TOKEN;
  const token = "a".repeat(32);
  process.env.BOT_INTERNAL_API_TOKEN = token;

  try {
    const auth = await import("../src/lib/auth/bot-internal-auth");
    const denied = auth.enforceBotInternalAuth(
      new Request("http://localhost/api/internal/bot/v1/live-facts"),
    );
    assert.ok(denied);
    assert.equal(denied.status, 401);

    const ok = auth.enforceBotInternalAuth(
      new Request("http://localhost/api/internal/bot/v1/live-facts", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    assert.equal(ok, null);
  } finally {
    if (previous === undefined) {
      delete process.env.BOT_INTERNAL_API_TOKEN;
    } else {
      process.env.BOT_INTERNAL_API_TOKEN = previous;
    }
  }
}

async function testFailClosedOnSotFailure(): Promise<void> {
  const { buildBotLiveFactsPayload } = await import(
    "../src/services/BotLiveFactsService"
  );

  await assert.rejects(
    () =>
      buildBotLiveFactsPayload({
        db: {
          service: {
            findMany: async () => {
              throw new Error("sot-down");
            },
          },
          master: {
            findMany: async () => [],
          },
        } as never,
        resolveTiming: async () => null,
        isStudioOnlineBookingEnabled: async () => true,
        getStudioPublicSettings: async () => ({
          studioName: "X",
          phone: "1",
          email: "a@b.c",
          address: "y",
          vkUrl: "",
          maxUrl: "",
          workingHoursText: "",
          privacyUrl: "/privacy",
          termsUrl: "/terms",
          consentUrl: "/consent",
          offerUrl: "/offer",
          isOnlineBookingEnabled: true,
          isGameEnabled: false,
          isPromotionsEnabled: false,
          cookieBannerText: "",
          cookieDetailsUrl: "/cookies",
        }),
        resolveBookingModes: async () => new Map(),
        now: () => new Date("2026-08-29T12:00:00.000Z"),
      }),
    /sot-down/,
  );
}

function testPackageAndCi(): void {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts["test:security:bot-live-facts"]);
  assert.ok(pkg.scripts["test:security:bot-live-facts-db"]);
  assert.ok(pkg.scripts["test:security:bot-live-facts-db:required"]);

  const workflow = read(".github/workflows/bot-internal-booking-create-pg-gate.yml");
  assert.match(workflow, /test:security:bot-live-facts/);
  assert.match(workflow, /test:security:bot-live-facts-db:required/);
  assert.match(workflow, /live-facts/);
  assert.match(workflow, /BotLiveFactsService/);
}

function testDocsAndKbBoundary(): void {
  const docs = read("docs/architecture/bot-live-facts.md");
  assert.match(docs, /LIVE_FACTS_WINS_OVER_KB_PROSE/);
  assert.match(docs, /availability/);
  assert.match(docs, /Promotions/);

  const kb = read("src/lib/bot-knowledge/publication-contract.ts");
  assert.match(kb, /live-facts/);
  assert.match(kb, /BOT-CONTROL-PLANE-05/);
}

async function main(): Promise<void> {
  testRouteCoverageAndAuth();
  testServiceBoundaries();
  testContractModule();
  await testPayloadSerialization();
  await testAuthRejectsMissingBearer();
  await testFailClosedOnSotFailure();
  testPackageAndCi();
  testDocsAndKbBoundary();
  console.log("security-bot-live-facts-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
