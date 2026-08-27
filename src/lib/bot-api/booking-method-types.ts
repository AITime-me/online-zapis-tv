/**
 * A2.2 booking-method feed + appointment context (bot internal API).
 * Minimal durable facts only — no name / schedule details in feed.
 */

export type BotBookingMethodCreatorKind =
  | "SELF_SERVICE"
  | "MANAGER"
  | "MASTER";

export const BOT_BOOKING_METHOD_FEED_KINDS: readonly BotBookingMethodCreatorKind[] =
  ["SELF_SERVICE", "MANAGER", "MASTER"] as const;

export type BotBookingMethodFeedCursor = {
  createdAt: string;
  id: string;
};

export type BotBookingMethodFeedRequest = {
  limit: number;
  cursor?: BotBookingMethodFeedCursor;
};

export type BotBookingMethodFeedItem = {
  appointmentId: string;
  creatorKind: BotBookingMethodCreatorKind;
  createdAt: string;
};

export type BotBookingMethodFeedSuccess = {
  ok: true;
  items: BotBookingMethodFeedItem[];
  nextCursor: BotBookingMethodFeedCursor | null;
};

export type BotBookingMethodContextRequest = {
  appointmentId: string;
};

export type BotBookingMethodContextSuccess = {
  ok: true;
  appointmentId: string;
  creatorKind: BotBookingMethodCreatorKind;
  phoneE164: string;
};

export type BotBookingMethodErrorCode =
  | "VALIDATION_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export type BotBookingMethodErrorBody = {
  ok: false;
  code: BotBookingMethodErrorCode;
  error: string;
};

export type ParseBotBookingMethodBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "VALIDATION_ERROR"; error: string };

const FEED_KEYS = new Set(["limit", "cursor"]);
const CONTEXT_KEYS = new Set(["appointmentId"]);

const CANONICAL_LOWERCASE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalLowercaseUuid(value: string): boolean {
  return CANONICAL_LOWERCASE_UUID.test(value);
}

function rejectUnknownFields(
  body: Record<string, unknown>,
  allowed: Set<string>,
): ParseBotBookingMethodBodyResult<never> | { ok: true } {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        error: "Unknown field",
      };
    }
  }
  return { ok: true };
}

export function isExactApplicationJsonContentType(
  header: string | null,
): boolean {
  if (header == null) {
    return false;
  }
  const mediaType = header.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "application/json") {
    return false;
  }
  const parts = header.split(";").slice(1);
  for (const part of parts) {
    const trimmed = part.trim().toLowerCase();
    if (!trimmed) {
      continue;
    }
    if (trimmed === "charset=utf-8" || trimmed === 'charset="utf-8"') {
      continue;
    }
    return false;
  }
  return true;
}

export function fixedBotBookingMethodErrorMessage(
  code: BotBookingMethodErrorCode,
): string {
  switch (code) {
    case "VALIDATION_ERROR":
      return "Invalid request";
    case "PAYLOAD_TOO_LARGE":
      return "Payload too large";
    case "UNAUTHORIZED":
      return "Unauthorized";
    case "NOT_FOUND":
      return "Not found";
    case "INTERNAL_ERROR":
      return "Internal error";
    default:
      return "Error";
  }
}

export function parseBotBookingMethodFeedBody(
  body: unknown,
): ParseBotBookingMethodBodyResult<BotBookingMethodFeedRequest> {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request body",
    };
  }

  const unknown = rejectUnknownFields(body, FEED_KEYS);
  if (!unknown.ok) {
    return unknown;
  }

  let limit = 20;
  if (body.limit !== undefined) {
    if (
      typeof body.limit !== "number" ||
      !Number.isInteger(body.limit) ||
      body.limit < 1 ||
      body.limit > 50
    ) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        error: "Invalid limit",
      };
    }
    limit = body.limit;
  }

  if (body.cursor === undefined) {
    return { ok: true, value: { limit } };
  }

  if (!isPlainObject(body.cursor)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid cursor",
    };
  }

  const cursorKeys = Object.keys(body.cursor);
  if (
    cursorKeys.length !== 2 ||
    !cursorKeys.includes("createdAt") ||
    !cursorKeys.includes("id")
  ) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid cursor",
    };
  }

  const createdAt = body.cursor.createdAt;
  const id = body.cursor.id;
  if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid cursor",
    };
  }
  if (typeof id !== "string" || !isCanonicalLowercaseUuid(id)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid cursor",
    };
  }

  return {
    ok: true,
    value: {
      limit,
      cursor: { createdAt, id },
    },
  };
}

export function parseBotBookingMethodContextBody(
  body: unknown,
): ParseBotBookingMethodBodyResult<BotBookingMethodContextRequest> {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request body",
    };
  }

  const unknown = rejectUnknownFields(body, CONTEXT_KEYS);
  if (!unknown.ok) {
    return unknown;
  }

  const appointmentId = body.appointmentId;
  if (
    typeof appointmentId !== "string" ||
    !isCanonicalLowercaseUuid(appointmentId)
  ) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid appointmentId",
    };
  }

  return { ok: true, value: { appointmentId } };
}

export function isBotBookingMethodFeedKind(
  value: string | null | undefined,
): value is BotBookingMethodCreatorKind {
  return (
    value === "SELF_SERVICE" || value === "MANAGER" || value === "MASTER"
  );
}

/**
 * Convert stored appointment phone digits to E.164 for bot CRM identity.
 * Digits-only RU 11-digit forms become +7…; returns null when unusable.
 */
export function appointmentPhoneToE164(
  phone: string | null | undefined,
): string | null {
  if (phone == null || !phone.trim()) {
    return null;
  }
  const digits = phone.replace(/\D/g, "");
  if (!digits) {
    return null;
  }
  let normalized = digits;
  if (
    normalized.length === 11 &&
    (normalized.startsWith("7") || normalized.startsWith("8"))
  ) {
    normalized = `7${normalized.slice(1)}`;
  }
  if (normalized.length < 10 || normalized.length > 15) {
    return null;
  }
  return `+${normalized}`;
}
