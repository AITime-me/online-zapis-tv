/**
 * A2.2 booking-method feed + context static/security proofs.
 */
process.env.SECURITY_BATCH_TEST = "1";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/tvoe_vremya_security_batch";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertBotInternalRouteCoverage } from "./security-bot-internal-route-coverage-check";
import {
  appointmentPhoneToE164,
  isBotBookingMethodFeedKind,
  parseBotBookingMethodContextBody,
  parseBotBookingMethodFeedBody,
} from "../src/lib/bot-api/booking-method-types";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function testStaticWiring(): void {
  const feedRoute =
    "src/app/api/internal/bot/v1/booking-method/feed/route.ts";
  const contextRoute =
    "src/app/api/internal/bot/v1/booking-method/context/route.ts";
  const covered = assertBotInternalRouteCoverage();
  assert.ok(covered.includes(feedRoute));
  assert.ok(covered.includes(contextRoute));

  const feed = read(feedRoute);
  assert.match(feed, /withBotInternalApi/);
  assert.match(feed, /readBoundedJsonBody/);
  assert.match(feed, /parseBotBookingMethodFeedBody/);
  assert.match(feed, /feedBotBookingMethodAppointments/);
  assert.doesNotMatch(feed, /\bfetch\s*\(|\baxios\b|\bamocrm\b/i);
  assert.match(feed, /Does not call bot-TV/);

  const context = read(contextRoute);
  assert.match(context, /withBotInternalApi/);
  assert.match(context, /parseBotBookingMethodContextBody/);
  assert.match(context, /getBotBookingMethodAppointmentContext/);

  const service = read("src/services/BotBookingMethodService.ts");
  assert.match(service, /SELF_SERVICE/);
  assert.match(service, /MANAGER/);
  assert.match(service, /MASTER/);
  assert.doesNotMatch(
    service,
    /creatorKind:\s*\{\s*in:\s*\[[^\]]*TEYA/,
  );
  assert.match(service, /creatorKind:\s*\{\s*in:/);
  assert.match(service, /orderBy:\s*\[\s*\{\s*createdAt:\s*"asc"/);
  assert.match(service, /id:\s*\{\s*gt:/);
  assert.match(service, /phoneE164/);
  assert.doesNotMatch(service, /clientName/);
}

function testParsers(): void {
  const feedOk = parseBotBookingMethodFeedBody({ limit: 10 });
  assert.equal(feedOk.ok, true);
  if (feedOk.ok) {
    assert.equal(feedOk.value.limit, 10);
  }

  const feedCursor = parseBotBookingMethodFeedBody({
    limit: 5,
    cursor: {
      createdAt: "2026-08-26T12:00:00.000Z",
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    },
  });
  assert.equal(feedCursor.ok, true);

  const feedBad = parseBotBookingMethodFeedBody({ limit: 0 });
  assert.equal(feedBad.ok, false);

  const ctxOk = parseBotBookingMethodContextBody({
    appointmentId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  });
  assert.equal(ctxOk.ok, true);

  const ctxBad = parseBotBookingMethodContextBody({
    appointmentId: "NOT-A-UUID",
  });
  assert.equal(ctxBad.ok, false);
}

function testKindFilterHelpers(): void {
  assert.equal(isBotBookingMethodFeedKind("SELF_SERVICE"), true);
  assert.equal(isBotBookingMethodFeedKind("MANAGER"), true);
  assert.equal(isBotBookingMethodFeedKind("MASTER"), true);
  assert.equal(isBotBookingMethodFeedKind("TEYA"), false);
  assert.equal(isBotBookingMethodFeedKind("OTHER"), false);
  assert.equal(isBotBookingMethodFeedKind(null), false);
}

function testPhoneE164(): void {
  assert.equal(appointmentPhoneToE164("+7 (900) 111-22-33"), "+79001112233");
  assert.equal(appointmentPhoneToE164("89001112233"), "+79001112233");
  assert.equal(appointmentPhoneToE164(""), null);
}

async function main(): Promise<void> {
  testStaticWiring();
  console.log("PASSED: static-wiring");
  testParsers();
  console.log("PASSED: parsers");
  testKindFilterHelpers();
  console.log("PASSED: kind-filter");
  testPhoneE164();
  console.log("PASSED: phone-e164");
  console.log("security-bot-booking-method-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
