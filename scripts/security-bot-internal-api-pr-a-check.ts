/**
 * CURSOR-15 PR A — bot internal auth, eligibility, studio kill-switch,
 * CSRF exemption, and public regression (no DB).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type { BookingPolicyRuntime } from "../src/services/BookingService";
import { requiresAdminCsrfProtection } from "../src/lib/security/csrf-route-rules";
import { resolveApiRateLimitPolicy } from "../src/lib/security/rate-limit/route-rules";
import { isCanonicalUuid } from "../src/lib/booking-requests/idempotency-contract";

process.env.SECURITY_BATCH_TEST = "1";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/tvoe_vremya_security_batch";
const originalConsoleError = console.error;
console.error = () => {};

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const serverOnlyMarker = require.resolve("server-only");
const serverOnlyEmpty = path.join(path.dirname(serverOnlyMarker), "empty.js");
require(serverOnlyEmpty);
require.cache[serverOnlyMarker] = require.cache[serverOnlyEmpty];

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "11111111-1111-4111-8111-222222222222";
const S1 = "22222222-2222-4222-8222-111111111111";
const TOKEN =
  "cursor15-pr-a-bot-internal-token-32chars-min";

assert.ok(TOKEN.length >= 32);
assert.ok(isCanonicalUuid(M1));
assert.ok(isCanonicalUuid(S1));

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

async function loadAuth() {
  return import("../src/lib/auth/bot-internal-auth");
}

async function loadEligibility() {
  return import("../src/lib/bot-api/evaluate-eligibility");
}

async function loadBooking() {
  return import("../src/services/BookingService");
}

function withTokenEnv<T>(token: string | undefined, run: () => T): T {
  const previous = process.env.BOT_INTERNAL_API_TOKEN;
  if (token === undefined) {
    delete process.env.BOT_INTERNAL_API_TOKEN;
  } else {
    process.env.BOT_INTERNAL_API_TOKEN = token;
  }
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.BOT_INTERNAL_API_TOKEN;
    } else {
      process.env.BOT_INTERNAL_API_TOKEN = previous;
    }
  }
}

function createEligibilityRuntime(options: {
  studioEnabled?: boolean;
  serviceOnline?: boolean;
  selectedMasterOnline?: boolean;
  selectedMasterActive?: boolean;
  selectedMasterPublic?: boolean;
  linkEnabled?: boolean;
  serviceExists?: boolean;
  masterExists?: boolean;
  timingOk?: boolean;
  onlineMasters?: Array<{ id: string; publicName: string }>;
} = {}): BookingPolicyRuntime & {
  listOnlineMastersForService: (
    serviceId: string,
  ) => Promise<Array<{ id: string; publicName: string; clientDescription: null; photoUrl: null; isOnlineBookingEnabled: boolean }>>;
  resolveBookingModes: (
    serviceIds: string[],
  ) => Promise<Map<string, { bookingMode: "ONLINE" | "MANAGER_ONLY"; managerMasterId: null; managerMasterName: null }>>;
} {
  const studioEnabled = options.studioEnabled ?? true;
  const serviceOnline = options.serviceOnline ?? true;
  const selectedMasterOnline = options.selectedMasterOnline ?? true;
  const selectedMasterActive = options.selectedMasterActive ?? true;
  const selectedMasterPublic = options.selectedMasterPublic ?? true;
  const linkEnabled = options.linkEnabled ?? true;
  const serviceExists = options.serviceExists ?? true;
  const masterExists = options.masterExists ?? true;
  const timingOk = options.timingOk ?? true;
  const onlineMasters = options.onlineMasters ?? [
    {
      id: M1,
      publicName: "Master One",
      clientDescription: null,
      photoUrl: null,
      isOnlineBookingEnabled: true,
    },
    {
      id: M2,
      publicName: "Master Two",
      clientDescription: null,
      photoUrl: null,
      isOnlineBookingEnabled: true,
    },
  ];

  const service = serviceExists
    ? {
        id: S1,
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
        category: { isActive: true, isPublic: true },
      }
    : null;

  const master = masterExists
    ? {
        id: M1,
        isActive: selectedMasterActive,
        isPublic: selectedMasterPublic,
        isOnlineBookingEnabled: selectedMasterOnline,
      }
    : null;

  const masterService =
    masterExists && linkEnabled
      ? {
          isEnabled: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
        }
      : masterExists
        ? {
            isEnabled: false,
            isPublic: true,
            isOnlineBookingEnabled: true,
          }
        : null;

  return {
    db: {
      service: {
        async findUnique() {
          return service;
        },
        async findMany() {
          return service ? [service] : [];
        },
      },
      master: {
        async findUnique() {
          return master;
        },
        async findMany() {
          return onlineMasters.map((entry) => ({
            ...entry,
            isOnlineBookingEnabled: true,
          }));
        },
      },
      masterService: {
        async findUnique() {
          return masterService;
        },
        async findMany() {
          return [];
        },
      },
    } as never,
    async resolveTiming() {
      if (!timingOk) {
        return null;
      }
      return {
        durationMinutes: 60,
        breakAfterMinutes: 0,
        totalBusyMinutes: 60,
        source: "service" as const,
      };
    },
    async isStudioOnlineBookingEnabled() {
      return studioEnabled;
    },
    async listOnlineMastersForService() {
      return serviceOnline ? onlineMasters : [];
    },
    async resolveBookingModes(serviceIds: string[]) {
      const map = new Map();
      for (const id of serviceIds) {
        map.set(id, {
          bookingMode: serviceOnline ? "ONLINE" : "MANAGER_ONLY",
          managerMasterId: null,
          managerMasterName: null,
        });
      }
      return map;
    },
  };
}

async function testAuthHelpers(): Promise<void> {
  const auth = await loadAuth();

  withTokenEnv(undefined, () => {
    assert.equal(auth.getBotInternalApiToken(), null);
    assert.equal(auth.isValidBotInternalBearerToken(TOKEN), false);
  });

  withTokenEnv("short", () => {
    assert.equal(auth.getBotInternalApiToken(), null);
  });

  withTokenEnv(TOKEN, () => {
    assert.equal(auth.getBotInternalApiToken(), TOKEN);
    assert.equal(auth.isValidBotInternalBearerToken(TOKEN), true);
    assert.equal(auth.isValidBotInternalBearerToken(`${TOKEN}x`), false);
    assert.equal(auth.isValidBotInternalBearerToken("wrong-token-also-long-enough-xxxxxx"), false);
  });

  assert.equal(auth.parseBearerAuthorizationHeader(null), null);
  assert.equal(auth.parseBearerAuthorizationHeader(""), null);
  assert.equal(auth.parseBearerAuthorizationHeader("Basic abc"), null);
  assert.equal(auth.parseBearerAuthorizationHeader("Bearer"), null);
  assert.equal(auth.parseBearerAuthorizationHeader("Bearer "), null);
  assert.equal(auth.parseBearerAuthorizationHeader("Bearer a b"), null);
  assert.equal(
    auth.parseBearerAuthorizationHeader(`Bearer ${TOKEN}`),
    TOKEN,
  );
  assert.equal(
    auth.parseBearerAuthorizationHeader(`bearer ${TOKEN}`),
    TOKEN,
  );

  await withTokenEnv(TOKEN, async () => {
    const ok = auth.enforceBotInternalAuth(
      new Request("http://localhost/api/internal/bot/v1/eligibility", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    );
    assert.equal(ok, null);

    for (const headers of [
      {},
      { Authorization: "Bearer wrong-token-also-long-enough-xxxxxx" },
      { Authorization: "Basic xyz" },
      { Authorization: "Bearer" },
    ] as Record<string, string>[]) {
      const response = auth.enforceBotInternalAuth(
        new Request("http://localhost/api/internal/bot/v1/eligibility", {
          method: "POST",
          headers,
        }),
      );
      assert.ok(response);
      assert.equal(response.status, 401);
      const body = await response.json();
      assert.deepEqual(body, {
        ok: false,
        code: "UNAUTHORIZED",
        error: "Unauthorized",
      });
    }
  });

  await withTokenEnv(undefined, async () => {
    const response = auth.enforceBotInternalAuth(
      new Request("http://localhost/api/internal/bot/v1/eligibility", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    );
    assert.ok(response);
    assert.equal(response.status, 401);
  });
}

async function testEligibility(): Promise<void> {
  const { evaluateBotEligibility, parseBotEligibilityBody } =
    await loadEligibility();

  assert.equal(parseBotEligibilityBody(null).ok, false);
  assert.equal(parseBotEligibilityBody({ serviceId: "bad" }).ok, false);
  assert.equal(
    parseBotEligibilityBody({ serviceId: S1, extra: true }).ok,
    false,
  );
  const parsed = parseBotEligibilityBody({
    serviceId: S1,
    masterId: M1,
    includeAlternatives: true,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.serviceId, S1);
    assert.equal(parsed.value.masterId, M1);
    assert.equal(parsed.value.includeAlternatives, true);
  }

  const allowed = await evaluateBotEligibility(
    { serviceId: S1, masterId: M1, includeAlternatives: true },
    createEligibilityRuntime(),
  );
  assert.equal(allowed.outcome, "SELF_BOOKING_ALLOWED");
  assert.equal(allowed.reasonCode, null);
  assert.equal(allowed.selectedPairAllowed, true);
  assert.equal(allowed.serviceOnlineInGeneral, true);
  assert.equal(allowed.otherOnlineMasterCount, 1);
  assert.deepEqual(allowed.otherOnlineMasters, [
    { id: M2, publicName: "Master Two" },
  ]);

  const studioOff = await evaluateBotEligibility(
    { serviceId: S1, masterId: M1 },
    createEligibilityRuntime({ studioEnabled: false }),
  );
  assert.equal(studioOff.outcome, "MANAGER_HANDOFF");
  assert.equal(studioOff.reasonCode, "STUDIO_ONLINE_DISABLED");
  assert.equal(studioOff.selectedPairAllowed, false);
  assert.equal(studioOff.serviceOnlineInGeneral, false);
  assert.equal(studioOff.otherOnlineMasters, undefined);

  const masterClosed = await evaluateBotEligibility(
    { serviceId: S1, masterId: M1, includeAlternatives: true },
    createEligibilityRuntime({
      selectedMasterOnline: false,
      onlineMasters: [
        {
          id: M2,
          publicName: "Master Two",
          clientDescription: null,
          photoUrl: null,
          isOnlineBookingEnabled: true,
        },
      ],
    }),
  );
  assert.equal(masterClosed.outcome, "MANAGER_HANDOFF");
  assert.equal(masterClosed.reasonCode, "ONLINE_DISABLED");
  assert.equal(masterClosed.selectedPairAllowed, false);
  assert.equal(masterClosed.serviceOnlineInGeneral, true);
  assert.equal(masterClosed.otherOnlineMasterCount, 1);
  assert.deepEqual(masterClosed.otherOnlineMasters, [
    { id: M2, publicName: "Master Two" },
  ]);

  const managerOnly = await evaluateBotEligibility(
    { serviceId: S1, masterId: M1 },
    createEligibilityRuntime({
      serviceOnline: false,
      selectedMasterOnline: false,
      onlineMasters: [],
    }),
  );
  assert.equal(managerOnly.outcome, "MANAGER_HANDOFF");
  assert.equal(managerOnly.reasonCode, "MANAGER_ONLY");
  assert.equal(managerOnly.selectedPairAllowed, false);

  const serviceOnly = await evaluateBotEligibility(
    { serviceId: S1, includeAlternatives: true },
    createEligibilityRuntime(),
  );
  assert.equal(serviceOnly.outcome, "SELF_BOOKING_ALLOWED");
  assert.equal(serviceOnly.selectedPairAllowed, false);
  assert.equal(serviceOnly.otherOnlineMasterCount, 2);

  const inactiveMaster = await evaluateBotEligibility(
    { serviceId: S1, masterId: M1 },
    createEligibilityRuntime({ selectedMasterActive: false }),
  );
  assert.equal(inactiveMaster.reasonCode, "MASTER_INACTIVE");

  const linkDown = await evaluateBotEligibility(
    { serviceId: S1, masterId: M1 },
    createEligibilityRuntime({ linkEnabled: false }),
  );
  assert.equal(linkDown.reasonCode, "MASTER_SERVICE_UNAVAILABLE");
}

async function testStudioKillSwitch(): Promise<void> {
  const booking = await loadBooking();
  const runtime = createEligibilityRuntime({ studioEnabled: false });
  await assert.rejects(
    () => booking.assertOnlineBookable(M1, S1, runtime),
    (error: unknown) =>
      error instanceof Error && error.name === "SERVICE_UNAVAILABLE",
  );

  const enabled = createEligibilityRuntime({ studioEnabled: true });
  const timing = await booking.assertOnlineBookable(M1, S1, enabled);
  assert.equal(timing.durationMinutes, 60);
}

function testStaticContracts(): void {
  const authSource = read("src/lib/auth/bot-internal-auth.ts");
  assert.match(authSource, /timingSafeEqual/);
  assert.match(authSource, /BOT_INTERNAL_API_TOKEN/);
  assert.doesNotMatch(authSource, /cursor15-pr-a-bot-internal-token/);

  const routeSource = read(
    "src/app/api/internal/bot/v1/eligibility/route.ts",
  );
  assert.match(routeSource, /enforceBotInternalAuth/);
  assert.match(routeSource, /evaluateBotEligibility/);
  assert.doesNotMatch(routeSource, /enforceSameOriginForMutatingRequest/);
  assert.doesNotMatch(routeSource, /requireProtectedMutatingApi/);

  const bookingSource = read("src/services/BookingService.ts");
  assert.match(bookingSource, /assertStudioOnlineBookingEnabled/);
  assert.match(
    bookingSource,
    /export async function assertOnlineBookable[\s\S]*await assertStudioOnlineBookingEnabled/,
  );

  const envExample = read(".env.example");
  assert.match(envExample, /^BOT_INTERNAL_API_TOKEN=$/m);
  assert.doesNotMatch(envExample, /BOT_INTERNAL_API_TOKEN=.+/);

  assert.equal(
    requiresAdminCsrfProtection("/api/internal/bot/v1/eligibility", "POST"),
    false,
  );
  assert.equal(
    requiresAdminCsrfProtection("/api/admin/settings", "POST"),
    true,
  );
  assert.equal(
    resolveApiRateLimitPolicy("/api/internal/bot/v1/eligibility", "POST"),
    "botInternal",
  );

  // Public create still CSRF-guarded at route level (regression).
  const createRoute = read("src/app/api/booking/create/route.ts");
  assert.match(createRoute, /enforceSameOriginForMutatingRequest/);
  assert.match(createRoute, /createOnlineBooking/);

  const docs = read("docs/architecture/bot-internal-api-pr-a.md");
  assert.match(docs, /BOT_INTERNAL_API_TOKEN/);
  assert.match(docs, /SELF_BOOKING_ALLOWED/);
  assert.match(docs, /STUDIO_ONLINE_DISABLED/);
}

async function main(): Promise<void> {
  testStaticContracts();
  await testAuthHelpers();
  await testEligibility();
  await testStudioKillSwitch();
  console.log("security-bot-internal-api-pr-a-check: OK");
}

main()
  .catch((error) => {
    console.error = originalConsoleError;
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    console.error = originalConsoleError;
  });
