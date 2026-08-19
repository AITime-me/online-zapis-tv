/**
 * CURSOR-24 — bot internal confirmed booking create.
 * Contract, architecture, and security checks (no DB required for core suite).
 * Optional PostgreSQL race suite: RUN_BOT_BOOKING_CREATE_DB_TESTS=1
 */
process.env.SECURITY_BATCH_TEST = "1";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/tvoe_vremya_security_batch";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { isCanonicalUuid } from "../src/lib/booking-requests/idempotency-contract";
import { resolveApiRateLimitPolicy } from "../src/lib/security/rate-limit/route-rules";
import { requiresAdminCsrfProtection } from "../src/lib/security/csrf-route-rules";
import { installServerOnlyShimForSecurityScripts } from "./lib/stub-server-only";

const originalConsoleError = console.error;
console.error = () => {};

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
installServerOnlyShimForSecurityScripts();

const S1 = "22222222-2222-4222-8222-111111111111";
const M1 = "11111111-1111-4111-8111-111111111111";
const KEY = "550e8400-e29b-41d4-a716-446655440000";
const CLIENT_REF = "77777777-7777-4aaa-8bbb-cccccccccccc";
const TOKEN = "cursor24-bot-booking-create-token-32c!";

assert.ok(TOKEN.length >= 32);
assert.ok(isCanonicalUuid(S1));
assert.ok(isCanonicalUuid(M1));
assert.ok(isCanonicalUuid(KEY));
assert.ok(isCanonicalUuid(CLIENT_REF));

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const HMAC =
  "cursor24-bot-idempotency-hmac-secret-32b!!";
const HMAC_OLD =
  "cursor24-bot-idempotency-hmac-old-secret-32!";
const HMAC_NEW =
  "cursor24-bot-idempotency-hmac-new-secret-32!";

async function main(): Promise<void> {
  // Dedicated secret only — must NOT rely on AUTH_SECRET injection.
  delete process.env.AUTH_SECRET;
  delete process.env.NEXTAUTH_SECRET;
  delete process.env.BOT_INTERNAL_API_TOKEN;
  process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = HMAC;
  delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;

  await testSlotCodec();
  await testRequestParser();
  await testIdempotencyFingerprint();
  await testHmacConfigValidation();
  await testHmacRotation();
  await testSnapshotSanitizer();
  testStaticArchitecture();
  testRateLimitInventory();
  testRateLimitEnvelope();
  await testHttpRateLimitedEnvelope();
  testSingleInstanceTopologyGuard();
  testCiWiring();
  testCiWiringMutations();
  testTestDatabaseGuard();
  await testDbGuardBeforeConnectOrdering();
  testTestHooksProductionSafety();
  testCsrfExemption();
  await testContentTypeHelper();
  await testRouteCoverageIncludesBookings();
  await testPublicOnlineRegressionStatics();

  console.error = originalConsoleError;
  console.log("security-bot-internal-booking-create-check: OK");
}

async function testSlotCodec(): Promise<void> {
  const {
    buildBotSlotId,
    parseBotSlotId,
    BOT_SLOT_ID_PREFIX,
  } = await import("../src/lib/booking/bot-slot-id");

  assert.equal(BOT_SLOT_ID_PREFIX, "bs1");

  const id = buildBotSlotId({
    serviceId: S1,
    masterId: M1,
    dateKey: "2026-08-10",
    startTime: "09:00",
  });
  assert.equal(id, `bs1.${S1}.${M1}.2026-08-10.0900`);

  const parsed = parseBotSlotId(id);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.serviceId, S1);
    assert.equal(parsed.value.masterId, M1);
    assert.equal(parsed.value.dateKey, "2026-08-10");
    assert.equal(parsed.value.startTime, "09:00");
  }

  assert.equal(parseBotSlotId(`bs1.${S1}.${M1}.2026-08-10.0900`).ok, true);
  assert.equal(
    parseBotSlotId(
      `bs1.AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE.${M1}.2026-08-10.0900`,
    ).ok,
    false,
  ); // uppercase hex rejected
  assert.equal(parseBotSlotId(`bs2.${S1}.${M1}.2026-08-10.0900`).ok, false);
  assert.equal(parseBotSlotId(`bs1.${S1}.${M1}.2026-08-10.0900.extra`).ok, false);
  assert.equal(parseBotSlotId(` bs1.${S1}.${M1}.2026-08-10.0900`).ok, false);
  assert.equal(parseBotSlotId(`bs1.${S1}.${M1}.2026-02-30.0900`).ok, false);
  assert.equal(parseBotSlotId(`bs1.${S1}.${M1}.2026-08-10.2400`).ok, false);
  assert.equal(parseBotSlotId(`bs1.${S1}.${M1}.2026-08-10.0960`).ok, false);
  assert.equal(parseBotSlotId(null).ok, false);
  assert.equal(parseBotSlotId(123).ok, false);
}

async function testRequestParser(): Promise<void> {
  const { parseBotBookingCreateBody } = await import(
    "../src/lib/bot-api/booking-create-types"
  );
  const { buildBotSlotId } = await import("../src/lib/booking/bot-slot-id");
  const slotId = buildBotSlotId({
    serviceId: S1,
    masterId: M1,
    dateKey: "2026-08-10",
    startTime: "09:30",
  });

  const valid = parseBotBookingCreateBody({
    idempotencyKey: KEY,
    slotId,
    clientName: "Иван",
    phone: "+79123456789",
    personalDataConsent: true,
    offerAcknowledgement: true,
  });
  assert.equal(valid.ok, true);

  assert.equal(
    parseBotBookingCreateBody({
      idempotencyKey: KEY,
      slotId,
      clientName: "Иван",
      phone: "+79123456789",
      clientRef: CLIENT_REF,
      personalDataConsent: true,
      offerAcknowledgement: true,
    }).ok,
    true,
  );

  assert.equal(
    parseBotBookingCreateBody({
      idempotencyKey: KEY,
      slotId,
      clientName: "Иван",
      phone: "+79123456789",
      clientRef: "not-a-uuid",
      personalDataConsent: true,
      offerAcknowledgement: true,
    }).ok,
    false,
  );

  assert.equal(
    parseBotBookingCreateBody({
      idempotencyKey: KEY,
      slotId,
      clientName: "Иван",
      phone: "+79123456789",
      personalDataConsent: true,
      offerAcknowledgement: true,
      source: "BOT",
    }).ok,
    false,
  );

  assert.equal(
    parseBotBookingCreateBody({
      idempotencyKey: KEY,
      slotId,
      clientName: "Иван",
      phone: "+79123456789",
      personalDataConsent: true,
      offerAcknowledgement: true,
      serviceId: S1,
    }).ok,
    false,
  );

  assert.equal(
    parseBotBookingCreateBody({
      idempotencyKey: KEY,
      slotId,
      clientName: "Иван",
      phone: "+79123456789",
      personalDataConsent: true,
      offerAcknowledgement: true,
      startsAt: "2026-08-10T09:30:00+05:00",
    }).ok,
    false,
  );

  assert.equal(
    parseBotBookingCreateBody({
      idempotencyKey: KEY.toUpperCase(),
      slotId,
      clientName: "Иван",
      phone: "+79123456789",
      personalDataConsent: true,
      offerAcknowledgement: true,
    }).ok,
    false,
  );

  assert.equal(
    parseBotBookingCreateBody({
      idempotencyKey: KEY,
      slotId,
      clientName: " ",
      phone: "+79123456789",
      personalDataConsent: true,
      offerAcknowledgement: true,
    }).ok,
    false,
  );

  assert.equal(
    parseBotBookingCreateBody({
      idempotencyKey: KEY,
      slotId,
      clientName: "Иван",
      phone: "89123456789",
      personalDataConsent: true,
      offerAcknowledgement: true,
    }).ok,
    false,
  );

  assert.equal(
    parseBotBookingCreateBody({
      idempotencyKey: KEY,
      slotId,
      clientName: "Иван",
      phone: "+79123456789",
      personalDataConsent: false,
      offerAcknowledgement: true,
    }).ok,
    false,
  );

  const bad = parseBotBookingCreateBody({
    idempotencyKey: KEY,
    slotId,
    clientName: "SecretName",
    phone: "+79123456789",
    personalDataConsent: "yes",
    offerAcknowledgement: true,
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.doesNotMatch(bad.error, /SecretName|\+7912|7912/);
  }
}

async function testIdempotencyFingerprint(): Promise<void> {
  process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = HMAC;
  delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;

  const {
    computeBotBookingRequestFingerprint,
    botBookingFingerprintsEqual,
  } = await import("../src/lib/bot-api/booking-create-idempotency");
  const { buildBotSlotId } = await import("../src/lib/booking/bot-slot-id");
  const slotId = buildBotSlotId({
    serviceId: S1,
    masterId: M1,
    dateKey: "2026-08-10",
    startTime: "10:00",
  });

  const base = {
    slotId,
    clientName: "Анна",
    phone: "+79001112233",
    personalDataConsent: true,
    offerAcknowledgement: true,
  };

  const a = computeBotBookingRequestFingerprint(base);
  const b = computeBotBookingRequestFingerprint({
    ...base,
    phone: "+7 (900) 111-22-33",
  });
  assert.equal(botBookingFingerprintsEqual(a, b), true);
  assert.equal(a.length, 64);
  assert.doesNotMatch(a, /Анна|9001112233|\+7/);

  const changedName = computeBotBookingRequestFingerprint({
    ...base,
    clientName: "Мария",
  });
  assert.equal(botBookingFingerprintsEqual(a, changedName), false);

  // clientRef must affect fingerprint, and must be canonicalized to lowercase.
  const withClientRefLower = computeBotBookingRequestFingerprint({
    ...base,
    clientRef: CLIENT_REF,
  } as any);
  const withClientRefUpper = computeBotBookingRequestFingerprint({
    ...base,
    clientRef: CLIENT_REF.toUpperCase(),
  } as any);
  assert.equal(
    botBookingFingerprintsEqual(withClientRefLower, withClientRefUpper),
    true,
  );
  assert.equal(
    botBookingFingerprintsEqual(a, withClientRefLower),
    false,
  );

  // Legacy byte-for-byte compatibility: adding clientRef: undefined
  // must not change the canonical payload.
  const legacyWithUndefined = computeBotBookingRequestFingerprint({
    ...base,
    clientRef: undefined,
  } as any);
  assert.equal(botBookingFingerprintsEqual(a, legacyWithUndefined), true);

  const changedSlot = computeBotBookingRequestFingerprint({
    ...base,
    slotId: buildBotSlotId({
      serviceId: S1,
      masterId: M1,
      dateKey: "2026-08-10",
      startTime: "11:00",
    }),
  });
  assert.equal(botBookingFingerprintsEqual(a, changedSlot), false);

  // Keyed HMAC — not plain sha256 of JSON
  const plain = createHmac("sha256", "wrong").update("x").digest("hex");
  assert.notEqual(a, plain);

  // Must not use AUTH_SECRET when dedicated secret is set
  process.env.AUTH_SECRET = "auth-secret-must-not-affect-fingerprint!!!!";
  const withAuth = computeBotBookingRequestFingerprint(base);
  assert.equal(botBookingFingerprintsEqual(a, withAuth), true);
  delete process.env.AUTH_SECRET;
}

async function testHmacConfigValidation(): Promise<void> {
  const {
    resolveBotIdempotencyHmacConfig,
    BotIdempotencyHmacConfigError,
  } = await import("../src/lib/bot-api/booking-create-idempotency-hmac");
  const { computeBotBookingRequestFingerprint } = await import(
    "../src/lib/bot-api/booking-create-idempotency"
  );
  const { createBotConfirmedBooking } = await import(
    "../src/services/BotBookingCreateService"
  );
  const { buildBotSlotId } = await import("../src/lib/booking/bot-slot-id");

  const slotId = buildBotSlotId({
    serviceId: S1,
    masterId: M1,
    dateKey: "2026-08-10",
    startTime: "10:00",
  });
  const req = {
    idempotencyKey: KEY,
    slotId,
    clientName: "Test",
    phone: "+79001112233",
    personalDataConsent: true,
    offerAcknowledgement: true,
  };

  function withEnv(
    env: Record<string, string | undefined>,
    fn: () => void,
  ): void {
    const prev = {
      current: process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET,
      previous: process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS,
      nodeEnv: process.env.NODE_ENV,
    };
    try {
      if (env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET === undefined) {
        delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET;
      } else {
        process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET =
          env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET;
      }
      if (env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS === undefined) {
        delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;
      } else {
        process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS =
          env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;
      }
      if (env.NODE_ENV !== undefined) {
        process.env.NODE_ENV = env.NODE_ENV;
      }
      fn();
    } finally {
      if (prev.current === undefined) {
        delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET;
      } else {
        process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = prev.current;
      }
      if (prev.previous === undefined) {
        delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;
      } else {
        process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS =
          prev.previous;
      }
      if (prev.nodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prev.nodeEnv;
      }
    }
  }

  withEnv({ BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET: undefined }, () => {
    assert.throws(
      () => resolveBotIdempotencyHmacConfig(process.env),
      BotIdempotencyHmacConfigError,
    );
  });

  withEnv(
    {
      BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET: undefined,
      NODE_ENV: "production",
    },
    () => {
      assert.throws(
        () => computeBotBookingRequestFingerprint({
          slotId,
          clientName: "x",
          phone: "+79001112233",
          personalDataConsent: true,
          offerAcknowledgement: true,
        }),
        BotIdempotencyHmacConfigError,
      );
    },
  );

  withEnv(
    {
      BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET: undefined,
      NODE_ENV: "development",
    },
    () => {
      assert.throws(
        () => resolveBotIdempotencyHmacConfig(process.env),
        BotIdempotencyHmacConfigError,
      );
    },
  );

  withEnv(
    { BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET: "short" },
    () => {
      assert.throws(
        () => resolveBotIdempotencyHmacConfig(process.env),
        BotIdempotencyHmacConfigError,
      );
    },
  );

  withEnv(
    { BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET: "   " },
    () => {
      assert.throws(
        () => resolveBotIdempotencyHmacConfig(process.env),
        BotIdempotencyHmacConfigError,
      );
    },
  );

  withEnv(
    {
      BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET: HMAC,
      BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS: `${HMAC_OLD},${HMAC_OLD}`,
    },
    () => {
      assert.throws(
        () => resolveBotIdempotencyHmacConfig(process.env),
        BotIdempotencyHmacConfigError,
      );
    },
  );

  withEnv(
    {
      BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET: HMAC,
      BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS: "short-previous",
    },
    () => {
      assert.throws(
        () => resolveBotIdempotencyHmacConfig(process.env),
        BotIdempotencyHmacConfigError,
      );
    },
  );

  withEnv(
    {
      BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET: HMAC,
      BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS: HMAC,
    },
    () => {
      assert.throws(
        () => resolveBotIdempotencyHmacConfig(process.env),
        BotIdempotencyHmacConfigError,
      );
    },
  );

  withEnv({ BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET: HMAC }, () => {
    const cfg = resolveBotIdempotencyHmacConfig(process.env);
    assert.equal(cfg.currentSecret, HMAC);
    assert.deepEqual(cfg.previousSecrets, []);
  });

  withEnv(
    {
      BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET: HMAC,
      BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS: HMAC_OLD,
    },
    () => {
      const cfg = resolveBotIdempotencyHmacConfig(process.env);
      assert.equal(cfg.currentSecret, HMAC);
      assert.deepEqual(cfg.previousSecrets, [HMAC_OLD]);
    },
  );

  // Production without dedicated secret → INTERNAL_ERROR, no fallback constant
  {
    const prevSecret = process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET;
    const prevNode = process.env.NODE_ENV;
    delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET;
    process.env.NODE_ENV = "production";
    try {
      const result = await createBotConfirmedBooking(req);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "INTERNAL_ERROR");
      }
    } finally {
      if (prevSecret === undefined) {
        delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET;
      } else {
        process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = prevSecret;
      }
      if (prevNode === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prevNode;
      }
    }
  }

  const bannedFallback =
    "production-bot-booking-" + "idempotency-hmac-fallback";
  assert.equal(
    read("src/lib/bot-api/booking-create-idempotency.ts").includes(
      bannedFallback,
    ),
    false,
  );
  assert.equal(
    read("src/lib/bot-api/booking-create-idempotency-hmac.ts").includes(
      bannedFallback,
    ),
    false,
  );
  assert.equal(
    read("docs/architecture/bot-internal-api-pr-a.md").includes(bannedFallback),
    false,
  );

  process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = HMAC;
  delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;
}

async function testHmacRotation(): Promise<void> {
  const {
    computeBotBookingRequestFingerprint,
    computeBotBookingRequestFingerprintCandidates,
    botBookingFingerprintMatchesAny,
  } = await import("../src/lib/bot-api/booking-create-idempotency");
  const { buildBotSlotId } = await import("../src/lib/booking/bot-slot-id");

  const input = {
    slotId: buildBotSlotId({
      serviceId: S1,
      masterId: M1,
      dateKey: "2026-08-10",
      startTime: "15:00",
    }),
    clientName: "Rotation",
    phone: "+79005556677",
    personalDataConsent: true,
    offerAcknowledgement: true,
  };

  process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = HMAC_OLD;
  delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;
  const oldFp = computeBotBookingRequestFingerprint(input);

  process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = HMAC_NEW;
  process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS = HMAC_OLD;
  const { current, candidates } =
    computeBotBookingRequestFingerprintCandidates(input);
  assert.notEqual(current, oldFp);
  assert.equal(botBookingFingerprintMatchesAny(oldFp, candidates), true);

  // Conflict across rotation: different payload must not match
  const other = computeBotBookingRequestFingerprintCandidates({
    ...input,
    clientName: "Other",
  });
  assert.equal(
    botBookingFingerprintMatchesAny(oldFp, other.candidates),
    false,
  );

  // Missing previous → old fingerprint not accepted
  delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;
  const withoutPrev = computeBotBookingRequestFingerprintCandidates(input);
  assert.equal(
    botBookingFingerprintMatchesAny(oldFp, withoutPrev.candidates),
    false,
  );

  process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = HMAC;
  delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;
}

function testRateLimitEnvelope(): void {
  const responseSrc = read("src/lib/security/rate-limit/response.ts");
  assert.match(responseSrc, /BOT_INTERNAL_RATE_LIMIT_MESSAGE/);
  assert.match(responseSrc, /Too many requests/);
  assert.match(responseSrc, /createBotInternalRateLimitResponse/);

  const wrapper = read("src/lib/auth/bot-internal-api.ts");
  assert.match(wrapper, /createBotInternalRateLimitResponse/);
  assert.match(wrapper, /BOT_INTERNAL_RATE_LIMIT_PRINCIPAL/);
  assert.doesNotMatch(
    wrapper,
    /PUBLIC_RATE_LIMIT_MESSAGE|Слишком много запросов/,
  );

  const {
    buildBotInternalRateLimitJsonBody,
    PUBLIC_RATE_LIMIT_MESSAGE,
  } = require("../src/lib/security/rate-limit/response") as {
    buildBotInternalRateLimitJsonBody: () => {
      ok: false;
      error: string;
      code: "RATE_LIMITED";
    };
    PUBLIC_RATE_LIMIT_MESSAGE: string;
  };
  assert.deepEqual(buildBotInternalRateLimitJsonBody(), {
    ok: false,
    error: "Too many requests",
    code: "RATE_LIMITED",
  });
  assert.match(PUBLIC_RATE_LIMIT_MESSAGE, /Слишком много/);
}

async function testHttpRateLimitedEnvelope(): Promise<void> {
  process.env.BOT_INTERNAL_API_TOKEN = TOKEN;
  const { withBotInternalApi, BOT_INTERNAL_RATE_LIMIT_PRINCIPAL } = await import(
    "../src/lib/auth/bot-internal-api"
  );
  const { checkRateLimitByPolicy } = await import(
    "../src/lib/security/rate-limit/check"
  );
  const { resetRateLimitStoreForTests } = await import(
    "../src/lib/security/rate-limit/store"
  );
  const { PUBLIC_RATE_LIMIT_MESSAGE } = await import(
    "../src/lib/security/rate-limit/response"
  );
  const { getRateLimitPolicy } = await import(
    "../src/lib/security/rate-limit/policies"
  );

  resetRateLimitStoreForTests();

  let serviceCalled = false;
  const handler = withBotInternalApi(
    async () => {
      serviceCalled = true;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    { rateLimitPolicy: "botInternalBookingCreate" },
  );

  const headers = {
    get(name: string) {
      const map: Record<string, string> = {
        authorization: `Bearer ${TOKEN}`,
        "user-agent": "c24-rate-limit-test",
        "accept-language": "en",
        "content-type": "application/json",
      };
      return map[name.toLowerCase()] ?? null;
    },
  };

  const policy = getRateLimitPolicy("botInternalBookingCreate");
  for (let i = 0; i < policy.maxRequests; i++) {
    const decision = checkRateLimitByPolicy(
      "botInternalBookingCreate",
      headers,
      [BOT_INTERNAL_RATE_LIMIT_PRINCIPAL],
    );
    assert.equal(decision.allowed, true);
  }

  const request = new Request("http://127.0.0.1/api/internal/bot/v1/bookings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "c24-rate-limit-test",
      "Accept-Language": "en",
    },
    body: JSON.stringify({ shouldNotBeRead: true }),
  });

  const response = await handler(request);
  assert.equal(response.status, 429);
  assert.equal(serviceCalled, false);
  const retryAfter = response.headers.get("Retry-After");
  assert.ok(retryAfter && Number(retryAfter) >= 1);

  const body = await response.json();
  assert.deepEqual(body, {
    ok: false,
    code: "RATE_LIMITED",
    error: "Too many requests",
  });
  assert.doesNotMatch(JSON.stringify(body), /Слишком много/);
  assert.match(PUBLIC_RATE_LIMIT_MESSAGE, /Слишком много/);

  delete process.env.BOT_INTERNAL_API_TOKEN;
  resetRateLimitStoreForTests();
}

function testSingleInstanceTopologyGuard(): void {
  const {
    assertSingleInstanceCompose,
    validateSingleInstanceCompose,
    composeWithReplicas,
    assertNoNodeClusterOrPm2,
  } = require("./lib/bot-booking-create-topology-guard") as typeof import("./lib/bot-booking-create-topology-guard");

  for (const rel of [
    "docker-compose.production.yml",
    "docker-compose.staging.yml",
  ]) {
    assertSingleInstanceCompose(read(rel));
  }

  const prod = read("docker-compose.production.yml");
  for (const n of [2, 9, 10, 100]) {
    const issues = validateSingleInstanceCompose(composeWithReplicas(prod, n));
    assert.ok(
      issues.some((i) => i.code === "REPLICAS_GT_1"),
      `replicas ${n} must fail`,
    );
  }

  assert.throws(() => assertNoNodeClusterOrPm2("pm2 start app"), /pm2/i);
  assert.throws(
    () => assertNoNodeClusterOrPm2('import cluster from "node:cluster"; cluster.fork()'),
    /cluster/,
  );
  assertNoNodeClusterOrPm2(read("package.json"));

  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
  };
  assert.doesNotMatch(pkg.scripts.start ?? "", /\bpm2\b|cluster/i);

  const store = read("src/lib/security/rate-limit/store.ts");
  assert.match(store, /Map|memory|process/i);
  assert.doesNotMatch(store, /createClient\(|ioredis|Redis/);
  assert.match(read("src/lib/security/rate-limit/policies.ts"), /single-instance/i);

  // Rolling deploy brief overlap is temporary — documented, not steady-state scale.
  assert.match(
    read("docs/architecture/bot-internal-api-pr-a.md"),
    /rolling|overlap|single-instance/i,
  );
}

function testCiWiring(): void {
  const {
    assertBotBookingCreateCiWiring,
    assertBotBookingCreateRequiredPackageScript,
    runTextExecutesRequiredGateCommand,
    BOT_BOOKING_CREATE_CI_WORKFLOW_PATH,
    BOT_BOOKING_CREATE_REQUIRED_NPM,
  } = require("./lib/bot-booking-create-ci-wiring") as typeof import("./lib/bot-booking-create-ci-wiring");

  assert.ok(
    fs.existsSync(path.join(ROOT, BOT_BOOKING_CREATE_CI_WORKFLOW_PATH)),
  );

  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
  };
  const requiredScript =
    pkg.scripts["test:security:bot-internal-booking-create-db:required"];
  assertBotBookingCreateRequiredPackageScript(requiredScript);
  assertBotBookingCreateCiWiring(read(BOT_BOOKING_CREATE_CI_WORKFLOW_PATH), {
    packageScript: requiredScript,
  });

  assert.equal(
    runTextExecutesRequiredGateCommand(BOT_BOOKING_CREATE_REQUIRED_NPM),
    true,
  );
  assert.equal(
    runTextExecutesRequiredGateCommand(`set -e\n${BOT_BOOKING_CREATE_REQUIRED_NPM}`),
    true,
  );
  assert.equal(
    runTextExecutesRequiredGateCommand(`echo "${BOT_BOOKING_CREATE_REQUIRED_NPM}"`),
    false,
  );
  assert.equal(
    runTextExecutesRequiredGateCommand(`# ${BOT_BOOKING_CREATE_REQUIRED_NPM}`),
    false,
  );
  assert.equal(
    runTextExecutesRequiredGateCommand(
      `false && ${BOT_BOOKING_CREATE_REQUIRED_NPM}`,
    ),
    false,
  );
  assert.equal(
    runTextExecutesRequiredGateCommand(
      `${BOT_BOOKING_CREATE_REQUIRED_NPM} || true`,
    ),
    false,
  );
}

function testCiWiringMutations(): void {
  const {
    assertCiWiringRejectsMutation,
    validateBotBookingCreateCiWiring,
    validateBotBookingCreateRequiredPackageScript,
    mutateWorkflowText,
    runTextExecutesRequiredGateCommand,
    BOT_BOOKING_CREATE_CI_WORKFLOW_PATH,
    BOT_BOOKING_CREATE_REQUIRED_NPM,
  } = require("./lib/bot-booking-create-ci-wiring") as typeof import("./lib/bot-booking-create-ci-wiring");

  const original = read(BOT_BOOKING_CREATE_CI_WORKFLOW_PATH);
  const cases: Array<
    [Parameters<typeof assertCiWiringRejectsMutation>[1], string]
  > = [
    ["remove-health-cmd", "MISSING_HEALTH_CMD"],
    ["replace-pg-isready", "MISSING_PG_ISREADY"],
    ["gate-if-false", "GATE_STEP_IF"],
    ["gate-continue-on-error", "GATE_CONTINUE_ON_ERROR"],
    ["gate-nongating-command", "MISSING_GATE_STEP"],
    ["remove-require-postgres", "MISSING_GATE_STEP"],
    ["remove-migrate", "MISSING_MIGRATE"],
    ["remove-hmac-env", "MISSING_HMAC_ENV"],
    ["remove-postgres-service", "MISSING_POSTGRES_SERVICE"],
    ["remove-gate-step", "MISSING_GATE_STEP"],
    ["gate-echo-required", "GATE_COMMAND_NOT_EXECUTED"],
    ["gate-comment-only", "MISSING_GATE_STEP"],
    ["gate-false-and-required", "GATE_COMMAND_NOT_EXECUTED"],
    ["remove-path-production-compose", "MISSING_PATH_PRODUCTION_COMPOSE"],
    ["remove-path-staging-compose", "MISSING_PATH_STAGING_COMPOSE"],
    ["remove-path-ci-wiring", "MISSING_PATH_CI_WIRING"],
    ["remove-path-topology-guard", "MISSING_PATH_TOPOLOGY_GUARD"],
    ["remove-path-test-db-guard", "MISSING_PATH_TEST_DB_GUARD"],
    ["remove-path-pg-fixture", "MISSING_PATH_PG_FIXTURE"],
  ];
  for (const [mutation, code] of cases) {
    assertCiWiringRejectsMutation(original, mutation, code);
  }

  // Exact correct Gate command still passes after dump round-trip of unrelated mutation restore
  assert.equal(
    runTextExecutesRequiredGateCommand(BOT_BOOKING_CREATE_REQUIRED_NPM),
    true,
  );
  const echoMutated = mutateWorkflowText(original, "gate-echo-required");
  assert.ok(
    validateBotBookingCreateCiWiring(echoMutated).some(
      (i) => i.code === "GATE_COMMAND_NOT_EXECUTED",
    ),
  );

  // Package script mutations (in-memory only)
  assert.ok(
    validateBotBookingCreateRequiredPackageScript(
      "tsx scripts/security-bot-internal-booking-create-db-check.ts",
    ).some((i) => i.code === "MISSING_REQUIRE_FLAG"),
  );
  assert.ok(
    validateBotBookingCreateRequiredPackageScript(
      "tsx scripts/security-bot-internal-booking-create-db-check.ts --require-postgres || true",
    ).some((i) => i.code === "REQUIRED_SCRIPT_ERROR_SUPPRESSED"),
  );
  assert.equal(
    validateBotBookingCreateRequiredPackageScript(
      "tsx scripts/security-bot-internal-booking-create-db-check.ts --require-postgres",
    ).length,
    0,
  );
}

async function testDbGuardBeforeConnectOrdering(): Promise<void> {
  const { resolveBotBookingCreateRaceEligibility } = require("./lib/bot-booking-create-db-race-eligibility") as typeof import("./lib/bot-booking-create-db-race-eligibility");

  // tvoe_vremya, non-gating → no connection
  {
    let connectionCalls = 0;
    const result = await resolveBotBookingCreateRaceEligibility({
      databaseUrl: "postgresql://u:p@127.0.0.1:5432/tvoe_vremya",
      requirePostgres: false,
      env: { CI: "true" },
      canQuery: async () => {
        connectionCalls += 1;
        return true;
      },
    });
    assert.equal(result.kind, "skip");
    assert.equal(connectionCalls, 0);
  }

  // malformed URL, non-gating → no connection
  {
    let connectionCalls = 0;
    const result = await resolveBotBookingCreateRaceEligibility({
      databaseUrl: "not-a-url",
      requirePostgres: false,
      env: { CI: "true" },
      canQuery: async () => {
        connectionCalls += 1;
        return true;
      },
    });
    assert.equal(result.kind, "skip");
    assert.equal(connectionCalls, 0);
  }

  // forbidden URL, required → fail, no connection
  {
    let connectionCalls = 0;
    const result = await resolveBotBookingCreateRaceEligibility({
      databaseUrl: "postgresql://u:p@127.0.0.1:5432/tvoe_vremya",
      requirePostgres: true,
      env: { CI: "true" },
      canQuery: async () => {
        connectionCalls += 1;
        return true;
      },
    });
    assert.equal(result.kind, "fail");
    assert.equal(connectionCalls, 0);
  }

  // Allowed disposable DB → canQuery only after successful guard
  {
    let connectionCalls = 0;
    let guardPassedBeforeConnect = false;
    const { assertDisposableBotBookingTestDatabase } = require("./lib/bot-booking-create-test-db-guard") as typeof import("./lib/bot-booking-create-test-db-guard");
    const url =
      "postgresql://postgres:postgres@127.0.0.1:5432/bot_booking_create_gate";
    assert.doesNotThrow(() =>
      assertDisposableBotBookingTestDatabase(url, { CI: "true" }),
    );
    guardPassedBeforeConnect = true;
    const result = await resolveBotBookingCreateRaceEligibility({
      databaseUrl: url,
      requirePostgres: true,
      env: { CI: "true" },
      canQuery: async () => {
        assert.equal(guardPassedBeforeConnect, true);
        connectionCalls += 1;
        return false; // unreachable — do not need real PG
      },
    });
    assert.equal(result.kind, "fail");
    if (result.kind === "fail") {
      assert.equal(result.code, "POSTGRES_UNREACHABLE");
    }
    assert.equal(connectionCalls, 1);
  }

  // Allowed disposable + reachable probe → proceed, exactly one canQuery
  {
    let connectionCalls = 0;
    const result = await resolveBotBookingCreateRaceEligibility({
      databaseUrl:
        "postgresql://postgres:postgres@127.0.0.1:5432/c24test_local",
      requirePostgres: false,
      env: { BOT_BOOKING_CREATE_ALLOW_TEST_DB_MUTATION: "true" },
      canQuery: async () => {
        connectionCalls += 1;
        return true;
      },
    });
    assert.equal(result.kind, "proceed");
    assert.equal(connectionCalls, 1);
  }
}

function testTestDatabaseGuard(): void {
  const {
    assertDisposableBotBookingTestDatabase,
    BotBookingCreateTestDbGuardError,
  } = require("./lib/bot-booking-create-test-db-guard") as typeof import("./lib/bot-booking-create-test-db-guard");

  assert.throws(
    () =>
      assertDisposableBotBookingTestDatabase(
        "postgresql://u:p@127.0.0.1:5432/tvoe_vremya",
        { CI: "true" },
      ),
    BotBookingCreateTestDbGuardError,
  );
  assert.throws(
    () =>
      assertDisposableBotBookingTestDatabase(
        "postgresql://u:p@127.0.0.1:5432/my_production_db",
        { CI: "true" },
      ),
    BotBookingCreateTestDbGuardError,
  );
  assert.throws(
    () =>
      assertDisposableBotBookingTestDatabase(
        "postgresql://u:p@127.0.0.1:5432/working_db",
        { CI: "true", BOT_BOOKING_CREATE_ALLOW_TEST_DB_MUTATION: "true" },
      ),
    (err: unknown) =>
      err instanceof BotBookingCreateTestDbGuardError &&
      err.code === "MISSING_TEST_MARKER",
  );
  assert.throws(
    () => assertDisposableBotBookingTestDatabase(undefined, { CI: "true" }),
    BotBookingCreateTestDbGuardError,
  );
  assert.throws(
    () =>
      assertDisposableBotBookingTestDatabase("not-a-url", {
        CI: "true",
      }),
    BotBookingCreateTestDbGuardError,
  );

  assert.doesNotThrow(() =>
    assertDisposableBotBookingTestDatabase(
      "postgresql://postgres:postgres@127.0.0.1:5432/bot_booking_create_gate",
      { CI: "true" },
    ),
  );
  assert.doesNotThrow(() =>
    assertDisposableBotBookingTestDatabase(
      "postgresql://postgres:postgres@127.0.0.1:5432/c24test_local",
      { BOT_BOOKING_CREATE_ALLOW_TEST_DB_MUTATION: "true" },
    ),
  );
  assert.throws(
    () =>
      assertDisposableBotBookingTestDatabase(
        "postgresql://postgres:postgres@127.0.0.1:5432/c24test_local",
        {},
      ),
    (err: unknown) =>
      err instanceof BotBookingCreateTestDbGuardError &&
      err.code === "MUTATION_NOT_ALLOWED",
  );
}

function testTestHooksProductionSafety(): void {
  const {
    botBookingCreateTestHooksAllowed,
    assertBotBookingCreateTestHooksAllowed,
    setBotBookingCreateTestHooks,
  } = require("../src/lib/bot-api/booking-create-test-hooks") as typeof import("../src/lib/bot-api/booking-create-test-hooks");

  assert.equal(
    botBookingCreateTestHooksAllowed({
      NODE_ENV: "production",
      SECURITY_BATCH_TEST: "1",
    }),
    false,
  );
  assert.throws(
    () =>
      setBotBookingCreateTestHooks(
        { afterClientResolve: () => undefined },
        { NODE_ENV: "production", SECURITY_BATCH_TEST: "1" },
      ),
    /BOT_BOOKING_CREATE_TEST_HOOK_DISABLED/,
  );
  assert.throws(
    () =>
      assertBotBookingCreateTestHooksAllowed({
        NODE_ENV: "development",
        SECURITY_BATCH_TEST: undefined,
      }),
    /BOT_BOOKING_CREATE_TEST_HOOK_DISABLED/,
  );

  const types = read("src/lib/bot-api/booking-create-types.ts");
  assert.doesNotMatch(types, /beforeCreate|testHook|SECURITY_BATCH/);
  const route = read("src/app/api/internal/bot/v1/bookings/route.ts");
  assert.doesNotMatch(route, /setBotBookingCreateTestHooks|beforeCreate/);
}

async function testSnapshotSanitizer(): Promise<void> {
  const {
    sanitizeBotBookingResultSnapshot,
    buildSafeBotBookingResultSnapshot,
  } = await import("../src/lib/bot-api/booking-create-idempotency");

  const snap = buildSafeBotBookingResultSnapshot({
    bookingId: KEY,
    slotId: `bs1.${S1}.${M1}.2026-08-10.0900`,
    startsAt: "2026-08-10T09:00:00+05:00",
  });
  assert.deepEqual(sanitizeBotBookingResultSnapshot(snap), snap);
  assert.equal(
    sanitizeBotBookingResultSnapshot({
      ...snap,
      phone: "+7900",
    }),
    null,
  );
  assert.equal(sanitizeBotBookingResultSnapshot({ ok: true }), null);
}

function testStaticArchitecture(): void {
  const route = read("src/app/api/internal/bot/v1/bookings/route.ts");
  const stripped = stripComments(route);

  assert.match(
    route,
    /import \{ withBotInternalApi \} from "@\/lib\/auth\/bot-internal-api"/,
  );
  assert.match(route, /export const POST = withBotInternalApi/);
  assert.match(route, /rateLimitPolicy:\s*"botInternalBookingCreate"/);
  assert.match(route, /isExactApplicationJsonContentType/);
  assert.match(route, /readBoundedJsonBody/);
  assert.match(route, /parseBotBookingCreateBody/);
  assert.match(route, /createBotConfirmedBooking/);
  assert.match(route, /safeLogError/);
  assert.doesNotMatch(route, /prisma\./);
  assert.doesNotMatch(route, /\/api\/booking\/create/);
  assert.doesNotMatch(route, /fetch\(/);
  assert.doesNotMatch(route, /n8n|amoCRM|amocrm|bot-TV|vk\.com|max\.ru|mcp/i);
  assert.doesNotMatch(route, /console\.(log|info|debug|error)/);
  assert.doesNotMatch(route, /manageUrl|manageToken|issuedManageToken/);
  assert.ok(
    route.indexOf("withBotInternalApi") < route.indexOf("readBoundedJsonBody"),
  );

  const service = read("src/services/BotBookingCreateService.ts");
  assert.match(service, /import "server-only"/);
  assert.match(service, /createBotOnlineAppointment/);
  assert.match(service, /assertOnlineBookable/);
  assert.match(service, /getAvailableTimeSlots/);
  assert.match(service, /parseBotSlotId/);
  assert.match(service, /runSerializableAppointmentWrite/);
  assert.match(service, /CLIENT_AMBIGUOUS/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.doesNotMatch(service, /createOnlineAppointment\(/);
  assert.doesNotMatch(service, /source:\s*"ONLINE"/);
  assert.doesNotMatch(service, /n8n|amoCRM|fetch\(/);

  const appointment = stripComments(read("src/services/AppointmentService.ts"));
  assert.match(appointment, /export async function createBotOnlineAppointment/);
  assert.match(appointment, /source:\s*"BOT"/);
  assert.match(appointment, /source:\s*"BOT"/);
  assert.match(appointment, /"BOT"/);

  const availability = read("src/lib/bot-api/availability.ts");
  assert.match(availability, /from "@\/lib\/booking\/bot-slot-id"/);
  assert.doesNotMatch(
    stripComments(availability),
    /const BOT_SLOT_ID_PREFIX = "bs1"/,
  );

  const migration = read(
    "prisma/migrations/20260806120000_internal_bot_booking_create/migration.sql",
  );
  assert.match(migration, /LegalAcceptanceSource.*ADD VALUE 'BOT'/);
  assert.match(migration, /internal_bot_booking_operations/);
  assert.doesNotMatch(migration, /normalized_phone.*UNIQUE|UNIQUE.*normalized_phone/i);
  assert.doesNotMatch(migration, /outbox/i);

  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model InternalBotBookingOperation/);
  assert.match(schema, /enum InternalBotBookingOperationState/);
  assert.match(schema, /BOT\s*\n/);

  const hmacMod = read("src/lib/bot-api/booking-create-idempotency-hmac.ts");
  assert.match(hmacMod, /import "server-only"/);
  assert.doesNotMatch(
    hmacMod,
    /process\.env\.(AUTH_SECRET|NEXTAUTH_SECRET|BOT_INTERNAL_API_TOKEN)/,
  );
  const idempotency = read("src/lib/bot-api/booking-create-idempotency.ts");
  assert.match(idempotency, /import "server-only"/);
  assert.doesNotMatch(
    idempotency,
    /process\.env\.(AUTH_SECRET|NEXTAUTH_SECRET)|hmac-fallback|dev-bot-booking-idempotency/,
  );

  assert.doesNotMatch(stripped, /bookingRequestId/);
}

function testRateLimitInventory(): void {
  assert.equal(
    resolveApiRateLimitPolicy("/api/internal/bot/v1/bookings", "POST"),
    "botInternalBookingCreate",
  );
  assert.equal(
    resolveApiRateLimitPolicy("/api/internal/bot/v1/slots", "POST"),
    "botInternal",
  );
}

function testCsrfExemption(): void {
  assert.equal(
    requiresAdminCsrfProtection("POST", "/api/internal/bot/v1/bookings"),
    false,
  );
}

async function testContentTypeHelper(): Promise<void> {
  const { isExactApplicationJsonContentType } = await import(
    "../src/lib/bot-api/booking-create-types"
  );
  assert.equal(isExactApplicationJsonContentType("application/json"), true);
  assert.equal(
    isExactApplicationJsonContentType("application/json; charset=utf-8"),
    true,
  );
  assert.equal(isExactApplicationJsonContentType("text/plain"), false);
  assert.equal(
    isExactApplicationJsonContentType("application/json; charset=utf-16"),
    false,
  );
  assert.equal(isExactApplicationJsonContentType(null), false);
}

async function testRouteCoverageIncludesBookings(): Promise<void> {
  const coverage = await import("./security-bot-internal-route-coverage-check");
  const routes = coverage.assertBotInternalRouteCoverage();
  assert.ok(
    routes.some((r) => r.replace(/\\/g, "/").includes("bookings/route.ts")),
    "coverage must include bookings route",
  );
}

async function testPublicOnlineRegressionStatics(): Promise<void> {
  const createRoute = read("src/app/api/booking/create/route.ts");
  assert.match(createRoute, /createOnlineBooking/);
  assert.doesNotMatch(createRoute, /createBotConfirmedBooking/);
  assert.doesNotMatch(createRoute, /source:\s*"BOT"/);

  const online = stripComments(read("src/services/AppointmentService.ts"));
  assert.match(
    online,
    /export async function createOnlineAppointment[\s\S]*source:\s*"ONLINE"/,
  );
}

main().catch((error) => {
  console.error = originalConsoleError;
  console.error(error);
  process.exit(1);
});
