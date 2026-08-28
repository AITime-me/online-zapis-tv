/**
 * A2.3b2 acquisition-source feed + context static/security proofs.
 */
process.env.SECURITY_BATCH_TEST = "1";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/tvoe_vremya_security_batch";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertBotInternalRouteCoverage } from "./security-bot-internal-route-coverage-check";
import {
  isAcquisitionSourceWireKey,
  isBotAcquisitionSourceOwnerKind,
  ownerPhoneToE164,
  parseBotAcquisitionSourceContextBody,
  parseBotAcquisitionSourceFeedBody,
} from "../src/lib/bot-api/acquisition-source-types";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function testStaticWiring(): void {
  const feedRoute =
    "src/app/api/internal/bot/v1/acquisition-source/feed/route.ts";
  const contextRoute =
    "src/app/api/internal/bot/v1/acquisition-source/context/route.ts";
  const covered = assertBotInternalRouteCoverage();
  assert.ok(covered.includes(feedRoute));
  assert.ok(covered.includes(contextRoute));

  const feed = read(feedRoute);
  assert.match(feed, /withBotInternalApi/);
  assert.match(feed, /readBoundedJsonBody/);
  assert.match(feed, /parseBotAcquisitionSourceFeedBody/);
  assert.match(feed, /feedBotAcquisitionSourceEvidence/);
  assert.doesNotMatch(feed, /\bfetch\s*\(|\baxios\b|\bamocrm\b/i);
  assert.match(feed, /Does not call bot-TV/);

  const context = read(contextRoute);
  assert.match(context, /withBotInternalApi/);
  assert.match(context, /parseBotAcquisitionSourceContextBody/);
  assert.match(context, /getBotAcquisitionSourceContext/);

  const service = read("src/services/BotAcquisitionSourceService.ts");
  assert.match(service, /acquisitionEvidence/);
  assert.match(service, /sourceKey/);
  assert.doesNotMatch(service, /\bsiteAttribution\b|\bmapStoredSiteAttribution\b/);
  assert.doesNotMatch(service, /source_marker\s*:/);
  assert.match(service, /feedOrder/);
  assert.match(service, /orderBy:\s*\[\s*\{\s*feedOrder:\s*"asc"/);
  assert.match(service, /id:\s*\{\s*gt:/);
  assert.doesNotMatch(service, /cursor\.consumedAt/);
  assert.doesNotMatch(service, /feedOrderAt/);
  assert.match(service, /phoneE164/);
  assert.doesNotMatch(service, /clientName/);

  const migration = read(
    "prisma/migrations/20260828120000_acquisition_source_feed_index/migration.sql",
  );
  assert.match(migration, /acquisition_evidence_feed_order_idx/);
  assert.match(migration, /WHERE "feed_order" IS NOT NULL/);
  assert.match(migration, /"last_order" BIGINT/);
  assert.match(migration, /acquisition_evidence_feed_order_clock/);
}

function testParsers(): void {
  const feedOk = parseBotAcquisitionSourceFeedBody({ limit: 10 });
  assert.equal(feedOk.ok, true);
  if (feedOk.ok) {
    assert.equal(feedOk.value.limit, 10);
  }

  const feedCursor = parseBotAcquisitionSourceFeedBody({
    limit: 5,
    cursor: {
      feedOrder: "42",
      evidenceId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    },
  });
  assert.equal(feedCursor.ok, true);

  const feedCursorBad = parseBotAcquisitionSourceFeedBody({
    limit: 5,
    cursor: {
      feedOrder: "01",
      evidenceId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    },
  });
  assert.equal(feedCursorBad.ok, false);

  const feedBad = parseBotAcquisitionSourceFeedBody({ limit: 0 });
  assert.equal(feedBad.ok, false);

  const ctxOk = parseBotAcquisitionSourceContextBody({
    evidenceId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    ownerKind: "APPOINTMENT",
    ownerId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
  });
  assert.equal(ctxOk.ok, true);

  const ctxBad = parseBotAcquisitionSourceContextBody({
    evidenceId: "NOT-A-UUID",
    ownerKind: "APPOINTMENT",
    ownerId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
  });
  assert.equal(ctxBad.ok, false);
}

function testHelpers(): void {
  assert.equal(isBotAcquisitionSourceOwnerKind("APPOINTMENT"), true);
  assert.equal(isBotAcquisitionSourceOwnerKind("BOOKING_REQUEST"), true);
  assert.equal(isBotAcquisitionSourceOwnerKind("TEYA"), false);
  assert.equal(isAcquisitionSourceWireKey("VK_ADS"), true);
  assert.equal(isAcquisitionSourceWireKey("SITE"), false);
  assert.equal(ownerPhoneToE164("+7 (900) 111-22-33"), "+79001112233");
}

async function main(): Promise<void> {
  testStaticWiring();
  console.log("PASSED: static-wiring");
  testParsers();
  console.log("PASSED: parsers");
  testHelpers();
  console.log("PASSED: helpers");
  console.log("security-bot-acquisition-source-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
