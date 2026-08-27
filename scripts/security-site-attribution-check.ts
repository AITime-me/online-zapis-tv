process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  BOOKING_FLOW_SITE_ATTRIBUTION_STORAGE_KEY,
  captureSiteAttribution,
  clearBookingFlowSiteAttribution,
  EMPTY_SITE_ATTRIBUTION,
  getOrCreateBookingFlowSiteAttribution,
  hasObservedSiteAttribution,
  parseSiteAttribution,
} from "../src/lib/attribution/site-attribution";
import { appendCampaignUtmParams } from "../src/lib/communications/cta-link-policy";
import {
  buildBookingIdempotencyPayload,
  computeIdempotencyPayloadHash,
} from "../src/lib/booking-requests/idempotency-server";

const ROOT = process.cwd();

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

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function bookingRequestHash(attribution = EMPTY_SITE_ATTRIBUTION): string {
  return computeIdempotencyPayloadHash(
    buildBookingIdempotencyPayload({
      clientName: "Иван Иванов",
      clientPhone: "+79001234567",
      type: "MANAGER_REQUEST",
      comment: null,
      masterId: null,
      serviceId: null,
      personalDataConsent: true,
      offerAcknowledgement: true,
      gamePlayId: null,
      gameSessionId: null,
      attribution,
    }),
  );
}

function testCaptureAndNormalization(): void {
  const params = new URLSearchParams({
    utm_source: " vk ",
    utm_medium: " messenger ",
    utm_campaign: " august ",
    utm_content: " book ",
    utm_term: " plasma ",
    source_marker: " campaign-link ",
  });
  const captured = captureSiteAttribution(
    params,
    " https://vk.com/community/path?client=secret#fragment ",
  );
  assert.deepEqual(captured, {
    utm_source: "vk",
    utm_medium: "messenger",
    utm_campaign: "august",
    utm_content: "book",
    utm_term: "plasma",
    referrer: "https://vk.com",
    source_marker: null,
  });
  assert.equal(hasObservedSiteAttribution(captured), true);

  const missing = captureSiteAttribution(new URLSearchParams(), "");
  assert.deepEqual(missing, EMPTY_SITE_ATTRIBUTION);
  assert.equal(hasObservedSiteAttribution(missing), false);
  assert.equal(missing.utm_source, null);
  assert.equal(missing.referrer, null);

  const invalidOne = captureSiteAttribution(
    new URLSearchParams({
      utm_source: "x".repeat(257),
      utm_campaign: "kept",
    }),
    null,
  );
  assert.equal(invalidOne.utm_source, null);
  assert.equal(invalidOne.utm_campaign, "kept");

  assert.deepEqual(parseSiteAttribution(undefined), {
    ok: true,
    value: EMPTY_SITE_ATTRIBUTION,
  });
  assert.equal(
    parseSiteAttribution({ utm_source: "x".repeat(257) }).ok,
    false,
  );
  assert.equal(parseSiteAttribution({ unexpected: "value" }).ok, false);
  assert.equal(parseSiteAttribution({ utm_source: 123 }).ok, false);
  assert.deepEqual(
    parseSiteAttribution({
      referrer: "https://example.test/private/path?phone=79001234567#token",
    }),
    {
      ok: true,
      value: {
        ...EMPTY_SITE_ATTRIBUTION,
        referrer: "https://example.test",
      },
    },
  );
  assert.equal(
    parseSiteAttribution({ referrer: "javascript:alert(1)" }).ok,
    true,
  );
  const unsupported = parseSiteAttribution({
    referrer: "javascript:alert(1)",
  });
  assert.equal(unsupported.ok && unsupported.value.referrer, null);
  const malformed = parseSiteAttribution({ referrer: "not an absolute URL" });
  assert.equal(malformed.ok && malformed.value.referrer, null);
  assert.equal(
    parseSiteAttribution({ referrer: `https://example.test/${"x".repeat(2048)}` })
      .ok,
    false,
  );
}

function testBookingFlowFirstTouchSession(): void {
  const storage = new MemorySessionStorage();
  const first = getOrCreateBookingFlowSiteAttribution(
    storage,
    new URLSearchParams("utm_source=vk&utm_campaign=first"),
    "https://referrer.test/private?secret=1",
  );
  assert.equal(first.utm_source, "vk");
  assert.equal(first.referrer, "https://referrer.test");

  const restoredAfterRemount = getOrCreateBookingFlowSiteAttribution(
    storage,
    new URLSearchParams("utm_source=yandex&utm_campaign=later"),
    "https://later.test/path",
  );
  assert.deepEqual(restoredAfterRemount, first);

  const emptyStorage = new MemorySessionStorage();
  const initiallyEmpty = getOrCreateBookingFlowSiteAttribution(
    emptyStorage,
    new URLSearchParams(),
    null,
  );
  assert.deepEqual(initiallyEmpty, EMPTY_SITE_ATTRIBUTION);
  assert.deepEqual(
    getOrCreateBookingFlowSiteAttribution(
      emptyStorage,
      new URLSearchParams("utm_source=must-not-overwrite"),
      "https://later.test",
    ),
    EMPTY_SITE_ATTRIBUTION,
  );

  const malformedStorage = new MemorySessionStorage();
  malformedStorage.setItem(
    BOOKING_FLOW_SITE_ATTRIBUTION_STORAGE_KEY,
    "{malformed",
  );
  assert.equal(
    getOrCreateBookingFlowSiteAttribution(
      malformedStorage,
      new URLSearchParams("utm_medium=recovered"),
      null,
    ).utm_medium,
    "recovered",
  );
  malformedStorage.setItem(
    BOOKING_FLOW_SITE_ATTRIBUTION_STORAGE_KEY,
    JSON.stringify({
      version: 0,
      attribution: { utm_source: "stale" },
    }),
  );
  assert.equal(
    getOrCreateBookingFlowSiteAttribution(
      malformedStorage,
      new URLSearchParams("utm_source=fresh"),
      null,
    ).utm_source,
    "fresh",
  );

  clearBookingFlowSiteAttribution(storage);
  assert.equal(
    storage.getItem(BOOKING_FLOW_SITE_ATTRIBUTION_STORAGE_KEY),
    null,
  );

  // A2.3a-06: after FLOW 1 success clears storage, FLOW 2 re-arms without remount.
  const flow2 = getOrCreateBookingFlowSiteAttribution(
    storage,
    new URLSearchParams("utm_source=vk&utm_campaign=second-flow"),
    "https://referrer.test/again",
  );
  assert.deepEqual(flow2, {
    ...EMPTY_SITE_ATTRIBUTION,
    utm_source: "vk",
    utm_campaign: "second-flow",
    referrer: "https://referrer.test",
  });
  assert.notEqual(flow2.utm_campaign, first.utm_campaign);
  assert.deepEqual(
    getOrCreateBookingFlowSiteAttribution(
      storage,
      new URLSearchParams("utm_source=must-not-overwrite-flow2"),
      "https://later.test/path",
    ),
    flow2,
  );
  assert.equal(
    hasObservedSiteAttribution(flow2),
    true,
    "second BookingRequest flow must not reopen with empty attribution",
  );
}

function testCampaignRedirectSurvivesCapture(): void {
  const target = appendCampaignUtmParams("/booking", {
    campaignSlug: "cold-plasma-intro",
    buttonKey: "book",
    utmSource: "vk",
    utmMedium: "messenger",
  });
  const captured = captureSiteAttribution(
    new URL(target, "https://example.test").searchParams,
    null,
  );
  assert.equal(captured.utm_source, "vk");
  assert.equal(captured.utm_medium, "messenger");
  assert.equal(captured.utm_campaign, "cold-plasma-intro");
  assert.equal(captured.utm_content, "book");
  assert.equal(captured.utm_term, null);
}

function testIdempotencyFingerprint(): void {
  const legacyCompatible = computeIdempotencyPayloadHash(
    buildBookingIdempotencyPayload({
      clientName: "Иван Иванов",
      clientPhone: "+79001234567",
      type: "MANAGER_REQUEST",
      comment: null,
      masterId: null,
      serviceId: null,
      personalDataConsent: true,
      offerAcknowledgement: true,
      gamePlayId: null,
      gameSessionId: null,
    }),
  );
  assert.equal(bookingRequestHash(), legacyCompatible);

  const observed = {
    ...EMPTY_SITE_ATTRIBUTION,
    utm_source: "vk",
  };
  assert.equal(bookingRequestHash(observed), bookingRequestHash(observed));
  assert.notEqual(bookingRequestHash(observed), legacyCompatible);
  assert.notEqual(
    bookingRequestHash(observed),
    bookingRequestHash({ ...observed, utm_source: "yandex" }),
  );
}

function testWiring(): void {
  const wizard = read("src/components/booking/booking-wizard.tsx");
  const requestForm = read(
    "src/components/booking/booking-manager-request-form.tsx",
  );
  const createRoute = read("src/app/api/booking/create/route.ts");
  const requestRoute = read("src/app/api/booking/request/route.ts");
  const appointments = read("src/services/AppointmentService.ts");
  const requests = read("src/services/BookingRequestService.ts");
  const appointmentContext = read("src/services/BotBookingMethodService.ts");
  const requestContext = read("src/services/BotBookingRequestService.ts");
  const attributionService = read("src/services/SiteAttributionService.ts");

  const feedTypes = read("src/lib/bot-api/booking-request-types.ts");
  const publicRequestContract = read(
    "src/lib/booking-requests/public-booking-request-contract.ts",
  );

  assert.match(wizard, /getOrCreateBookingFlowSiteAttribution/);
  assert.match(wizard, /window\.sessionStorage/);
  assert.doesNotMatch(wizard, /localStorage/);
  assert.match(wizard, /attribution: siteAttribution/);
  assert.match(requestForm, /attribution,/);
  assert.match(
    wizard.slice(
      wizard.indexOf("const completeAttributionFlow"),
      wizard.indexOf("const resetWizard"),
    ),
    /clearBookingFlowSiteAttribution\(window\.sessionStorage\)/,
  );
  assert.match(
    wizard.slice(
      wizard.indexOf("const openBookingRequestForm"),
      wizard.indexOf("const resetWizard"),
    ),
    /setSiteAttribution\(captureBookingFlowSiteAttribution\(\)\)/,
  );
  assert.match(
    wizard.slice(
      wizard.indexOf("const openManagerOnlyServiceRequest"),
      wizard.indexOf("const switchBookingPath"),
    ),
    /openBookingRequestForm\(/,
  );
  assert.doesNotMatch(
    wizard.slice(
      wizard.indexOf("const openManagerOnlyServiceRequest"),
      wizard.indexOf("const switchBookingPath"),
    ),
    /setRequestForm\(/,
  );
  assert.match(
    wizard.slice(
      wizard.lastIndexOf("setSuccessRulesResult"),
      wizard.indexOf('setStep("success")') + 'setStep("success")'.length,
    ),
    /completeAttributionFlow\(\)/,
  );
  assert.match(
    requestForm.slice(
      requestForm.indexOf("clearIdempotencyKey(idempotencyScope)"),
      requestForm.indexOf("setSuccess(true)") + "setSuccess(true)".length,
    ),
    /clearBookingFlowSiteAttribution\(window\.sessionStorage\)/,
  );
  assert.match(createRoute, /parseSiteAttribution\(body\.attribution\)/);
  assert.match(requestRoute, /parseSiteAttribution\(body\.attribution\)/);
  assert.match(appointments, /createAppointmentSiteAttribution/);
  assert.match(requests, /createBookingRequestSiteAttribution/);
  assert.match(requests, /attribution: input\.attribution/);
  assert.match(attributionService, /parseSiteAttribution\(attribution\)/);
  assert.match(appointmentContext, /mapStoredSiteAttribution/);
  assert.match(requestContext, /mapStoredSiteAttribution/);
  assert.doesNotMatch(
    requestContext.slice(
      requestContext.indexOf("const bookingRequestSelect"),
      requestContext.indexOf("const bookingRequestContextSelect"),
    ),
    /siteAttribution/,
  );
  assert.doesNotMatch(
    requestContext.slice(
      requestContext.indexOf("function toBotDto"),
      requestContext.indexOf("export async function feedBotBookingRequests"),
    ),
    /attribution/,
  );
  assert.match(
    requestContext.slice(
      requestContext.indexOf("export async function getBotBookingRequest"),
      requestContext.indexOf("function resolveRequestServiceMaster"),
    ),
    /attribution: mapStoredSiteAttribution/,
  );
  assert.doesNotMatch(
    feedTypes.slice(
      feedTypes.indexOf("export type BotBookingRequestDto"),
      feedTypes.indexOf("export type BotBookingRequestContextDto"),
    ),
    /attribution/,
  );
  assert.doesNotMatch(
    createRoute.slice(
      createRoute.indexOf("function toPublicCreatedAppointment"),
      createRoute.indexOf("function errorResponse"),
    ),
    /attribution/,
  );
  assert.doesNotMatch(publicRequestContract, /attribution/);
  assert.doesNotMatch(createRoute, /Idempotency-Key|idempotencyKey/);
  assert.match(appointments, /runSerializableWrite\(async \(tx\)/);
}

testCaptureAndNormalization();
testBookingFlowFirstTouchSession();
testCampaignRedirectSurvivesCapture();
testIdempotencyFingerprint();
testWiring();
console.log("site-attribution unit/static checks: PASSED");
