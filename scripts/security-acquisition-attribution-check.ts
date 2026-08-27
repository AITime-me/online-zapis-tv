process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ACQUISITION_BOOKING_PATHNAME,
  ACQUISITION_EVIDENCE_FRAGMENT_KEY,
  AcquisitionAttributionValidationError,
  applyTrustedSourceMarker,
  buildAcquisitionBookingRedirectPath,
  clearBookingFlowAcquisitionEvidence,
  discardClientSourceMarker,
  getOrCreateBookingFlowAcquisitionEvidence,
  parseAcquisitionLinkUtmInput,
  readAcquisitionEvidenceTokenFromHash,
  requireAcquisitionMarketingIdentifier,
  requireAcquisitionSourceKey,
  stripAcquisitionEvidenceFromHash,
  BOOKING_FLOW_ACQUISITION_EVIDENCE_STORAGE_KEY,
} from "../src/lib/attribution/trusted-acquisition";
import {
  captureSiteAttribution,
  EMPTY_SITE_ATTRIBUTION,
  parseSiteAttribution,
} from "../src/lib/attribution/site-attribution";
import { appendCampaignUtmParams } from "../src/lib/communications/cta-link-policy";
import {
  buildBookingIdempotencyPayload,
  canonicalizeBookingIdempotencyPayloadForTests,
  computeIdempotencyPayloadHash,
} from "../src/lib/booking-requests/idempotency-server";
import {
  hashOpaqueToken,
  isPlausibleOpaqueToken,
  generateOpaqueToken,
} from "../src/lib/security/opaque-token";
import { mintAcquisitionLink } from "../src/services/AcquisitionAttributionService";
import { POST as adminMintPost } from "../src/app/api/admin/acquisition-links/route";

const ROOT = process.cwd();

/**
 * Fixed A2.3a legacy vector: no acquisition evidence, UTM+referrer present,
 * source_marker null, DEV HMAC secret. Must never change.
 */
const LEGACY_BARE_ATTRIBUTION_VECTOR = {
  clientName: "Test Client",
  clientPhone: "+79000000000",
  type: "CONSULTATION_REQUEST" as const,
  comment: null,
  masterId: null,
  serviceId: null,
  personalDataConsent: true,
  offerAcknowledgement: true,
  gamePlayId: null,
  gameSessionId: null,
  attribution: {
    ...EMPTY_SITE_ATTRIBUTION,
    utm_source: "vk",
    utm_medium: "cpc",
    utm_campaign: "summer_2026",
    utm_content: "button-1",
    referrer: "https://vk.com",
    source_marker: null,
  },
};

const LEGACY_BARE_CANONICAL =
  '{"clientName":"Test Client","clientPhone":"79000000000","comment":null,"gamePlayId":null,"gameSessionId":null,"masterId":null,"offerAcknowledgement":true,"personalDataConsent":true,"serviceId":null,"type":"CONSULTATION_REQUEST","attribution":{"utm_source":"vk","utm_medium":"cpc","utm_campaign":"summer_2026","utm_content":"button-1","utm_term":null,"referrer":"https://vk.com","source_marker":null}}';

const LEGACY_BARE_HASH =
  "0c3cd76684f6da6fef9064c0757554658459c58e1e1d025e726655eb0ee6933b";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

class MemorySessionStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function fakeLinkDb() {
  let createdData: Record<string, unknown> | null = null;
  return {
    db: {
      acquisitionLink: {
        create: async (input: { data: Record<string, unknown> }) => {
          createdData = input.data;
          return { id: "synthetic-link" };
        },
        findUnique: async () => null,
      },
    } as never,
    getCreatedData: () => createdData,
  };
}

function bookingRequestHash(input: {
  attribution?: typeof EMPTY_SITE_ATTRIBUTION;
  acquisitionEvidenceToken?: string | null;
}): string {
  return computeIdempotencyPayloadHash(
    buildBookingIdempotencyPayload({
      clientName: "Test Client",
      clientPhone: "+79000000000",
      type: "CONSULTATION_REQUEST",
      comment: null,
      masterId: null,
      serviceId: null,
      personalDataConsent: true,
      offerAcknowledgement: true,
      gamePlayId: null,
      gameSessionId: null,
      attribution: input.attribution,
      acquisitionEvidenceToken: input.acquisitionEvidenceToken,
    }),
  );
}

async function testMintStoresHashOnly(): Promise<void> {
  const now = new Date("2026-08-27T12:00:00.000Z");
  const fake = fakeLinkDb();
  const minted = await mintAcquisitionLink(
    {
      sourceKey: "VK_ADS",
      utmCampaign: "summer",
      utmSource: "vk",
    },
    fake.db,
    now,
  );

  assert.equal(isPlausibleOpaqueToken(minted.token), true);
  assert.equal(minted.publicPath, `/a/${minted.token}`);
  const stored = fake.getCreatedData();
  assert.ok(stored);
  assert.equal(stored.tokenHash, hashOpaqueToken(minted.token));
  assert.equal(stored.sourceKey, "VK_ADS");
  assert.equal(stored.utmCampaign, "summer");
  assert.equal(Object.hasOwn(stored, "token"), false);
  assert.equal(Object.hasOwn(stored, "targetPath"), false);
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(minted.token));
}

function testUntrustedInputsCannotCreateMarker(): void {
  const query = captureSiteAttribution(
    new URLSearchParams(
      "source_marker=VK_ADS&utm_source=vk&utm_medium=messenger",
    ),
    "https://vk.com/private/path",
  );
  assert.equal(query.source_marker, null);

  const forgedJson = parseSiteAttribution({
    source_marker: "VK_ADS",
    utm_source: "vk",
    referrer: "https://vk.com",
  });
  assert.equal(forgedJson.ok, true);
  if (!forgedJson.ok) throw new Error("forged attribution parse failed");
  assert.equal(discardClientSourceMarker(forgedJson.value).source_marker, null);
  assert.equal(
    applyTrustedSourceMarker(forgedJson.value, null).source_marker,
    null,
  );

  const observedOnly = applyTrustedSourceMarker(
    {
      ...EMPTY_SITE_ATTRIBUTION,
      utm_source: "yandex",
      referrer: "https://example.test",
    },
    null,
  );
  assert.equal(observedOnly.source_marker, null);

  const communicationTarget = appendCampaignUtmParams("/booking", {
    campaignSlug: "reactivation",
    buttonKey: "book",
  });
  const communicationObserved = captureSiteAttribution(
    new URLSearchParams(communicationTarget.split("?")[1]),
    null,
  );
  assert.equal(communicationObserved.utm_source, "vk");
  assert.equal(communicationObserved.utm_medium, "messenger");
  assert.equal(communicationObserved.source_marker, null);
}

function testTargetsSourcesAndFragmentLifecycle(): void {
  for (const source of ["VK_ADS", "VK_CONTENT", "YANDEX", "TWO_GIS"]) {
    assert.equal(requireAcquisitionSourceKey(source), source);
  }
  for (const source of [
    "SITE",
    "WALK_IN",
    "WORD_OF_MOUTH",
    "REPEAT_CLIENT",
    "UNDEFINED",
    "CASTDEV",
  ]) {
    assert.throws(
      () => requireAcquisitionSourceKey(source),
      AcquisitionAttributionValidationError,
    );
  }

  assert.deepEqual(parseAcquisitionLinkUtmInput(undefined), {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
  });
  assert.throws(
    () => parseAcquisitionLinkUtmInput({ phone: "79000000000" }),
    AcquisitionAttributionValidationError,
  );
  assert.throws(
    () => parseAcquisitionLinkUtmInput({ targetPath: "/booking" }),
    AcquisitionAttributionValidationError,
  );
  assert.throws(
    () =>
      parseAcquisitionLinkUtmInput({
        utm_source: "x".repeat(65),
      }),
    AcquisitionAttributionValidationError,
  );

  const evidenceToken = generateOpaqueToken();
  const redirectPath = buildAcquisitionBookingRedirectPath({
    utm: {
      utm_source: "vk",
      utm_medium: null,
      utm_campaign: "summer",
      utm_content: null,
      utm_term: null,
    },
    evidenceToken,
  });
  assert.match(redirectPath, new RegExp(`^${ACQUISITION_BOOKING_PATHNAME}\\?`));
  assert.match(
    redirectPath,
    new RegExp(`#${ACQUISITION_EVIDENCE_FRAGMENT_KEY}=${evidenceToken}$`),
  );
  const redirectUrl = new URL(redirectPath, "https://acquisition.invalid");
  assert.equal(redirectUrl.searchParams.has("acq"), false);
  assert.equal(
    redirectUrl.hash,
    `#${ACQUISITION_EVIDENCE_FRAGMENT_KEY}=${evidenceToken}`,
  );
  assert.equal(
    readAcquisitionEvidenceTokenFromHash(
      `#${ACQUISITION_EVIDENCE_FRAGMENT_KEY}=${evidenceToken}`,
    ),
    evidenceToken,
  );
  assert.equal(
    stripAcquisitionEvidenceFromHash(
      `#${ACQUISITION_EVIDENCE_FRAGMENT_KEY}=${evidenceToken}&keep=1`,
    ),
    "#keep=1",
  );

  const storage = new MemorySessionStorage();
  const first = getOrCreateBookingFlowAcquisitionEvidence(
    storage,
    `#acq=${evidenceToken}`,
  );
  assert.equal(first, evidenceToken);
  const secondToken = generateOpaqueToken();
  assert.equal(
    getOrCreateBookingFlowAcquisitionEvidence(storage, `#acq=${secondToken}`),
    evidenceToken,
  );
  clearBookingFlowAcquisitionEvidence(storage);
  assert.equal(
    storage.getItem(BOOKING_FLOW_ACQUISITION_EVIDENCE_STORAGE_KEY),
    null,
  );
  assert.equal(
    getOrCreateBookingFlowAcquisitionEvidence(storage, `#acq=${secondToken}`),
    secondToken,
  );
}

function testMarketingIdentifierGrammar(): void {
  assert.equal(
    requireAcquisitionMarketingIdentifier("vk_ads", "utm_source"),
    "vk_ads",
  );
  assert.equal(
    requireAcquisitionMarketingIdentifier("yandex-cpc", "utm_medium"),
    "yandex-cpc",
  );
  assert.equal(
    requireAcquisitionMarketingIdentifier("summer_2026", "utm_campaign"),
    "summer_2026",
  );
  assert.equal(
    requireAcquisitionMarketingIdentifier("button-1", "utm_content"),
    "button-1",
  );

  // Absent optional value → null. Explicit empty string is NOT absent.
  assert.equal(requireAcquisitionMarketingIdentifier(null, "utm_source"), null);
  assert.equal(
    requireAcquisitionMarketingIdentifier(undefined, "utm_source"),
    null,
  );
  assert.deepEqual(parseAcquisitionLinkUtmInput({}), {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
  });

  for (const bad of [
    "",
    " ",
    "   ",
    "\t",
    "\n",
    " vk_ads ",
    "vk_ads ",
    " vk_ads",
    "7-900-123-45-67",
    "900.123.4567",
    "123456789",
    "vk12345",
    "vk123456789",
    "+7-900-123-45-67",
    "(900)123-45-67",
    "user@example.com",
    "https://example.com",
    "%37%39%30%30",
    "summer campaign",
    "VK_Ads",
    "79001234567",
    "https://evil.example/path",
    "hello%20world",
    "path/with/slash",
    "a=b",
    "hash#frag",
    "q?x=1",
  ]) {
    assert.throws(
      () => requireAcquisitionMarketingIdentifier(bad, "utm_campaign"),
      AcquisitionAttributionValidationError,
      `expected reject for ${JSON.stringify(bad)}`,
    );
  }

  assert.throws(
    () =>
      parseAcquisitionLinkUtmInput({
        utm_campaign: "user@example.com",
      }),
    AcquisitionAttributionValidationError,
  );
  assert.throws(
    () =>
      parseAcquisitionLinkUtmInput({
        utm_campaign: "",
      }),
    AcquisitionAttributionValidationError,
  );
}

function testLegacyIdempotencyFingerprintVector(): void {
  process.env.NODE_ENV = "development";
  delete process.env.AUTH_SECRET;
  delete process.env.NEXTAUTH_SECRET;

  const payload = buildBookingIdempotencyPayload(LEGACY_BARE_ATTRIBUTION_VECTOR);
  const canonical = canonicalizeBookingIdempotencyPayloadForTests(payload);
  assert.equal(canonical, LEGACY_BARE_CANONICAL);
  assert.equal(computeIdempotencyPayloadHash(payload), LEGACY_BARE_HASH);

  // Bare → bare replay identity.
  assert.equal(
    bookingRequestHash({
      attribution: LEGACY_BARE_ATTRIBUTION_VECTOR.attribution,
    }),
    LEGACY_BARE_HASH,
  );

  // Client-forged marker must not alter no-evidence fingerprint.
  assert.equal(
    bookingRequestHash({
      attribution: {
        ...LEGACY_BARE_ATTRIBUTION_VECTOR.attribution,
        source_marker: "VK_ADS",
      },
    }),
    LEGACY_BARE_HASH,
  );

  const tokenA = generateOpaqueToken();
  const withEvidence = bookingRequestHash({
    attribution: LEGACY_BARE_ATTRIBUTION_VECTOR.attribution,
    acquisitionEvidenceToken: tokenA,
  });
  assert.notEqual(withEvidence, LEGACY_BARE_HASH);
  assert.equal(
    bookingRequestHash({
      attribution: LEGACY_BARE_ATTRIBUTION_VECTOR.attribution,
      acquisitionEvidenceToken: tokenA,
    }),
    withEvidence,
  );
}

function testIdempotencyIncludesEvidenceIdentity(): void {
  const tokenA = generateOpaqueToken();
  const tokenB = generateOpaqueToken();
  const bare = bookingRequestHash({});
  const withA = bookingRequestHash({ acquisitionEvidenceToken: tokenA });
  const withAAgain = bookingRequestHash({ acquisitionEvidenceToken: tokenA });
  const withB = bookingRequestHash({ acquisitionEvidenceToken: tokenB });

  assert.equal(withA, withAAgain);
  assert.notEqual(bare, withA);
  assert.notEqual(withA, withB);
}

function testRouteWiringAndSeparation(): void {
  const redirectRoute = read("src/app/a/[token]/route.ts");
  const adminRoute = read("src/app/api/admin/acquisition-links/route.ts");
  const createRoute = read("src/app/api/booking/create/route.ts");
  const requestRoute = read("src/app/api/booking/request/route.ts");
  const service = read("src/services/AcquisitionAttributionService.ts");
  const appointment = read("src/services/AppointmentService.ts");
  const bookingRequest = read("src/services/BookingRequestService.ts");
  const schema = read("prisma/schema.prisma");
  const migration = read(
    "prisma/migrations/20260827210000_trusted_acquisition_attribution/migration.sql",
  );
  const apiAccess = read("src/lib/auth/api-access.ts");
  const permissions = read("src/lib/auth/permissions.ts");
  const wizard = read("src/components/booking/booking-wizard.tsx");
  const requestForm = read(
    "src/components/booking/booking-manager-request-form.tsx",
  );
  const idempotency = read("src/lib/booking-requests/idempotency-server.ts");

  assert.match(adminRoute, /requireProtectedMutatingApi/);
  assert.match(adminRoute, /ACQUISITION_LINK_ADMIN_ROLES/);
  assert.match(
    apiAccess,
    /ACQUISITION_LINK_ADMIN_ROLES[^=]*=\s*OPERATIONAL_ADMIN_ROLES/,
  );
  assert.match(
    permissions,
    /OPERATIONAL_ADMIN_ROLES[^=]*=\s*\["OWNER",\s*"MANAGER"\]/,
  );
  assert.doesNotMatch(adminRoute, /token:\s*link\.token/);
  assert.doesNotMatch(adminRoute, /targetPath/);
  assert.match(redirectRoute, /issueAcquisitionEvidenceForLinkToken/);
  assert.doesNotMatch(redirectRoute, /Set-Cookie|tv_acquisition_evidence|cookies\.set/);
  assert.doesNotMatch(redirectRoute, /Communication|LINK_OPENED|campaignId/);
  assert.doesNotMatch(service, /Communication|LINK_OPENED|campaignId/);
  assert.doesNotMatch(service, /console\.|logger|safeLog/);
  assert.match(service, /statement_timestamp\(\)/);
  assert.match(service, /INSERT INTO "acquisition_evidence"/);
  assert.match(service, /claimAcquisitionEvidenceForAppointment/);
  assert.match(service, /claimAcquisitionEvidenceForBookingRequest/);
  assert.doesNotMatch(service, /expiresAt:\s*\{\s*gt:\s*input\.now/);
  assert.match(appointment, /claimAcquisitionEvidenceForAppointment/);
  assert.match(bookingRequest, /claimAcquisitionEvidenceForBookingRequest/);
  assert.match(createRoute, /acquisitionEvidenceToken/);
  assert.match(requestRoute, /acquisitionEvidenceToken/);
  assert.doesNotMatch(createRoute, /clearAcquisitionEvidenceCookie|tv_acquisition_evidence/);
  assert.doesNotMatch(requestRoute, /clearAcquisitionEvidenceCookie|tv_acquisition_evidence/);
  assert.match(wizard, /getOrCreateBookingFlowAcquisitionEvidence/);
  assert.match(wizard, /acquisitionEvidenceToken/);
  assert.match(wizard, /stripAcquisitionEvidenceFromHash/);
  assert.match(requestForm, /acquisitionEvidenceToken/);
  assert.match(schema, /model AcquisitionLink/);
  assert.match(schema, /model AcquisitionEvidence/);
  assert.doesNotMatch(schema, /AcquisitionAttributionToken/);
  assert.match(migration, /acquisition_links/);
  assert.match(migration, /acquisition_evidence_owner_state/);
  assert.match(migration, /acquisition_evidence_immutable_lifecycle/);
  assert.doesNotMatch(migration, /acquisition_attribution_tokens/);
  assert.match(idempotency, /source_marker:\s*payload\.attribution\.source_marker/);
}

async function testAdminHttpBoundary(): Promise<void> {
  const csrfDenied = await adminMintPost(
    new Request("http://localhost:3000/api/admin/acquisition-links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceKey: "VK_ADS" }),
    }),
  );
  assert.equal(csrfDenied.status, 403);
  const csrfBody = (await csrfDenied.json()) as { code?: string };
  assert.equal(csrfBody.code, "CSRF_ORIGIN");
}

async function main(): Promise<void> {
  await testMintStoresHashOnly();
  testUntrustedInputsCannotCreateMarker();
  testTargetsSourcesAndFragmentLifecycle();
  testMarketingIdentifierGrammar();
  testLegacyIdempotencyFingerprintVector();
  testIdempotencyIncludesEvidenceIdentity();
  testRouteWiringAndSeparation();
  await testAdminHttpBoundary();

  console.log(
    "trusted acquisition checks: legacy fingerprint, UTM grammar, DB-time claim wiring, fragment lifecycle PASSED",
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
