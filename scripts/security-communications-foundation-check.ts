/**
 * Security / regression checks for communications foundation (VK broadcasts control plane).
 * No DB, no network, no real SaleBot dumps, no VK API calls.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  canAccessAdminPath,
  canAccessAdminSection,
  canManageCommunicationsAdmin,
} from "../src/lib/auth/permissions";
import {
  assertCanTransitionCampaignStatus,
  resolveCommunicationsConnectorState,
  COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE,
} from "../src/lib/communications/connector";
import {
  appendCampaignUtmParams,
  assertNoPiiInUrl,
  assertSafeCommCtaLink,
  isSafeCommCtaLink,
} from "../src/lib/communications/cta-link-policy";
import {
  eligibilityBlockReason,
  isEligibleForPromotionalBroadcast,
} from "../src/lib/communications/eligibility";
import {
  COMM_CHANNEL_ACCEPT_LABEL,
  COMM_READ_STATUS_LABELS,
  resolveReadStatusSemantics,
} from "../src/lib/communications/read-status";
import {
  buildPublicRedirectPath,
  buildTrackedRedirectTarget,
  generateOpaqueRedirectToken,
  hashRedirectToken,
} from "../src/lib/communications/redirect-token";
import { SYSTEM_COMMUNICATION_SEGMENTS } from "../src/lib/communications/segments";
import {
  isVkMessenger,
  normalizeVkUserId,
  parseTruthyFlag,
} from "../src/lib/communications/salebot-columns";
import { extractSingleCsvFromZip, SafeZipError } from "../src/lib/communications/safe-zip";
import { deflateRawSync } from "node:zlib";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function listFiles(relDir: string, suffix: string): string[] {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) {
    return [];
  }
  return fs
    .readdirSync(abs, { recursive: true })
    .map((entry) => `${relDir}/${String(entry).replace(/\\/g, "/")}`)
    .filter((p) => p.endsWith(suffix));
}

function assertOwnerOnlyAccess(): void {
  assert.equal(canManageCommunicationsAdmin("OWNER"), true);
  assert.equal(canManageCommunicationsAdmin("MANAGER"), false);
  assert.equal(canManageCommunicationsAdmin("MASTER"), false);
  assert.equal(canAccessAdminSection("OWNER", "communications"), true);
  assert.equal(canAccessAdminSection("MANAGER", "communications"), false);
  assert.equal(canAccessAdminPath("MANAGER", "/admin/communications"), false);
  assert.equal(canAccessAdminPath("OWNER", "/admin/communications"), true);

  const permissions = stripComments(read("src/lib/auth/permissions.ts"));
  assert.match(permissions, /\/admin\/communications/);
  assert.match(permissions, /canManageCommunicationsAdmin/);

  const apiAccess = stripComments(read("src/lib/auth/api-access.ts"));
  assert.match(apiAccess, /COMMUNICATIONS_ADMIN_ROLES:\s*UserRole\[]\s*=\s*OWNER_ROLES/);

  for (const route of listFiles("src/app/api/admin/communications", "route.ts")) {
    const src = stripComments(read(route));
    assert.match(src, /COMMUNICATIONS_ADMIN_ROLES/, `OWNER roles: ${route}`);
    assert.match(
      src,
      /requireApiRoles|requireProtectedMutatingApi/,
      `auth helper: ${route}`,
    );
  }

  const page = stripComments(read("src/app/admin/communications/page.tsx"));
  assert.match(page, /requireAdminSection\(\s*"communications"\s*\)/);
}

function assertNoVkNetworkOrSecrets(): void {
  const roots = [
    "src/lib/communications",
    "src/services/CommunicationsImportService.ts",
    "src/services/CommunicationsCampaignService.ts",
    "src/services/CommunicationsAudienceService.ts",
    "src/services/CommunicationsRedirectService.ts",
    "src/services/CommunicationsSettingsService.ts",
    "src/services/CommunicationsAnalyticsService.ts",
    "src/services/CommunicationsSegmentService.ts",
    "src/components/admin/communications-panel.tsx",
    "src/app/api/admin/communications",
    "src/app/r",
  ];

  for (const rel of roots) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      continue;
    }
    const files = fs.statSync(abs).isDirectory()
      ? listFiles(rel, ".ts").concat(listFiles(rel, ".tsx"))
      : [rel];
    for (const file of files) {
      const src = stripComments(read(file));
      assert.doesNotMatch(src, /api\.vk\.com|oauth\.vk\.com/i, file);
      assert.doesNotMatch(src, /VK_ACCESS_TOKEN|vk_service_token|access_token\s*[:=]/i, file);
      assert.doesNotMatch(src, /fetch\(\s*["']https:\/\/api\.vk/i, file);
      assert.doesNotMatch(src, /new\s+Queue|bullmq|agenda\.schedule/i, file);
    }
  }

  const connector = resolveCommunicationsConnectorState(true);
  assert.equal(connector.vkConnectorReady, false);
  assert.equal(connector.canRun, false);
  assert.equal(connector.canSchedule, false);
  assert.match(connector.message, /VK не подключён/);
  assert.equal(COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE.includes("недоступна"), true);

  assert.throws(() => assertCanTransitionCampaignStatus("SCHEDULED", connector));
  assert.throws(() => assertCanTransitionCampaignStatus("RUNNING", connector));
  assert.doesNotThrow(() => assertCanTransitionCampaignStatus("DRAFT", connector));
  assert.doesNotThrow(() => assertCanTransitionCampaignStatus("READY", connector));
}

function assertEligibilityAndSuppression(): void {
  assert.equal(
    isEligibleForPromotionalBroadcast({
      deliveryStatus: "ALLOWED",
      consentStatus: "CONFIRMED",
      isUnsubscribed: false,
      suppressed: false,
    }),
    true,
  );
  assert.equal(
    isEligibleForPromotionalBroadcast({
      deliveryStatus: "ALLOWED",
      consentStatus: "UNKNOWN",
      isUnsubscribed: false,
    }),
    false,
  );
  assert.equal(
    eligibilityBlockReason({
      deliveryStatus: "ALLOWED",
      consentStatus: "UNKNOWN",
      isUnsubscribed: false,
    }),
    "consent_not_confirmed",
  );
  assert.equal(
    isEligibleForPromotionalBroadcast({
      deliveryStatus: "ALLOWED",
      consentStatus: "CONFIRMED",
      isUnsubscribed: false,
      suppressed: true,
    }),
    false,
  );
  assert.equal(
    isEligibleForPromotionalBroadcast({
      deliveryStatus: "BLOCKED",
      consentStatus: "CONFIRMED",
      isUnsubscribed: false,
    }),
    false,
  );
  assert.equal(
    isEligibleForPromotionalBroadcast({
      deliveryStatus: "ALLOWED",
      consentStatus: "REVOKED",
      isUnsubscribed: false,
    }),
    false,
  );
}

function assertImportRulesInSource(): void {
  const importService = stripComments(
    read("src/services/CommunicationsImportService.ts"),
  );
  assert.match(importService, /SALEBOT_IMPORT/);
  assert.match(importService, /BLOCKED/);
  assert.match(importService, /REVOKED/);
  assert.match(importService, /communicationSuppression/);
  assert.match(importService, /Никогда не создаём Client|clientId:\s*existing\?\.clientId/);
  assert.doesNotMatch(importService, /prisma\.client\.create/);
  assert.match(importService, /void cell\(raw,\s*map\.phone\)/);
  assert.match(importService, /void cell\(raw,\s*map\.email\)/);

  assert.equal(isVkMessenger("VK"), true);
  assert.equal(isVkMessenger("Telegram"), false);
  assert.equal(normalizeVkUserId("123456"), "123456");
  assert.equal(normalizeVkUserId("abc"), null);
  assert.equal(parseTruthyFlag("true"), true);
  assert.equal(parseTruthyFlag("0"), false);

  // Synthetic ZIP with one CSV (no real SaleBot dump).
  const csv = Buffer.from(
    "Имя;Мессенджер;Идентификатор внутри мессенджера;clientBlocked;notSubscribed\nИван;VK;10001;false;false\n",
    "utf8",
  );
  const compressed = deflateRawSync(csv);
  const fileName = Buffer.from("fake-salebot.csv", "utf8");
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(8, 8); // deflate
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(csv.length, 22);
  localHeader.writeUInt16LE(fileName.length, 26);
  localHeader.writeUInt16LE(0, 28);
  const zip = Buffer.concat([localHeader, fileName, compressed]);
  const extracted = extractSingleCsvFromZip(zip);
  assert.match(extracted.csvText, /Иван/);
  assert.equal(extracted.fileName, "fake-salebot.csv");

  assert.throws(() => {
    const evilName = Buffer.from("../evil.csv", "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(csv.length, 18);
    header.writeUInt32LE(csv.length, 22);
    header.writeUInt16LE(evilName.length, 26);
    extractSingleCsvFromZip(Buffer.concat([header, evilName, csv]));
  }, SafeZipError);
}

function assertCtaAndRedirectSafety(): void {
  assert.equal(isSafeCommCtaLink("/booking"), true);
  assert.equal(isSafeCommCtaLink("https://example.com/x"), true);
  assert.equal(isSafeCommCtaLink("http://example.com"), false);
  assert.equal(isSafeCommCtaLink("javascript:alert(1)"), false);
  assert.equal(isSafeCommCtaLink("//evil.com"), false);
  assert.equal(isSafeCommCtaLink("data:text/html,hi"), false);
  assert.throws(() => assertSafeCommCtaLink("javascript:alert(1)"));

  const tracked = buildTrackedRedirectTarget({
    targetUrl: "/booking",
    campaignSlug: "cold-plasma-intro",
    buttonKey: "book",
  });
  assert.match(tracked, /utm_source=vk/);
  assert.match(tracked, /utm_medium=messenger/);
  assert.match(tracked, /utm_campaign=cold-plasma-intro/);
  assert.match(tracked, /utm_content=book/);
  assert.doesNotMatch(tracked, /vk_user_id|phone=|email=/i);
  assertNoPiiInUrl(tracked);

  const token = generateOpaqueRedirectToken();
  assert.ok(token.length >= 32);
  assert.equal(hashRedirectToken(token).length, 64);
  assert.equal(buildPublicRedirectPath(token), `/r/${token}`);
  assert.doesNotMatch(buildPublicRedirectPath(token), /phone|email|vk_user/i);

  const redirectRoute = stripComments(read("src/app/r/[token]/route.ts"));
  assert.match(redirectRoute, /resolveRedirectToken/);
  assert.doesNotMatch(redirectRoute, /channelUserId|phone|email/);
}

function assertButtonsAndReadSemantics(): void {
  const campaign = stripComments(
    read("src/services/CommunicationsCampaignService.ts"),
  );
  assert.match(campaign, /REPLY_TEXT/);
  assert.match(campaign, /CALLBACK/);
  assert.match(campaign, /OPEN_LINK/);
  assert.match(campaign, /UNSUBSCRIBE/);
  assert.match(campaign, /PRIMARY|POSITIVE|NEGATIVE|SECONDARY/);

  assert.equal(COMM_CHANNEL_ACCEPT_LABEL, "Принято VK");
  assert.equal(
    resolveReadStatusSemantics(false).label,
    COMM_READ_STATUS_LABELS.read_not_confirmed,
  );
  assert.doesNotMatch(
    resolveReadStatusSemantics(false).label,
    /^Не прочитано$/,
  );
  assert.equal(
    resolveReadStatusSemantics(true).label,
    "Прочтение подтверждено",
  );

  const panel = read("src/components/admin/communications-panel.tsx");
  assert.match(panel, /Принято VK|Статус прочтения не подтверждён|Ответили/);
  assert.match(panel, /COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE/);
  const composer = read("src/components/admin/communications-composer.tsx");
  assert.match(composer, /VK не подключён|Реальная отправка сообщений недоступна|COMMUNICATIONS_VK_NOT_CONNECTED|bannerMessage/);
}

function assertNoRealDataInSeedAndTests(): void {
  const seedPlan = read("prisma/lib/production-seed-plan.ts");
  assert.match(seedPlan, /CommunicationSettings/);
  assert.doesNotMatch(seedPlan, /CommunicationContact|CampaignRecipient|salebot/i);

  const seedProd = read("prisma/seed.production.ts");
  assert.doesNotMatch(seedProd, /channelUserId|SALEBOT|vk\.com\/id/i);
  assert.match(seedProd, /CommunicationSettings|seedCommunication/i);

  const thisFile = read("scripts/security-communications-foundation-check.ts");
  assert.doesNotMatch(thisFile, /\b9\d{8,}\b/); // no realistic phone-looking dumps
  assert.match(thisFile, /fake-salebot|Synthetic ZIP|вымышлен/i);

  assert.ok(SYSTEM_COMMUNICATION_SEGMENTS.length >= 7);
  assert.ok(
    SYSTEM_COMMUNICATION_SEGMENTS.some((s) => s.key === "vk_available_all"),
  );
  assert.ok(
    SYSTEM_COMMUNICATION_SEGMENTS.some((s) => s.key === "cold_plasma_interest"),
  );
}

function assertSchemaUniquenessAndFoundation(): void {
  const schema = read("prisma/schema.prisma");
  assert.match(
    schema,
    /@@unique\(\[channel,\s*communityId,\s*channelUserId\]\)/,
  );
  assert.match(schema, /model CommunicationContact/);
  assert.match(schema, /model CommunicationSuppression/);
  assert.match(schema, /model CommunicationCampaign/);
  assert.match(schema, /model CommunicationRedirectToken/);
  assert.doesNotMatch(
    schema,
    /model CommunicationContact[\s\S]*phone\s+String/,
  );
  assert.doesNotMatch(
    schema,
    /model CommunicationContact[\s\S]*email\s+String/,
  );

  const migration = read(
    "prisma/migrations/20260716120000_communications_foundation/migration.sql",
  );
  assert.match(migration, /communication_contacts/);
  assert.doesNotMatch(migration, /INSERT INTO "communication_contacts"/);
}

function main(): void {
  assertOwnerOnlyAccess();
  assertNoVkNetworkOrSecrets();
  assertEligibilityAndSuppression();
  assertImportRulesInSource();
  assertCtaAndRedirectSafety();
  assertButtonsAndReadSemantics();
  assertNoRealDataInSeedAndTests();
  assertSchemaUniquenessAndFoundation();

  // UTM helper smoke
  const withUtm = appendCampaignUtmParams("https://example.com/path", {
    campaignSlug: "demo",
    buttonKey: "cta1",
  });
  assert.match(withUtm, /utm_campaign=demo/);

  console.log("security-communications-foundation-check: OK");
}

main();
