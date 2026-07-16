import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  BOOKING_LEGAL_CONSENT_HREF,
  BOOKING_LEGAL_PRIVACY_HREF,
  BOOKING_LEGAL_TERMS_HREF,
} from "../src/lib/booking/legal-document-hrefs";
import {
  CLIENT_DATA_CONSENT_ERROR,
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

  const hrefsSource = readRepoFile("src/lib/booking/legal-document-hrefs.ts");
  assert.match(hrefsSource, /BOOKING_LEGAL_CONSENT_HREF\s*=\s*"\/consent"/);
  assert.match(hrefsSource, /BOOKING_LEGAL_PRIVACY_HREF\s*=\s*"\/privacy"/);
  assert.match(hrefsSource, /BOOKING_LEGAL_TERMS_HREF\s*=\s*"\/terms"/);
}

function runConsentComponentSourceTests(): void {
  const legalLinksPath = "src/components/booking/booking-legal-links.tsx";
  const source = readRepoFile(legalLinksPath);

  assert.match(
    source,
    /BOOKING_LEGAL_CONSENT_HREF/,
    `${legalLinksPath}: должна использовать маршрут согласия`,
  );
  assert.match(
    source,
    /BOOKING_LEGAL_PRIVACY_HREF/,
    `${legalLinksPath}: должна использовать маршрут политики`,
  );
  assert.match(
    source,
    /BOOKING_LEGAL_TERMS_HREF/,
    `${legalLinksPath}: должна использовать маршрут оферты`,
  );

  assert.match(
    source,
    /согласие на обработку персональных данных/,
    `${legalLinksPath}: должна быть формулировка согласия`,
  );
  assert.match(
    source,
    /политикой конфиденциальности/,
    `${legalLinksPath}: должна быть ссылка на политику`,
  );
  assert.match(
    source,
    /публичной оферты/,
    `${legalLinksPath}: должна быть ссылка на оферту`,
  );
  assert.match(
    source,
    /event\.stopPropagation\(\)/,
    `${legalLinksPath}: клик по ссылке не должен всплывать к чекбоксу`,
  );
  assert.match(
    source,
    /type=["']checkbox["']/,
    `${legalLinksPath}: должен быть чекбокс согласия`,
  );
  assert.match(
    source,
    /checked=\{checked\}/,
    `${legalLinksPath}: чекбокс контролируется снаружи (по умолчанию false)`,
  );
}

function runSharedFormUsageTests(): void {
  const clientFields = readRepoFile(
    "src/components/booking/booking-client-fields.tsx",
  );
  assert.match(
    clientFields,
    /BookingLegalConsentField/,
    "публичные поля клиента должны использовать общий компонент согласия",
  );

  const consumers = [
    "src/components/booking/booking-wizard.tsx",
    "src/components/booking/booking-manager-request-form.tsx",
    "src/components/game/procedure-gift-game.tsx",
    "src/components/game/procedure-gift-game-vanilla.tsx",
  ];

  for (const file of consumers) {
    const source = readRepoFile(file);
    assert.match(
      source,
      /BookingClientFields/,
      `${file}: публичная форма должна использовать BookingClientFields`,
    );
    assert.match(
      source,
      /consent.*false|consent:\s*false/,
      `${file}: согласие изначально не отмечено`,
    );
  }

  const homeUi = readRepoFile("src/components/home/home-ui.tsx");
  assert.match(homeUi, /BOOKING_LEGAL_CONSENT_HREF/);
  assert.match(homeUi, /BOOKING_LEGAL_PRIVACY_HREF/);
  assert.match(homeUi, /BOOKING_LEGAL_TERMS_HREF/);
}

function runLegalPagesExistTests(): void {
  for (const route of ["consent", "privacy", "terms"] as const) {
    const pagePath = path.join(ROOT, "src", "app", route, "page.tsx");
    assert.equal(
      fs.existsSync(pagePath),
      true,
      `страница /${route} должна существовать: ${pagePath}`,
    );
  }
}

function runConsentValidationTests(): void {
  assert.equal(isClientConsentGiven(false), false);
  assert.equal(isClientConsentGiven(true), true);
  assert.equal(isClientConsentGiven("true"), false);
  assert.equal(isClientConsentGiven(1), false);

  const withoutConsent = validateClientData({
    clientName: "Анна",
    clientPhone: "+79001234567",
    consent: false,
  });
  assert.equal(withoutConsent.consent, CLIENT_DATA_CONSENT_ERROR);
  assert.equal(withoutConsent.name, undefined);
  assert.equal(withoutConsent.phone, undefined);

  const withConsent = validateClientData({
    clientName: "Анна",
    clientPhone: "+79001234567",
    consent: true,
  });
  assert.equal(withConsent.consent, undefined);
}

runRouteConstantsTests();
runConsentComponentSourceTests();
runSharedFormUsageTests();
runLegalPagesExistTests();
runConsentValidationTests();

console.log("security-legal-consent-check: OK");
