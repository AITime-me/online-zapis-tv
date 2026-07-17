import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  LEGAL_DOCUMENT_SEED_METADATA,
  REQUIRED_PUBLISHED_LEGAL_SLUGS,
  SYSTEM_LEGAL_DOCUMENT_SLUGS,
} from "../src/lib/legal-document/defaults";

const ROOT = path.resolve(__dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertNoFinalLegalTextsInSeed(): void {
  const defaults = read("src/lib/legal-document/defaults.ts");
  assert.match(defaults, /LEGAL_DOCUMENT_SEED_METADATA/);
  assert.doesNotMatch(defaults, /serializeLegalDocumentContent/);
  assert.doesNotMatch(defaults, /from \"@\/content\/legal/);
  assert.doesNotMatch(defaults, /ИНН 450144605881/);
  assert.doesNotMatch(defaults, /Настоящим я даю согласие/);

  const prodSeed = read("prisma/seed.production.ts");
  assert.match(prodSeed, /LEGAL_DOCUMENT_SEED_METADATA/);
  assert.match(prodSeed, /isPublished:\s*false/);
  assert.match(prodSeed, /content:\s*""/);
  assert.doesNotMatch(prodSeed, /isPublished:\s*true/);
  assert.doesNotMatch(prodSeed, /ИНН 450144605881/);

  const contentDir = path.join(ROOT, "src", "content", "legal");
  if (fs.existsSync(contentDir)) {
    const files = fs.readdirSync(contentDir);
    assert.equal(
      files.filter((f) => f.endsWith(".ts") || f.endsWith(".md")).length,
      0,
      "src/content/legal не должен содержать тексты документов",
    );
  }

  assert.equal(LEGAL_DOCUMENT_SEED_METADATA.length, SYSTEM_LEGAL_DOCUMENT_SLUGS.length);
  for (const item of LEGAL_DOCUMENT_SEED_METADATA) {
    assert.ok(!("content" in item));
    assert.ok(!("isPublished" in item));
  }
}

function assertVersioningArchitecture(): void {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model LegalDocumentVersion/);
  assert.match(schema, /model LegalAcceptanceRecord/);
  assert.match(schema, /enum LegalDocumentVersionStatus/);
  assert.match(schema, /PERSONAL_DATA_CONSENT/);
  assert.match(schema, /OFFER_ACKNOWLEDGEMENT/);
  assert.match(schema, /MARKETING_CONSENT/);
  assert.match(schema, /currentPublishedVersionId/);

  const migration = read(
    "prisma/migrations/20260717180000_legal_document_versions_and_acceptances/migration.sql",
  );
  assert.match(migration, /legal_document_versions/);
  assert.match(migration, /legal_acceptance_records/);
  assert.match(migration, /Backfill v1|backfill/i);

  const service = read("src/services/LegalDocumentService.ts");
  assert.match(service, /getPublishedLegalDocument/);
  assert.match(service, /currentPublishedVersion/);
  assert.match(service, /publishLegalDocumentDraft/);
  assert.match(service, /saveLegalDocumentDraft/);
  assert.match(service, /ARCHIVED/);
  assert.match(service, /getLegalDocumentsReadiness/);
  assert.match(service, /assertRequiredLegalDocumentsPublished/);
  assert.match(service, /content: version\.content/);
  assert.match(service, /currentPublishedVersion/);
  assert.doesNotMatch(service, /return mapPublicDocument\(row\)/);
  assert.doesNotMatch(service, /row\.isPublished/);

  const loadPublished = read("src/lib/legal-document/load-published.ts");
  assert.match(loadPublished, /getPublishedLegalDocument/);
}

function assertAcceptanceAtomic(): void {
  const acceptance = read("src/services/LegalAcceptanceService.ts");
  assert.match(acceptance, /recordRequiredPublicFormAcceptances/);
  assert.match(acceptance, /PERSONAL_DATA_CONSENT/);
  assert.match(acceptance, /OFFER_ACKNOWLEDGEMENT/);
  assert.match(acceptance, /Не пишет MARKETING_CONSENT/);
  assert.doesNotMatch(acceptance, /acceptanceType:\s*"MARKETING_CONSENT"/);
  assert.doesNotMatch(acceptance, /clientPhone|User-Agent|userAgent/);

  const bookingRequest = read("src/services/BookingRequestService.ts");
  assert.match(bookingRequest, /recordRequiredPublicFormAcceptances/);
  assert.match(bookingRequest, /assertRequiredLegalDocumentsPublished/);
  assert.match(bookingRequest, /personalDataConsent/);
  assert.match(bookingRequest, /offerAcknowledgement/);

  const appointment = read("src/services/AppointmentService.ts");
  assert.match(appointment, /recordRequiredPublicFormAcceptances/);
  assert.match(appointment, /ONLINE_BOOKING/);

  const bookingService = read("src/services/BookingService.ts");
  assert.match(bookingService, /assertRequiredLegalDocumentsPublished/);
}

function assertDualConsentUiAndApi(): void {
  const legalLinks = read("src/components/booking/booking-legal-links.tsx");
  assert.match(legalLinks, /BookingLegalConsentFields/);
  assert.doesNotMatch(
    legalLinks,
    /Я даю[\s\S]*политикой конфиденциальности[\s\S]*и принимаю условия[\s\S]*публичной оферты/,
  );

  const createRoute = read("src/app/api/booking/create/route.ts");
  assert.match(createRoute, /personalDataConsent/);
  assert.match(createRoute, /offerAcknowledgement/);
  assert.match(createRoute, /LEGAL_DOCUMENTS_NOT_READY/);

  const requestRoute = read("src/app/api/booking/request/route.ts");
  assert.match(requestRoute, /personalDataConsent/);
  assert.match(requestRoute, /offerAcknowledgement/);

  const legacy = read("public/poimay-game/js/booking-api.js");
  assert.doesNotMatch(legacy, /consent:\s*data\.consent\s*!==\s*false/);
  assert.match(legacy, /personalDataConsent\s*===\s*true/);
  assert.match(legacy, /offerAcknowledgement\s*===\s*true/);
  assert.match(legacy, /consent_required/);
}

function assertMarketingNotConfirmed(): void {
  const forms = [
    "src/components/booking/booking-wizard.tsx",
    "src/components/booking/booking-manager-request-form.tsx",
    "src/components/game/procedure-gift-game.tsx",
    "src/components/game/procedure-gift-game-vanilla.tsx",
  ];
  for (const file of forms) {
    const source = read(file);
    assert.doesNotMatch(source, /MARKETING_CONSENT|marketingConsent|CONFIRMED/);
  }
}

function assertReadinessAndRules(): void {
  assert.deepEqual([...REQUIRED_PUBLISHED_LEGAL_SLUGS], [
    "privacy",
    "consent",
    "terms",
    "offer",
    "cookies",
    "promotions-game-rules",
  ]);
  assert.ok(SYSTEM_LEGAL_DOCUMENT_SLUGS.includes("marketing-consent"));
  assert.ok(!REQUIRED_PUBLISHED_LEGAL_SLUGS.includes("marketing-consent" as never));

  assert.equal(
    fs.existsSync(path.join(ROOT, "src/app/rules/promotions-game/page.tsx")),
    true,
  );
  const panel = read("src/components/admin/legal-documents-panel.tsx");
  assert.match(panel, /Readiness/);
  assert.match(panel, /hasCodeFallback|Code fallback/);

  const editor = read("src/components/admin/legal-document-editor.tsx");
  assert.match(editor, /Опубликовать версию/);
  assert.match(editor, /Сохранить черновик/);
  assert.match(editor, /create-draft-from-published|Создать черновик/);
}

function assertOwnerOnlyAdmin(): void {
  const adminPage = read("src/app/admin/settings/legal/page.tsx");
  assert.match(adminPage, /requireAdminSection\("system-settings"\)/);
  const api = read("src/app/api/admin/legal-documents/[slug]/route.ts");
  assert.match(api, /SYSTEM_SETTINGS_ADMIN_ROLES/);
}

function assertUntouchedAreas(): void {
  const promo = read("src/lib/promo/promo-engine.ts");
  assert.ok(promo.length > 0);
  const connector = read("src/lib/communications/connector.ts");
  assert.match(connector, /vkConnectorReady:\s*false|false/);
}

assertNoFinalLegalTextsInSeed();
assertVersioningArchitecture();
assertAcceptanceAtomic();
assertDualConsentUiAndApi();
assertMarketingNotConfirmed();
assertReadinessAndRules();
assertOwnerOnlyAdmin();
assertUntouchedAreas();

console.log("security-legal-versioning-check: OK");
