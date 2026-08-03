/**
 * CURSOR-15 PR A — bot internal auth, eligibility, studio kill-switch,
 * CSRF exemption, and public regression (no DB).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
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

  withTokenEnv(`  ${TOKEN}  `, () => {
    assert.equal(auth.getBotInternalApiToken(), TOKEN);
  });

  withTokenEnv(TOKEN, () => {
    assert.equal(auth.getBotInternalApiToken(), TOKEN);
    assert.equal(auth.isValidBotInternalBearerToken(TOKEN), true);
    assert.equal(auth.isValidBotInternalBearerToken(`${TOKEN}x`), false);
    assert.equal(
      auth.isValidBotInternalBearerToken("wrong-token-also-long-enough-xxxxxx"),
      false,
    );
    // Same-length wrong token must fail (mutation: plain === would still fail, but
    // length-mismatch path must not throw / grant access).
    const sameLenWrong = "x".repeat(TOKEN.length);
    assert.equal(auth.isValidBotInternalBearerToken(sameLenWrong), false);
  });

  assert.equal(auth.parseBearerAuthorizationHeader(null), null);
  assert.equal(auth.parseBearerAuthorizationHeader(""), null);
  assert.equal(auth.parseBearerAuthorizationHeader("Basic abc"), null);
  assert.equal(auth.parseBearerAuthorizationHeader("Bearer"), null);
  assert.equal(auth.parseBearerAuthorizationHeader("Bearer "), null);
  assert.equal(auth.parseBearerAuthorizationHeader("Bearer a b"), null);
  assert.equal(auth.parseBearerAuthorizationHeader(`Bearer ${TOKEN}, Bearer other`), null);
  assert.equal(auth.parseBearerAuthorizationHeader(`Bearer\t${TOKEN}`), null);
  assert.equal(
    auth.parseBearerAuthorizationHeader(`Bearer ${TOKEN}`),
    TOKEN,
  );
  assert.equal(
    auth.parseBearerAuthorizationHeader(`bearer ${TOKEN}`),
    TOKEN,
  );
  assert.equal(
    auth.parseBearerAuthorizationHeader(`  Bearer   ${TOKEN}  `),
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

    // Query string must never authenticate.
    const queryAttempt = auth.enforceBotInternalAuth(
      new Request(
        `http://localhost/api/internal/bot/v1/eligibility?token=${TOKEN}`,
        { method: "POST" },
      ),
    );
    assert.ok(queryAttempt);
    assert.equal(queryAttempt.status, 401);

    for (const headers of [
      {},
      { Authorization: "Bearer wrong-token-also-long-enough-xxxxxx" },
      { Authorization: `Bearer ${"x".repeat(TOKEN.length)}` },
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
      assert.equal(JSON.stringify(body).includes(TOKEN), false);
    }

    // Zero-width / unicode junk in token is rejected by parser (cannot place in Headers ByteString).
    assert.equal(
      auth.parseBearerAuthorizationHeader(`Bearer ${TOKEN}\u200b`),
      null,
    );
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
  assert.equal(parseBotEligibilityBody({ serviceId: S1, masterId: null }).ok, false);
  assert.equal(
    parseBotEligibilityBody({ serviceId: S1, includeAlternatives: null }).ok,
    false,
  );
  assert.equal(
    parseBotEligibilityBody({ serviceId: S1, includeAlternatives: 1 }).ok,
    false,
  );
  assert.equal(
    parseBotEligibilityBody({ serviceId: S1, masterId: 123 }).ok,
    false,
  );
  assert.equal(
    parseBotEligibilityBody({ serviceId: [S1] }).ok,
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

  // Closed selected master must NOT become allowed because an alternative exists.
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
  // No automatic replacement field / selected master stays M1 semantics.
  assert.equal(
    masterClosed.otherOnlineMasters?.some((m) => m.id === M1),
    false,
  );

  const studioOff = await evaluateBotEligibility(
    { serviceId: S1, masterId: M1 },
    createEligibilityRuntime({ studioEnabled: false }),
  );
  assert.equal(studioOff.outcome, "MANAGER_HANDOFF");
  assert.equal(studioOff.reasonCode, "STUDIO_ONLINE_DISABLED");
  assert.equal(studioOff.selectedPairAllowed, false);
  assert.equal(studioOff.serviceOnlineInGeneral, false);
  assert.equal(studioOff.otherOnlineMasters, undefined);

  const studioOffNoMaster = await evaluateBotEligibility(
    { serviceId: S1 },
    createEligibilityRuntime({ studioEnabled: false }),
  );
  assert.equal(studioOffNoMaster.selectedPairAllowed, null);

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
  assert.equal(serviceOnly.selectedPairAllowed, null);
  assert.equal(serviceOnly.otherOnlineMasterCount, 2);

  const withoutAlternatives = await evaluateBotEligibility(
    { serviceId: S1, masterId: M1, includeAlternatives: false },
    createEligibilityRuntime(),
  );
  assert.equal(withoutAlternatives.otherOnlineMasterCount, 1);
  assert.equal(withoutAlternatives.otherOnlineMasters, undefined);

  const inactiveMaster = await evaluateBotEligibility(
    { serviceId: S1, masterId: M1 },
    createEligibilityRuntime({ selectedMasterActive: false }),
  );
  assert.equal(inactiveMaster.reasonCode, "MASTER_INACTIVE");

  const missingMaster = await evaluateBotEligibility(
    { serviceId: S1, masterId: M1 },
    createEligibilityRuntime({ masterExists: false }),
  );
  assert.equal(missingMaster.reasonCode, "MASTER_INACTIVE");

  const missingService = await evaluateBotEligibility(
    { serviceId: S1, masterId: M1 },
    createEligibilityRuntime({ serviceExists: false, serviceOnline: false }),
  );
  assert.equal(missingService.reasonCode, "SERVICE_INACTIVE");
  assert.equal(missingService.outcome, "MANAGER_HANDOFF");

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

  // Missing settings default contract: ensureStudioSettings / DEFAULT true.
  const defaults = read("src/lib/studio-settings/defaults.ts");
  assert.match(defaults, /isOnlineBookingEnabled:\s*true/);
  const studioService = read("src/services/StudioSettingsService.ts");
  assert.match(studioService, /ensureStudioSettings/);
  assert.match(studioService, /DEFAULT_STUDIO_SETTINGS/);
}

async function testMonthStudioMemoizationStatic(): Promise<void> {
  const bookingSource = read("src/services/BookingService.ts");
  assert.match(
    bookingSource,
    /export async function getAvailableDaysInMonth[\s\S]*await assertStudioOnlineBookingEnabled/,
  );
  assert.match(
    bookingSource,
    /getAvailableDaysInMonth[\s\S]*isStudioOnlineBookingEnabled:\s*async \(\) => true/,
  );
  assert.match(
    bookingSource,
    /getAvailableTimeSlots[\s\S]*options\.bookingPolicyRuntime/,
  );
}

function createModesRuntime(options: {
  onlineMaster?: boolean;
  studioEnabled?: boolean;
} = {}): BookingPolicyRuntime {
  const onlineMaster = options.onlineMaster ?? true;
  const studioEnabled = options.studioEnabled ?? true;
  const service = {
    id: S1,
    publicName: "Service One",
    clientDescription: null as string | null,
    durationMinutes: 60,
    breakAfterMinutes: 0,
    priceFrom: null,
    priceTo: null,
    isActive: true,
    isPublic: true,
    isOnlineBookingEnabled: true,
    category: { isActive: true, isPublic: true, name: "Cat" },
  };
  const master = {
    id: M1,
    publicName: "Master One",
    isActive: true,
    isPublic: true,
    isOnlineBookingEnabled: onlineMaster,
    sortOrder: 1,
  };
  return {
    db: {
      service: {
        async findUnique() {
          return service;
        },
        async findMany() {
          return [service];
        },
      },
      master: {
        async findUnique() {
          return master;
        },
        async findMany() {
          return [master];
        },
      },
      masterService: {
        async findUnique() {
          return {
            isEnabled: true,
            isPublic: true,
            isOnlineBookingEnabled: true,
            masterId: M1,
            serviceId: S1,
            master,
          };
        },
        async findMany() {
          return [
            {
              serviceId: S1,
              masterId: M1,
              isEnabled: true,
              isPublic: true,
              isOnlineBookingEnabled: true,
              master,
              service,
            },
          ];
        },
      },
    } as never,
    async resolveTiming() {
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
  };
}

async function testCatalogStudioProjection(): Promise<void> {
  const booking = await loadBooking();
  const runtime = createModesRuntime({ onlineMaster: true });

  const online = await booking.resolveServiceBookingModes([S1], runtime, {
    selfBookingEnabled: true,
  });
  assert.equal(online.get(S1)?.bookingMode, "ONLINE");
  assert.equal(online.get(S1)?.managerMasterId, null);

  const projected = await booking.resolveServiceBookingModes([S1], runtime, {
    selfBookingEnabled: false,
  });
  assert.equal(projected.get(S1)?.bookingMode, "MANAGER_ONLY");
  assert.equal(projected.get(S1)?.managerMasterId, M1);
  assert.equal(projected.get(S1)?.managerMasterName, "Master One");

  const alreadyManager = await booking.resolveServiceBookingModes(
    [S1],
    createModesRuntime({ onlineMaster: false }),
    { selfBookingEnabled: false },
  );
  assert.equal(alreadyManager.get(S1)?.bookingMode, "MANAGER_ONLY");
  assert.equal(alreadyManager.get(S1)?.managerMasterId, M1);
}

async function testByMasterStudioProjection(): Promise<void> {
  const booking = await loadBooking();

  const online = await booking.listServicesForMaster(
    M1,
    createModesRuntime({ studioEnabled: true }),
  );
  assert.equal(online.length, 1);
  assert.equal(online[0]?.bookingMode, "ONLINE");
  assert.equal(online[0]?.managerMasterId, null);
  assert.equal(online[0]?.managerMasterName, null);
  assert.doesNotMatch(JSON.stringify(online[0]), /STUDIO_ONLINE_DISABLED|reasonCode/);

  const studioOff = await booking.listServicesForMaster(
    M1,
    createModesRuntime({ studioEnabled: false }),
  );
  assert.equal(studioOff.length, 1);
  assert.equal(studioOff[0]?.id, S1);
  assert.equal(studioOff[0]?.bookingMode, "MANAGER_ONLY");
  assert.equal(studioOff[0]?.managerMasterId, M1);
  assert.equal(studioOff[0]?.managerMasterName, "Master One");
  assert.doesNotMatch(
    JSON.stringify(studioOff[0]),
    /STUDIO_ONLINE_DISABLED|reasonCode/,
  );

  // Missing settings row uses existing helper default enabled=true via DI.
  const legacyDefault = await booking.listServicesForMaster(
    M1,
    createModesRuntime({ studioEnabled: true }),
  );
  assert.equal(legacyDefault[0]?.bookingMode, "ONLINE");

  const bookingSource = read("src/services/BookingService.ts");
  assert.match(
    bookingSource,
    /export async function listServicesForMaster[\s\S]*isStudioOnlineBookingEnabled/,
  );
  assert.match(
    bookingSource,
    /listServicesForMaster[\s\S]*bookingMode[\s\S]*MANAGER_ONLY/,
  );
  assert.doesNotMatch(
    bookingSource,
    /listServicesForMaster[\s\S]*bookingMode:\s*"ONLINE",\s*\n\s*managerMasterId:\s*null/,
  );
}

async function testBoundedJsonBody(): Promise<void> {
  const { readBoundedJsonBody, BOT_INTERNAL_MAX_JSON_BODY_BYTES } = await import(
    "../src/lib/bot-api/bounded-json-body"
  );
  assert.equal(BOT_INTERNAL_MAX_JSON_BODY_BYTES, 4096);

  function streamRequest(
    bytes: Uint8Array,
    headers: Record<string, string> = {},
  ): Request {
    return new Request("http://localhost/api/internal/bot/v1/eligibility", {
      method: "POST",
      headers,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      // @ts-expect-error undici duplex for streaming body
      duplex: "half",
    });
  }

  const small = new TextEncoder().encode(JSON.stringify({ serviceId: S1 }));
  const ok = await readBoundedJsonBody(streamRequest(small));
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.value, { serviceId: S1 });
  }

  const oversized = new Uint8Array(BOT_INTERNAL_MAX_JSON_BODY_BYTES + 1);
  oversized.fill(0x61);
  const tooBig = await readBoundedJsonBody(streamRequest(oversized));
  assert.equal(tooBig.ok, false);
  if (!tooBig.ok) {
    assert.equal(tooBig.code, "PAYLOAD_TOO_LARGE");
  }

  const declaredTooBig = await readBoundedJsonBody(
    streamRequest(small, {
      "content-length": String(BOT_INTERNAL_MAX_JSON_BODY_BYTES + 10),
    }),
  );
  assert.equal(declaredTooBig.ok, false);
  if (!declaredTooBig.ok) {
    assert.equal(declaredTooBig.code, "PAYLOAD_TOO_LARGE");
  }

  const falseCl = await readBoundedJsonBody(
    streamRequest(oversized, { "content-length": "16" }),
  );
  assert.equal(falseCl.ok, false);
  if (!falseCl.ok) {
    assert.equal(falseCl.code, "PAYLOAD_TOO_LARGE");
  }

  const multibyte = new TextEncoder().encode(`{"x":"${"©".repeat(2100)}"}`);
  assert.ok(multibyte.byteLength > BOT_INTERNAL_MAX_JSON_BODY_BYTES);
  const multi = await readBoundedJsonBody(streamRequest(multibyte));
  assert.equal(multi.ok, false);

  const empty = await readBoundedJsonBody(streamRequest(new Uint8Array(0)));
  assert.equal(empty.ok, false);

  const badJson = await readBoundedJsonBody(
    streamRequest(new TextEncoder().encode("{not-json")),
  );
  assert.equal(badJson.ok, false);
  if (!badJson.ok) {
    assert.equal(badJson.code, "INVALID_JSON");
  }

  const auth = await loadAuth();
  await withTokenEnv(undefined, async () => {
    const response = auth.enforceBotInternalAuth(
      new Request("http://localhost/api/internal/bot/v1/eligibility", {
        method: "POST",
        headers: { "content-length": "999999" },
      }),
    );
    assert.ok(response);
    assert.equal(response.status, 401);
  });
}

async function testNamespaceGuardCoverageAsync(): Promise<void> {
  const coverage = await import("./security-bot-internal-route-coverage-check");
  const routes = coverage.assertBotInternalRouteCoverage();
  assert.ok(routes.length >= 1);
  assert.ok(
    routes.some((route) =>
      route.replace(/\\/g, "/").endsWith("eligibility/route.ts"),
    ),
  );

  const approvedImport =
    'import { withBotInternalApi } from "@/lib/auth/bot-internal-api";\n';

  assert.doesNotThrow(() =>
    coverage.assertRouteSourceUsesBotInternalApi(
      `${approvedImport}export const POST = withBotInternalApi(async () => null);\n`,
    ),
  );

  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(
      `${approvedImport}export const POST = async () => null;\n`,
    ),
  );

  // Line-comment spoof with full export text + raw handler
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
// export const POST = withBotInternalApi(
export const POST = async () => null;
`),
  );

  // Block-comment spoof
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
/*
export const POST = withBotInternalApi(
*/
export const POST = async () => null;
`),
  );

  // String literal spoof
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
const decoy = "export const POST = withBotInternalApi(";
export const POST = async () => null;
`),
  );

  // Template literal spoof
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
const decoy = \`export const POST = withBotInternalApi(\`;
export const POST = async () => null;
`),
  );

  // Dead import, raw POST
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
export const POST = async () => null;
`),
  );

  // Dead call in helper, raw exported POST
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
function helper() {
  return withBotInternalApi(async () => null);
}
export const POST = async () => null;
`),
  );

  // Wrapper around non-exported handler; raw exported POST
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
const inner = withBotInternalApi(async () => null);
export const POST = async () => null;
`),
  );

  // Exported GET without wrapper
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
export const POST = withBotInternalApi(async () => null);
export const GET = async () => null;
`),
  );

  // Multi-method: one wrapped, one raw
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
export const POST = withBotInternalApi(async () => null);
export async function DELETE() { return null; }
`),
  );

  // Alias import rejected
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
import { withBotInternalApi as wrap } from "@/lib/auth/bot-internal-api";
export const POST = wrap(async () => null);
`),
  );

  // Fake suffix path (@/evil/.../bot-internal-api)
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
import { withBotInternalApi } from "@/evil/lib/auth/bot-internal-api";
export const POST = withBotInternalApi(async () => null);
`),
  );

  // Similar fake path
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
import { withBotInternalApi } from "@/lib/auth/bot-internal-api-fake";
export const POST = withBotInternalApi(async () => null);
`),
  );

  // Relative suffix path
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
import { withBotInternalApi } from "../../../../lib/auth/bot-internal-api";
export const POST = withBotInternalApi(async () => null);
`),
  );

  // src/ absolute-style path (not the approved alias)
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
import { withBotInternalApi } from "src/lib/auth/bot-internal-api";
export const POST = withBotInternalApi(async () => null);
`),
  );

  // Trailing slash
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
import { withBotInternalApi } from "@/lib/auth/bot-internal-api/";
export const POST = withBotInternalApi(async () => null);
`),
  );

  // Case variation
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
import { withBotInternalApi } from "@/Lib/Auth/bot-internal-api";
export const POST = withBotInternalApi(async () => null);
`),
  );

  // Clause-level type-only import
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
import type { withBotInternalApi } from "@/lib/auth/bot-internal-api";
export const POST = withBotInternalApi(async () => null);
`),
  );

  // Specifier-level type-only import
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
import { type withBotInternalApi } from "@/lib/auth/bot-internal-api";
export const POST = withBotInternalApi(async () => null);
`),
  );

  // Default import
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
import withBotInternalApi from "@/lib/auth/bot-internal-api";
export const POST = withBotInternalApi(async () => null);
`),
  );

  // Namespace import
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
import * as withBotInternalApi from "@/lib/auth/bot-internal-api";
export const POST = withBotInternalApi.withBotInternalApi(async () => null);
`),
  );

  // Local fake function with exact name (no import)
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
function withBotInternalApi(handler: unknown) { return handler; }
export const POST = withBotInternalApi(async () => null);
`),
  );

  // Approved import shadowed by local function
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
function withBotInternalApi(handler: unknown) { return handler; }
export const POST = withBotInternalApi(async () => null);
`),
  );

  // Approved import shadowed by local variable
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
const withBotInternalApi = (handler: unknown) => handler;
export const POST = withBotInternalApi(async () => null);
`),
  );

  // Duplicate approved + fake binding ambiguity
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
import { withBotInternalApi as other } from "@/evil/lib/auth/bot-internal-api";
export const POST = withBotInternalApi(async () => null);
`),
  );

  // Fake import alone with wrapped-looking POST
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
import { withBotInternalApi } from "@/evil/lib/auth/bot-internal-api";
export const POST = withBotInternalApi(async () => null);
`),
  );

  // Re-exported POST
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
const POST = async () => null;
export { POST };
`),
  );

  // Raw exported function POST
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
export async function POST() { return null; }
`),
  );

  // Empty exports
  assert.throws(() =>
    coverage.assertRouteSourceUsesBotInternalApi(`
${approvedImport}
const POST = withBotInternalApi(async () => null);
`),
  );

  // Empty namespace directory
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-v1-empty-"));
  try {
    assert.throws(() => coverage.assertBotInternalRouteCoverage(emptyDir));
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }

  // Windows path normalization for production route listing
  assert.ok(routes.every((route) => !route.includes("\\")));
}

function testStaticContracts(): void {
  const authSource = read("src/lib/auth/bot-internal-auth.ts");
  assert.match(authSource, /timingSafeEqual/);
  assert.match(authSource, /import "server-only"/);
  assert.match(authSource, /BOT_INTERNAL_API_TOKEN/);
  assert.doesNotMatch(authSource, /cursor15-pr-a-bot-internal-token/);
  assert.doesNotMatch(authSource, /searchParams|query/);

  const eligibilitySource = read("src/lib/bot-api/evaluate-eligibility.ts");
  assert.match(eligibilitySource, /import "server-only"/);
  assert.match(eligibilitySource, /isOnlinePublicBookable/);
  assert.doesNotMatch(eligibilitySource, /SERVICE_NOT_FOUND/);

  const routeSource = read(
    "src/app/api/internal/bot/v1/eligibility/route.ts",
  );
  assert.match(routeSource, /withBotInternalApi/);
  assert.match(routeSource, /export const POST = withBotInternalApi/);
  assert.match(routeSource, /readBoundedJsonBody/);
  assert.match(routeSource, /evaluateBotEligibility/);
  assert.doesNotMatch(routeSource, /enforceSameOriginForMutatingRequest/);
  assert.doesNotMatch(routeSource, /requireProtectedMutatingApi/);
  assert.doesNotMatch(routeSource, /console\.(log|info|debug|error)/);
  assert.match(routeSource, /safeLogError\("bot-internal-eligibility"/);
  assert.ok(
    routeSource.indexOf("withBotInternalApi") <
      routeSource.indexOf("readBoundedJsonBody"),
  );

  const bookingSource = read("src/services/BookingService.ts");
  assert.match(bookingSource, /assertStudioOnlineBookingEnabled/);
  assert.match(
    bookingSource,
    /export async function assertOnlineBookable[\s\S]*await assertStudioOnlineBookingEnabled/,
  );
  assert.match(
    bookingSource,
    /export async function createOnlineBooking[\s\S]*assertOnlineBookable/,
  );
  assert.match(
    bookingSource,
    /export async function getAvailableTimeSlots[\s\S]*assertOnlineBookable/,
  );
  assert.match(bookingSource, /selfBookingEnabled:\s*studioOnline/);
  assert.match(
    bookingSource,
    /export async function getBookingCatalog[\s\S]*isStudioOnlineBookingEnabled/,
  );

  const wizard = read("src/components/booking/booking-wizard.tsx");
  assert.match(
    wizard,
    /bookingMode\s*===\s*["']MANAGER_ONLY["'][\s\S]*openManagerOnlyServiceRequest/,
  );
  assert.match(
    wizard,
    /const selectServiceFromMaster[\s\S]*bookingMode\s*===\s*["']MANAGER_ONLY["'][\s\S]*openManagerOnlyServiceRequest/,
  );
  assert.match(
    wizard,
    /const selectServiceFromMaster[\s\S]*bookingMode\s*===\s*["']MANAGER_ONLY["'][\s\S]*return;[\s\S]*loadAvailableDays/,
  );
  assert.doesNotMatch(wizard, /STUDIO_ONLINE_DISABLED/);

  const requestRoute = read("src/app/api/booking/request/route.ts");
  assert.match(requestRoute, /enforceSameOriginForMutatingRequest/);
  assert.doesNotMatch(
    requestRoute,
    /enforceBotInternalAuth|BOT_INTERNAL_API_TOKEN/,
  );
  assert.doesNotMatch(requestRoute, /assertStudioOnlineBookingEnabled/);

  const csrfRules = read("src/lib/security/csrf-route-rules.ts");
  assert.match(csrfRules, /\/api\/internal\/bot\/v1\//);
  assert.doesNotMatch(
    csrfRules,
    /pathname\.startsWith\("\/api\/internal\/"\)/,
  );

  const envExample = read(".env.example");
  assert.match(envExample, /^BOT_INTERNAL_API_TOKEN=$/m);
  assert.doesNotMatch(envExample, /BOT_INTERNAL_API_TOKEN=.+/);

  assert.equal(
    requiresAdminCsrfProtection("/api/internal/bot/v1/eligibility", "POST"),
    false,
  );
  assert.equal(
    requiresAdminCsrfProtection("/api/internal/other/thing", "POST"),
    true,
  );
  assert.equal(
    requiresAdminCsrfProtection("/api/internal/bot/v10/eligibility", "POST"),
    true,
  );
  assert.equal(
    requiresAdminCsrfProtection("/api/admin/settings", "POST"),
    true,
  );
  assert.equal(
    requiresAdminCsrfProtection("/api/booking/create", "POST"),
    false,
  );
  assert.equal(
    resolveApiRateLimitPolicy("/api/internal/bot/v1/eligibility", "POST"),
    "botInternal",
  );
  assert.equal(
    resolveApiRateLimitPolicy("/api/booking/create", "POST"),
    "bookingCreate",
  );

  const rlIdentity = read("src/lib/security/rate-limit/client-identity.ts");
  assert.doesNotMatch(rlIdentity, /authorization|BOT_INTERNAL/i);

  const createRoute = read("src/app/api/booking/create/route.ts");
  assert.match(createRoute, /enforceSameOriginForMutatingRequest/);
  assert.match(createRoute, /createOnlineBooking/);
  assert.doesNotMatch(createRoute, /enforceBotInternalAuth/);

  assert.equal(fs.existsSync(path.join(ROOT, "prisma/schema.prisma")), true);
  const schemaDiffMarker = read("prisma/schema.prisma");
  assert.match(schemaDiffMarker, /enum AppointmentSource/);
  const appointment = read("src/services/AppointmentService.ts");
  assert.match(appointment, /source:\s*"ONLINE"|source:\s*'ONLINE'/);

  const wrapper = read("src/lib/auth/bot-internal-api.ts");
  assert.match(wrapper, /import "server-only"/);
  assert.match(wrapper, /enforceBotInternalAuth/);
  assert.match(wrapper, /enforceEndpointRateLimit/);
  assert.match(wrapper, /botInternal/);

  const docs = read("docs/architecture/bot-internal-api-pr-a.md");
  assert.match(docs, /BOT_INTERNAL_API_TOKEN/);
  assert.match(docs, /SELF_BOOKING_ALLOWED/);
  assert.match(docs, /STUDIO_ONLINE_DISABLED/);
  assert.match(docs, /\/api\/internal\/bot\/v1\//);
  assert.match(docs, /selectedPairAllowed/);
  assert.match(docs, /withBotInternalApi|MANAGER_ONLY/);
}

async function main(): Promise<void> {
  testStaticContracts();
  await testAuthHelpers();
  await testEligibility();
  await testStudioKillSwitch();
  await testMonthStudioMemoizationStatic();
  await testCatalogStudioProjection();
  await testByMasterStudioProjection();
  await testBoundedJsonBody();
  await testNamespaceGuardCoverageAsync();
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
