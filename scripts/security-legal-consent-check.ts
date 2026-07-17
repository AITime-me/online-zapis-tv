import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  BOOKING_LEGAL_CONSENT_HREF,
  BOOKING_LEGAL_PRIVACY_HREF,
  BOOKING_LEGAL_TERMS_HREF,
} from "../src/lib/booking/legal-document-hrefs";
import {
  CLIENT_DATA_OFFER_ACK_ERROR,
  CLIENT_DATA_PERSONAL_CONSENT_ERROR,
  isClientConsentGiven,
  validateClientData,
} from "../src/lib/booking/client-validation";

const ROOT = path.resolve(__dirname, "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function runRouteConstantsTests(): void {
  assert.equal(BOOKING_LEGAL_CONSENT_HREF, "/consent");
  assert.equal(BOOKING_LEGAL_PRIVACY_HREF, "/privacy");
  assert.equal(BOOKING_LEGAL_TERMS_HREF, "/terms");
}

function runConsentComponentSourceTests(): void {
  const legalLinksPath = "src/components/booking/booking-legal-links.tsx";
  const source = readRepoFile(legalLinksPath);

  assert.match(source, /BookingLegalConsentFields/);
  assert.match(source, /Даю/);
  assert.match(source, /согласие на обработку персональных данных/);
  assert.match(source, /политикой обработки персональных данных|политикой/);
  assert.match(source, /Ознакомился\(ась\) с условиями записи/);
  assert.match(source, /публичной офертой/);
  assert.match(source, /заявкой на бронирование/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.equal(
    (source.match(/LegalCheckboxField/g) ?? []).length >= 2,
    true,
    "должны быть два чекбокса",
  );
}

function runSharedFormUsageTests(): void {
  const clientFields = readRepoFile(
    "src/components/booking/booking-client-fields.tsx",
  );
  assert.match(clientFields, /BookingLegalConsentFields/);
  assert.match(clientFields, /personalDataConsent/);
  assert.match(clientFields, /offerAcknowledgement/);

  const consumers = [
    "src/components/booking/booking-wizard.tsx",
    "src/components/booking/booking-manager-request-form.tsx",
    "src/components/game/procedure-gift-game.tsx",
    "src/components/game/procedure-gift-game-vanilla.tsx",
  ];

  for (const file of consumers) {
    const source = readRepoFile(file);
    assert.match(source, /BookingClientFields/);
    assert.match(source, /personalDataConsent.*false|personalDataConsent:\s*false/);
    assert.match(source, /offerAcknowledgement.*false|offerAcknowledgement:\s*false/);
    assert.doesNotMatch(
      source,
      /consent:\s*false(?![\s\S]*personalDataConsent)/,
    );
  }
}

function runLegalPagesExistTests(): void {
  for (const route of ["consent", "privacy", "terms"] as const) {
    const pagePath = path.join(ROOT, "src", "app", route, "page.tsx");
    assert.equal(fs.existsSync(pagePath), true, `страница /${route}`);
  }
}

function runConsentValidationTests(): void {
  assert.equal(isClientConsentGiven(false), false);
  assert.equal(isClientConsentGiven(true), true);
  assert.equal(isClientConsentGiven("true"), false);

  const withoutConsent = validateClientData({
    clientName: "Анна",
    clientPhone: "+79001234567",
    personalDataConsent: false,
    offerAcknowledgement: true,
  });
  assert.equal(withoutConsent.personalDataConsent, CLIENT_DATA_PERSONAL_CONSENT_ERROR);
  assert.equal(withoutConsent.offerAcknowledgement, undefined);

  const withoutOffer = validateClientData({
    clientName: "Анна",
    clientPhone: "+79001234567",
    personalDataConsent: true,
    offerAcknowledgement: false,
  });
  assert.equal(withoutOffer.offerAcknowledgement, CLIENT_DATA_OFFER_ACK_ERROR);

  const withBoth = validateClientData({
    clientName: "Анна",
    clientPhone: "+79001234567",
    personalDataConsent: true,
    offerAcknowledgement: true,
  });
  assert.equal(withBoth.personalDataConsent, undefined);
  assert.equal(withBoth.offerAcknowledgement, undefined);
}

runRouteConstantsTests();
runConsentComponentSourceTests();
runSharedFormUsageTests();
runLegalPagesExistTests();
runConsentValidationTests();

console.log("security-legal-consent-check: OK");
