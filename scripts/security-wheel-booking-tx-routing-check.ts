import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertWheelSessionPhoneMatches,
  formatBookingClientPhoneFromNormalizedKey,
} from "../src/lib/game/wheel/wheel-public-session-phone";
import { hashParticipantPhone } from "../src/lib/game/wheel/participant-phone-hash";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertLegalReadinessUsesInjectableDb(): void {
  const source = read("src/services/LegalDocumentService.ts");
  assert.match(source, /export async function getLegalDocumentsReadiness\(\s*db:/);
  assert.match(source, /await ensureSystemDocumentsExist\(db\)/);
  assert.match(source, /await db\.legalDocument\.findMany/);
  assert.match(
    source,
    /export async function assertRequiredLegalDocumentsPublished\(\s*db:/,
  );
}

function assertClientLinkUsesInjectableDb(): void {
  const source = read("src/services/ClientLinkService.ts");
  assert.match(source, /db\?: DbClient/);
  assert.match(source, /resolveDb\(db\)\.client\.findMany/);
  assert.match(source, /findClientsByPhone\([\s\S]*db: DbClient/);
  assert.match(source, /resolveClientForLead[\s\S]*const db = resolveDb\(input\.db\)/);
}

function assertBookingRequestPassesDbThroughCompleteFlow(): void {
  const booking = read("src/services/BookingRequestService.ts");
  assert.match(booking, /await assertRequiredLegalDocumentsPublished\(input\.db\)/);
  assert.match(booking, /resolveClientForLead\([\s\S]*db: tx/);
  assert.match(booking, /db: input\.db/);

  const wheel = read("src/services/WheelPublicGameService.ts");
  assert.match(wheel, /clientPhone: phoneCheck\.bookingPhone/);
  assert.doesNotMatch(wheel, /clientPhone: phoneCheck\.canonicalPhone/);
}

function assertPgProofUsesSessionCookie(): void {
  const proof = read("scripts/security-wheel-public-complete-db-check.ts");
  assert.match(proof, /buildCatalogSessionCookieName/);
  assert.match(proof, /wheelCompleteRequest/);
  assert.match(proof, /Cookie:/);
  assert.doesNotMatch(proof, /PG proof SKIP/);
  assert.match(proof, /nextVersionNumber/);
  assert.doesNotMatch(proof, /vkUrl:\s*null/);
}

function assertWheelPhoneBookingFormat(): void {
  const formatted = formatBookingClientPhoneFromNormalizedKey("79991234567");
  assert.equal(formatted, "+79991234567");

  const catalogId = "00000000-0000-4000-8000-000000000001";
  const env = {
    NODE_ENV: "test",
    AUTH_SECRET: "test-auth-secret-16chars-min",
  } as NodeJS.ProcessEnv;
  const canonicalPhone = "79991234567";
  const participantPhoneHash = hashParticipantPhone({
    normalizedPhone: canonicalPhone,
    gameCatalogId: catalogId,
    campaignKeySnapshot: "permanent-wheel",
    env,
  });

  const match = assertWheelSessionPhoneMatches({
    participantPhoneHash,
    campaignKeySnapshot: "permanent-wheel",
    gameCatalogId: catalogId,
    phone: "8 (999) 123-45-67",
    env,
  });
  assert.equal(match.ok, true);
  if (match.ok) {
    assert.equal(match.canonicalPhone, canonicalPhone);
    assert.equal(match.bookingPhone, "+79991234567");
    assert.match(match.bookingPhone, /^\+\d+$/);
  }
}

function main(): void {
  assertLegalReadinessUsesInjectableDb();
  assertClientLinkUsesInjectableDb();
  assertBookingRequestPassesDbThroughCompleteFlow();
  assertPgProofUsesSessionCookie();
  assertWheelPhoneBookingFormat();
  console.log("security-wheel-booking-tx-routing-check: OK");
}

main();
