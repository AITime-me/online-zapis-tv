/**
 * Security checks for communications campaign composer upgrade.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  COMM_BUTTON_STYLE_UI_LABELS,
  COMM_BUTTON_TYPE_UI_LABELS,
  COMM_PREVIEW_DISCLAIMER,
  COMM_TEST_SEND_BLOCKED_REASON,
  STUDIO_TIMEZONE,
  VK_MAX_MESSAGE_BUTTONS,
} from "../src/lib/communications/composer-labels";
import {
  assertCanTransitionCampaignStatus,
  resolveCommunicationsConnectorState,
} from "../src/lib/communications/connector";
import {
  DisabledCommunicationDeliveryProvider,
  getCommunicationDeliveryProvider,
  resetCommunicationDeliveryProvider,
  VK_CONNECTOR_NOT_READY,
} from "../src/lib/communications/delivery-provider";
import {
  assertAllowedImageUpload,
  CommMediaValidationError,
  detectImageMimeFromMagic,
} from "../src/lib/communications/media-validation";
import {
  assertNotInPast,
  attributionDaysToHours,
  parseStudioLocalDateTime,
} from "../src/lib/communications/schedule";
import {
  assertNoPiiInTechnicalKey,
  generateButtonKey,
  generateCampaignSlug,
  generateUniqueCampaignSlug,
} from "../src/lib/communications/slug-and-keys";
import { isEligibleForPromotionalBroadcast } from "../src/lib/communications/eligibility";
import { isSafeCommCtaLink } from "../src/lib/communications/cta-link-policy";
import { validateCampaignForComposer } from "../src/lib/communications/campaign-validation";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function assertLabelsAndAutoKeys(): void {
  assert.equal(COMM_BUTTON_STYLE_UI_LABELS.PRIMARY, "Основная");
  assert.equal(COMM_BUTTON_STYLE_UI_LABELS.POSITIVE, "Акцентная");
  assert.equal(COMM_BUTTON_STYLE_UI_LABELS.NEGATIVE, "Отписка");
  assert.equal(COMM_BUTTON_STYLE_UI_LABELS.SECONDARY, "Нейтральная");
  assert.equal(COMM_BUTTON_TYPE_UI_LABELS.REPLY_TEXT, "Ответить сообщением");
  assert.equal(COMM_BUTTON_TYPE_UI_LABELS.OPEN_LINK, "Открыть страницу");
  assert.equal(COMM_BUTTON_TYPE_UI_LABELS.CALLBACK, "Передать действие боту");
  assert.equal(COMM_BUTTON_TYPE_UI_LABELS.UNSUBSCRIBE, "Отписаться");

  const slug = generateCampaignSlug("Холодная плазма — рассказ");
  assert.match(slug, /^[a-z0-9-]+$/);
  assert.doesNotMatch(slug, /phone|email|@/);
  const unique = generateUniqueCampaignSlug("Акция", ["aktsiya"]);
  assert.equal(unique, "aktsiya-2");

  const key = generateButtonKey({
    type: "OPEN_LINK",
    text: "Выбрать время",
    existingKeys: [],
    index: 0,
  });
  assert.match(key, /open-link/);
  assert.doesNotMatch(key, /phone|email/);
  assert.throws(() => assertNoPiiInTechnicalKey("phone-79001234567"));

  const composer = read("src/components/admin/communications-composer.tsx");
  assert.match(composer, /COMM_BUTTON_STYLE_UI_LABELS/);
  assert.match(composer, /COMM_BUTTON_TYPE_UI_LABELS/);
  assert.match(composer, /Ответить сообщением|COMM_BUTTON_TYPE_UI_LABELS/);
  assert.doesNotMatch(composer, /Slug кампании/);
  assert.doesNotMatch(composer, /labelClass}>buttonKey|Название.*buttonKey/);
  assert.match(composer, /type === \"OPEN_LINK\"/);
  assert.match(composer, /COMM_PREVIEW_DISCLAIMER/);
  assert.match(composer, /COMM_TEST_SEND_BLOCKED_REASON/);
  assert.equal(VK_MAX_MESSAGE_BUTTONS, 10);
}

function assertMediaSafety(): void {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.equal(detectImageMimeFromMagic(jpeg), "image/jpeg");
  assert.equal(assertAllowedImageUpload({ buffer: jpeg, declaredMime: "image/jpeg" }), "image/jpeg");

  const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
  assert.throws(
    () => assertAllowedImageUpload({ buffer: svg, fileName: "x.svg" }),
    CommMediaValidationError,
  );

  const huge = Buffer.alloc(6 * 1024 * 1024, 0xff);
  huge[0] = 0xff;
  huge[1] = 0xd8;
  huge[2] = 0xff;
  assert.throws(
    () => assertAllowedImageUpload({ buffer: huge, declaredMime: "image/jpeg" }),
    CommMediaValidationError,
  );

  const mediaService = stripComments(read("src/services/CommunicationsMediaService.ts"));
  assert.match(mediaService, /sharp/);
  assert.match(mediaService, /rotate\(/);
  assert.doesNotMatch(mediaService, /fetch\(/);
}

function assertProviderAndLaunchGuards(): void {
  resetCommunicationDeliveryProvider();
  const provider = getCommunicationDeliveryProvider();
  assert.ok(provider instanceof DisabledCommunicationDeliveryProvider);
  assert.equal(provider.getReadiness().ready, false);

  const connector = resolveCommunicationsConnectorState(true, true);
  assert.equal(connector.vkConnectorReady, false);
  assert.equal(connector.canTestSend, false);
  assert.throws(() => assertCanTransitionCampaignStatus("RUNNING", connector));
  assert.throws(() => assertCanTransitionCampaignStatus("SCHEDULED", connector));

  const campaignService = stripComments(
    read("src/services/CommunicationsCampaignService.ts"),
  );
  assert.match(campaignService, /isTest:\s*true/);
  assert.match(campaignService, /requestTestSend/);
  assert.match(campaignService, /communicationDeliveryAttempt\.create/);
  assert.doesNotMatch(
    campaignService.replace(/requestTestSend[\s\S]*?^}/m, ""),
    /stats:\s*\{/,
  );
  assert.match(campaignService, /generateUniqueCampaignSlug|generateButtonKey/);
}

function assertScheduleTimezone(): void {
  assert.equal(STUDIO_TIMEZONE, "Asia/Yekaterinburg");
  const dt = parseStudioLocalDateTime({ date: "2030-01-15", time: "12:00" });
  assert.ok(dt instanceof Date);
  assert.doesNotThrow(() => assertNotInPast(new Date(Date.now() + 3600_000)));
  assert.throws(() => assertNotInPast(new Date(Date.now() - 3600_000)));
  assert.equal(attributionDaysToHours(7), 168);

  assert.equal(
    isEligibleForPromotionalBroadcast({
      deliveryStatus: "ALLOWED",
      consentStatus: "CONFIRMED",
      isUnsubscribed: false,
      suppressed: true,
    }),
    false,
  );
}

function assertValidationAndCta(): void {
  assert.equal(isSafeCommCtaLink("/booking"), true);
  assert.equal(isSafeCommCtaLink("javascript:alert(1)"), false);

  const result = validateCampaignForComposer({
    name: "Тест",
    messageText: "Текст",
    segmentId: "seg",
    mediaAssetId: null,
    imageUrl: null,
    sendMode: "NOW",
    scheduledAt: null,
    eligibleCount: 0,
    buttons: [
      { text: "Ссылка", type: "OPEN_LINK", url: "javascript:alert(1)" },
      { text: "Бот", type: "CALLBACK" },
    ],
    callbackSupported: false,
  });
  assert.equal(result.canMarkReady, false);
  assert.ok(result.issues.some((i) => i.code === "IMAGE_REQUIRED"));
  assert.ok(result.issues.some((i) => i.code.startsWith("BUTTON_URL")));
  assert.ok(result.issues.some((i) => i.code.startsWith("BUTTON_CALLBACK")));
  assert.ok(result.issues.some((i) => i.code === "NO_ELIGIBLE"));
}

function assertSchemaAndDocs(): void {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model CommunicationMediaAsset/);
  assert.match(schema, /model CommunicationDeliveryAttempt/);
  assert.match(schema, /mediaAssetId|media_asset_id/);
  assert.match(schema, /testContactId|test_contact_id/);
  assert.match(schema, /workerReady|worker_ready/);

  const migration = read(
    "prisma/migrations/20260716220000_communications_composer/migration.sql",
  );
  assert.match(migration, /communication_media_assets/);
  assert.doesNotMatch(migration, /INSERT INTO/);

  const doc = read("docs/architecture/communications-composer.md");
  assert.match(doc, /PostgreSQL|BYTEA|лимит/i);
  assert.match(doc, /DisabledCommunicationDeliveryProvider/);
}

async function assertProviderNoNetwork(): Promise<void> {
  const provider = new DisabledCommunicationDeliveryProvider();
  const result = await provider.sendTestMessage({
    campaignId: "c1",
    contactId: "u1",
    messageText: "hi",
    buttons: [],
    isTest: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorCode, VK_CONNECTOR_NOT_READY);
  }
}

async function main(): Promise<void> {
  assertLabelsAndAutoKeys();
  assertMediaSafety();
  assertProviderAndLaunchGuards();
  assertScheduleTimezone();
  assertValidationAndCta();
  assertSchemaAndDocs();
  await assertProviderNoNetwork();
  console.log("security-communications-composer-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
