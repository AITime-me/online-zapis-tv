/**
 * Static security audit: manager booking requests preserve selected service.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildBookingIdempotencyPayload,
  computeIdempotencyPayloadHash,
} from "../src/lib/booking-requests/idempotency-server";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertSchemaAndMigration(): void {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model BookingRequest \{[\s\S]*serviceId\s+String\?/);
  assert.match(schema, /serviceNameSnapshot\s+String\?/);
  assert.match(schema, /service\s+Service\?\s+@relation/);

  const migration = read(
    "prisma/migrations/20260718120000_booking_request_service/migration.sql",
  );
  assert.match(migration, /service_id/);
  assert.match(migration, /service_name_snapshot/);
  assert.match(migration, /REFERENCES "services"/);
}

function assertApiAndServiceValidation(): void {
  const route = read("src/app/api/booking/request/route.ts");
  assert.match(route, /serviceId/);
  assert.doesNotMatch(route, /serviceName:\s*body/);

  const service = read("src/services/BookingRequestService.ts");
  assert.match(service, /resolveRequestedService/);
  assert.match(service, /isCanonicalUuid/);
  assert.match(service, /masterService\.findUnique/);
  assert.match(service, /Услуга недоступна/);
  assert.match(service, /Выбранная услуга недоступна у этого мастера/);
  assert.match(service, /serviceNameSnapshot/);
  assert.match(service, /serviceId: resolvedService\?\.serviceId/);

  const resolveStart = service.indexOf("async function resolveRequestedService");
  const resolveEnd = service.indexOf(
    "const bookingRequestInclude",
    resolveStart,
  );
  assert.ok(resolveStart >= 0 && resolveEnd > resolveStart);
  const resolveBody = service.slice(resolveStart, resolveEnd);
  assert.doesNotMatch(resolveBody, /publicName:\s*input/);
  assert.match(resolveBody, /service\.publicName/);
}

function assertIdempotencyIncludesService(): void {
  const left = computeIdempotencyPayloadHash(
    buildBookingIdempotencyPayload({
      clientName: "Test Client",
      clientPhone: "+79991234567",
      type: "MANAGER_REQUEST",
      comment: null,
      masterId: "11111111-1111-4111-8111-111111111111",
      serviceId: "22222222-2222-4222-8222-222222222222",
      personalDataConsent: true,
      offerAcknowledgement: true,
      gamePlayId: null,
      gameSessionId: null,
    }),
  );
  const right = computeIdempotencyPayloadHash(
    buildBookingIdempotencyPayload({
      clientName: "Test Client",
      clientPhone: "+79991234567",
      type: "MANAGER_REQUEST",
      comment: null,
      masterId: "11111111-1111-4111-8111-111111111111",
      serviceId: null,
      personalDataConsent: true,
      offerAcknowledgement: true,
      gamePlayId: null,
      gameSessionId: null,
    }),
  );
  assert.notEqual(left, right, "serviceId must change idempotency hash");

  const source = read("src/lib/booking-requests/idempotency-server.ts");
  assert.match(source, /serviceId: payload\.serviceId/);
}

function assertUiPassesAndDisplaysService(): void {
  const wizard = read("src/components/booking/booking-wizard.tsx");
  assert.match(wizard, /service:\s*\{\s*id:\s*service\.id/);
  assert.match(wizard, /service=\{requestForm\?\.service\}/);

  const form = read("src/components/booking/booking-manager-request-form.tsx");
  assert.match(form, /serviceId:\s*service\?\.id/);
  assert.match(form, /Процедура:\s*\{service\.publicName\}/);
  assert.match(form, /service\?\.id \?\? "none"/);
  assert.doesNotMatch(form, /comment:.*service\.publicName/);

  const panel = read("src/components/admin/booking-requests-panel.tsx");
  assert.match(panel, /Процедура/);
  assert.match(panel, /serviceNameSnapshot/);

  const schedule = read("src/components/schedule/schedule-booking-request-card.tsx");
  assert.match(schedule, /Процедура/);
  assert.match(schedule, /serviceNameSnapshot/);

  const contract = read("src/lib/booking-requests/booking-request-contract.ts");
  assert.match(contract, /serviceNameSnapshot: string \| null/);

  const scheduleContract = read("src/lib/schedule/booking-request-schedule.ts");
  assert.match(scheduleContract, /serviceNameSnapshot: string \| null/);
}

function assertLegacyNullSafe(): void {
  const panel = read("src/components/admin/booking-requests-panel.tsx");
  assert.match(panel, /serviceNameSnapshot \?\? "—"/);

  const map = read("src/services/BookingRequestService.ts");
  assert.match(map, /serviceNameSnapshot: request\.serviceNameSnapshot \?\? null/);
}

function run(): void {
  assertSchemaAndMigration();
  assertApiAndServiceValidation();
  assertIdempotencyIncludesService();
  assertUiPassesAndDisplaysService();
  assertLegacyNullSafe();
  console.log("security-booking-request-service-check: OK");
}

run();
