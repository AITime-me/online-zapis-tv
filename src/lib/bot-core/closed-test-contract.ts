/**
 * Shared closed-test types + safe projection helpers (no secrets).
 * Usable from server proxy and admin UI.
 */

const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;
const EVENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SAFE_SYNTHETIC_RESULT_KEYS = new Set([
  "schema",
  "source_schema",
  "plan_type",
  "synthetic_token",
  "booking_action",
  "booking_reason",
  "booking_available_date_keys",
  "booking_studio_today",
  "booking_offered_slot_ids",
  "booking_offered_slots",
]);

const OUTBOUND_TERMINAL = new Set([
  "DELIVERED",
  "DEAD",
  "CANCELLED",
  "FAILED",
]);

const INGRESS_TERMINAL = new Set(["DEAD"]);

export type ClosedTestCreateInput = {
  sessionId: string;
  requestId: string;
  text: string;
};

export type ClosedTestEventAckDto = {
  accepted: boolean;
  duplicate: boolean;
  eventId: string;
  status: string;
  correlationId: string;
};

export type ClosedTestStageIngressDto = {
  status: string;
  channel: "synthetic";
};

export type ClosedTestStageInboundDto = {
  present: true;
  processingStatus: string;
};

export type ClosedTestStageReplyPlanDto = {
  present: true;
  replyPlanId: string;
  status: string;
  contextVersion: number;
};

export type ClosedTestStageOutboundDto = {
  present: true;
  destinationType: "SYNTHETIC_OUTBOUND";
  deliveryStatus: string;
  outboundId: string;
};

export type ClosedTestSyntheticResultDto = {
  schema: "synthetic.outbound.v1";
  syntheticToken?: string;
  sourceSchema?: string;
  planType?: string;
  bookingAction?: unknown;
  bookingReason?: unknown;
  bookingAvailableDateKeys?: unknown;
  bookingStudioToday?: unknown;
  bookingOfferedSlotIds?: unknown;
  bookingOfferedSlots?: unknown;
};

export type ClosedTestEventStatusDto = {
  eventId: string;
  correlationId: string;
  ingress: ClosedTestStageIngressDto;
  inbound: ClosedTestStageInboundDto | null;
  replyPlan: ClosedTestStageReplyPlanDto | null;
  outbound: ClosedTestStageOutboundDto | null;
  syntheticResult: ClosedTestSyntheticResultDto | null;
  pipelineTerminal: boolean;
  pipelineOutcome: "running" | "delivered" | "failed";
};

export type ClosedTestUpstreamErrorCode =
  | "VALIDATION_ERROR"
  | "IDEMPOTENCY_CONFLICT"
  | "NOT_FOUND"
  | "INGRESS_UNAVAILABLE"
  | "UPSTREAM_UNAUTHORIZED"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_MALFORMED";

export function isSafeClosedTestId(value: string): boolean {
  return value.length >= 1 && value.length <= 128 && SAFE_ID_RE.test(value);
}

export function isClosedTestEventId(value: string): boolean {
  return EVENT_ID_RE.test(value);
}

export function validateClosedTestCreateInput(input: {
  sessionId?: unknown;
  requestId?: unknown;
  text?: unknown;
}):
  | { ok: true; value: ClosedTestCreateInput }
  | { ok: false; error: string } {
  if (
    typeof input.sessionId !== "string" ||
    !isSafeClosedTestId(input.sessionId)
  ) {
    return { ok: false, error: "Некорректный sessionId" };
  }
  if (
    typeof input.requestId !== "string" ||
    !isSafeClosedTestId(input.requestId)
  ) {
    return { ok: false, error: "Некорректный requestId" };
  }
  if (typeof input.text !== "string") {
    return { ok: false, error: "Текст обязателен" };
  }
  const text = input.text.trim();
  if (text.length < 1 || text.length > 2000) {
    return { ok: false, error: "Текст должен быть от 1 до 2000 символов" };
  }
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 && text[i] !== "\t" && text[i] !== "\n" && text[i] !== "\r") {
      return { ok: false, error: "Текст содержит недопустимые символы" };
    }
  }
  return {
    ok: true,
    value: {
      sessionId: input.sessionId,
      requestId: input.requestId,
      text,
    },
  };
}

export function projectSafeSyntheticResult(
  payload: unknown,
): ClosedTestSyntheticResultDto | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.schema !== "synthetic.outbound.v1") {
    return null;
  }

  const out: ClosedTestSyntheticResultDto = {
    schema: "synthetic.outbound.v1",
  };

  const mapKey = (
    snake: string,
    camel: keyof ClosedTestSyntheticResultDto,
  ): void => {
    if (!(snake in record) || !SAFE_SYNTHETIC_RESULT_KEYS.has(snake)) {
      return;
    }
    const value = record[snake];
    if (value === undefined) {
      return;
    }
    (out as Record<string, unknown>)[camel] = value;
  };

  mapKey("synthetic_token", "syntheticToken");
  mapKey("source_schema", "sourceSchema");
  mapKey("plan_type", "planType");
  mapKey("booking_action", "bookingAction");
  mapKey("booking_reason", "bookingReason");
  mapKey("booking_available_date_keys", "bookingAvailableDateKeys");
  mapKey("booking_studio_today", "bookingStudioToday");
  mapKey("booking_offered_slot_ids", "bookingOfferedSlotIds");
  mapKey("booking_offered_slots", "bookingOfferedSlots");

  return out;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asUuidString(value: unknown): string | null {
  if (typeof value === "string" && isClosedTestEventId(value)) {
    return value;
  }
  return null;
}

export function deriveClosedTestPipelineOutcome(status: {
  ingress: { status: string };
  outbound: { deliveryStatus: string } | null;
}): {
  pipelineTerminal: boolean;
  pipelineOutcome: "running" | "delivered" | "failed";
} {
  const delivery = status.outbound?.deliveryStatus ?? null;
  if (delivery === "DELIVERED") {
    return { pipelineTerminal: true, pipelineOutcome: "delivered" };
  }
  if (delivery && OUTBOUND_TERMINAL.has(delivery)) {
    return { pipelineTerminal: true, pipelineOutcome: "failed" };
  }
  if (INGRESS_TERMINAL.has(status.ingress.status)) {
    return { pipelineTerminal: true, pipelineOutcome: "failed" };
  }
  return { pipelineTerminal: false, pipelineOutcome: "running" };
}

export function sanitizeClosedTestAck(raw: unknown): ClosedTestEventAckDto | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const eventId = asUuidString(record.event_id);
  const correlationId = asUuidString(record.correlation_id);
  const status = asNonEmptyString(record.status);
  if (
    typeof record.accepted !== "boolean" ||
    typeof record.duplicate !== "boolean" ||
    !eventId ||
    !correlationId ||
    !status
  ) {
    return null;
  }
  return {
    accepted: record.accepted,
    duplicate: record.duplicate,
    eventId,
    status,
    correlationId,
  };
}

export function sanitizeClosedTestStatus(
  raw: unknown,
): ClosedTestEventStatusDto | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const eventId = asUuidString(record.event_id);
  const correlationId = asUuidString(record.correlation_id);
  const ingressRaw = record.ingress;
  if (
    !eventId ||
    !correlationId ||
    !ingressRaw ||
    typeof ingressRaw !== "object" ||
    Array.isArray(ingressRaw)
  ) {
    return null;
  }
  const ingressRecord = ingressRaw as Record<string, unknown>;
  const ingressStatus = asNonEmptyString(ingressRecord.status);
  if (!ingressStatus || ingressRecord.channel !== "synthetic") {
    return null;
  }

  let inbound: ClosedTestStageInboundDto | null = null;
  if (record.inbound && typeof record.inbound === "object" && !Array.isArray(record.inbound)) {
    const inboundRecord = record.inbound as Record<string, unknown>;
    const processingStatus = asNonEmptyString(inboundRecord.processing_status);
    if (processingStatus) {
      inbound = { present: true, processingStatus };
    }
  }

  let replyPlan: ClosedTestStageReplyPlanDto | null = null;
  if (
    record.reply_plan &&
    typeof record.reply_plan === "object" &&
    !Array.isArray(record.reply_plan)
  ) {
    const plan = record.reply_plan as Record<string, unknown>;
    const replyPlanId = asUuidString(plan.reply_plan_id);
    const planStatus = asNonEmptyString(plan.status);
    if (
      replyPlanId &&
      planStatus &&
      typeof plan.context_version === "number" &&
      Number.isInteger(plan.context_version)
    ) {
      replyPlan = {
        present: true,
        replyPlanId,
        status: planStatus,
        contextVersion: plan.context_version,
      };
    }
  }

  let outbound: ClosedTestStageOutboundDto | null = null;
  if (
    record.outbound &&
    typeof record.outbound === "object" &&
    !Array.isArray(record.outbound)
  ) {
    const out = record.outbound as Record<string, unknown>;
    const outboundId = asUuidString(out.outbound_id);
    const deliveryStatus = asNonEmptyString(out.delivery_status);
    if (
      outboundId &&
      deliveryStatus &&
      out.destination_type === "SYNTHETIC_OUTBOUND"
    ) {
      outbound = {
        present: true,
        destinationType: "SYNTHETIC_OUTBOUND",
        deliveryStatus,
        outboundId,
      };
    }
  }

  const base = {
    ingress: { status: ingressStatus, channel: "synthetic" as const },
    outbound,
  };
  const derived = deriveClosedTestPipelineOutcome(base);

  return {
    eventId,
    correlationId,
    ingress: base.ingress,
    inbound,
    replyPlan,
    outbound,
    syntheticResult: projectSafeSyntheticResult(record.synthetic_result),
    pipelineTerminal: derived.pipelineTerminal,
    pipelineOutcome: derived.pipelineOutcome,
  };
}

export function mapUpstreamStatusToAdminError(
  status: number,
  detail: unknown,
): { status: number; code: ClosedTestUpstreamErrorCode; error: string } {
  const detailCode =
    typeof detail === "string"
      ? detail
      : detail &&
          typeof detail === "object" &&
          !Array.isArray(detail) &&
          typeof (detail as { detail?: unknown }).detail === "string"
        ? ((detail as { detail: string }).detail)
        : null;

  if (status === 422 || detailCode === "VALIDATION_ERROR") {
    return {
      status: 422,
      code: "VALIDATION_ERROR",
      error: "Bot Core отклонил запрос (валидация)",
    };
  }
  if (status === 409 || detailCode === "IDEMPOTENCY_CONFLICT") {
    return {
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      error: "Конфликт идемпотентности closed-test",
    };
  }
  if (status === 404 || detailCode === "NOT_FOUND") {
    return {
      status: 404,
      code: "NOT_FOUND",
      error: "Событие closed-test не найдено",
    };
  }
  if (status === 503 || detailCode === "INGRESS_UNAVAILABLE") {
    return {
      status: 503,
      code: "INGRESS_UNAVAILABLE",
      error: "Ingress Bot Core временно недоступен",
    };
  }
  if (status === 401 || detailCode === "UNAUTHORIZED") {
    return {
      status: 503,
      code: "UPSTREAM_UNAUTHORIZED",
      error: "Closed-test upstream недоступен",
    };
  }
  return {
    status: 502,
    code: "UPSTREAM_ERROR",
    error: "Ошибка ответа Bot Core closed-test",
  };
}
