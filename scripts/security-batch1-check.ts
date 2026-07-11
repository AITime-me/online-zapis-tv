import assert from "node:assert/strict";
import {
  collectForbiddenPublicBookingRequestKeys,
  toPublicBookingRequestCreateResponse,
} from "../src/lib/booking-requests/public-booking-request-contract";
import {
  assertMasterAppointmentShape,
  assertRestrictedAppointmentShape,
  collectForbiddenMasterAppointmentKeys,
  collectForbiddenViewOnlyAppointmentKeys,
} from "../src/lib/schedule/appointment-contract";
import {
  MASTER_NOTE_VALIDATION_ERROR,
  validateMasterNote,
} from "../src/lib/schedule/master-note-validation";
import { buildPromotionLabels } from "../src/lib/schedule/promotion-labels";
import {
  buildHealthErrorResponse,
  buildHealthSuccessResponse,
} from "../src/lib/health/health-response";

function runMapperTests(): void {
  const promotionLabels = buildPromotionLabels([
    { type: "DISCOUNT", label: "−30% на первое посещение", value: 30 },
    { type: "GIFT_SERVICE", label: "уход для рук", value: null },
  ]);

  assert.equal(promotionLabels.length, 2);
  assert.match(promotionLabels[0], /Акция:/);
  assert.match(promotionLabels[1], /Подарок:/);

  const master = {
    id: "appt-test-001",
    serviceId: "service-test-001",
    startsAt: "2026-07-03T09:00:00.000Z",
    endsAt: "2026-07-03T10:00:00.000Z",
    clientName: "Тест Клиент",
    serviceName: "Тестовая услуга",
    isBold: false,
    isManualTimeOverride: false,
    status: "Подтверждена",
    source: "Онлайн",
    statusCode: "CONFIRMED",
    sourceCode: "ONLINE",
    promotionLabels,
    masterNote: "Индивидуальная скидка 15% от студии",
  };

  assert.equal(collectForbiddenMasterAppointmentKeys(master).length, 0);
  assertMasterAppointmentShape(master);

  const viewOnly = {
    id: master.id,
    serviceId: master.serviceId,
    startsAt: master.startsAt,
    endsAt: master.endsAt,
    clientName: master.clientName,
    serviceName: master.serviceName,
    isBold: master.isBold,
    isManualTimeOverride: master.isManualTimeOverride,
    status: master.status,
    source: master.source,
    statusCode: master.statusCode,
    sourceCode: master.sourceCode,
  };

  assert.equal(collectForbiddenViewOnlyAppointmentKeys(viewOnly).length, 0);
  assertRestrictedAppointmentShape(viewOnly);
}

function runMasterNoteValidationTests(): void {
  assert.equal(validateMasterNote("Стоимость согласована: 3 500 ₽"), null);
  assert.equal(validateMasterNote("Индивидуальная скидка 15%"), null);
  assert.equal(validateMasterNote("Оплата по сертификату, кабинет 7"), null);

  assert.equal(
    validateMasterNote("Позвонить +7 900 123-45-67"),
    MASTER_NOTE_VALIDATION_ERROR,
  );
  assert.equal(
    validateMasterNote("Написать client@example.com"),
    MASTER_NOTE_VALIDATION_ERROR,
  );
}

function runPublicBookingRequestTests(): void {
  const response = toPublicBookingRequestCreateResponse({ id: "req-test-001" });
  assert.equal(response.ok, true);
  assert.equal(response.requestId, "req-test-001");
  assert.match(response.message, /Заявка отправлена/);

  const forbidden = collectForbiddenPublicBookingRequestKeys(
    response as unknown as Record<string, unknown>,
  );
  assert.deepEqual(forbidden, []);
}

function runHealthTests(): void {
  const success = buildHealthSuccessResponse("2026-07-06T12:00:00.000Z");
  assert.equal(success.ok, true);
  assert.equal("database" in success, false);

  const productionError = buildHealthErrorResponse(
    true,
    "2026-07-06T12:00:00.000Z",
    new Error("Can't reach database server at postgres://user:pass@db:5432/app"),
  );
  assert.equal(productionError.ok, false);
  assert.equal("detail" in productionError, false);
}

function main(): void {
  runMapperTests();
  runMasterNoteValidationTests();
  runPublicBookingRequestTests();
  runHealthTests();
  console.log("security-batch1-check: all assertions passed");
}

main();
