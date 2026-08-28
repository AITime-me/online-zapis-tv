/**
 * A2.3b2 trusted acquisition-source feed + context (bot internal API).
 * Feed emits consumed AcquisitionEvidence only — no PII / UTM / source_marker.
 */
import {
  ACQUISITION_SOURCE_KEYS,
  type AcquisitionSourceKey,
} from "@/lib/attribution/trusted-acquisition";

export type BotAcquisitionSourceOwnerKind = "APPOINTMENT" | "BOOKING_REQUEST";

export const BOT_ACQUISITION_SOURCE_OWNER_KINDS: readonly BotAcquisitionSourceOwnerKind[] =
  ["APPOINTMENT", "BOOKING_REQUEST"] as const;

export type BotAcquisitionSourceFeedCursor = {
  feedOrder: string;
  evidenceId: string;
};

export type BotAcquisitionSourceFeedRequest = {
  limit: number;
  cursor?: BotAcquisitionSourceFeedCursor;
};

export type BotAcquisitionSourceFeedItem = {
  evidenceId: string;
  ownerKind: BotAcquisitionSourceOwnerKind;
  ownerId: string;
  sourceKey: AcquisitionSourceKey;
  consumedAt: string;
  feedOrder: string;
};

export type BotAcquisitionSourceFeedSuccess = {
  ok: true;
  items: BotAcquisitionSourceFeedItem[];
  nextCursor: BotAcquisitionSourceFeedCursor | null;
};

export type BotAcquisitionSourceContextRequest = {
  evidenceId: string;
  ownerKind: BotAcquisitionSourceOwnerKind;
  ownerId: string;
};

export type BotAcquisitionSourceContextSuccess = {
  ok: true;
  evidenceId: string;
  ownerKind: BotAcquisitionSourceOwnerKind;
  ownerId: string;
  sourceKey: AcquisitionSourceKey;
  phoneE164: string;
};

export type BotAcquisitionSourceErrorCode =
  | "VALIDATION_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export type BotAcquisitionSourceErrorBody = {
  ok: false;
  code: BotAcquisitionSourceErrorCode;
  error: string;
};

export type ParseBotAcquisitionSourceBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "VALIDATION_ERROR"; error: string };

const FEED_KEYS = new Set(["limit", "cursor"]);
const CONTEXT_KEYS = new Set(["evidenceId", "ownerKind", "ownerId"]);

const CANONICAL_LOWERCASE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const SOURCE_KEY_SET = new Set<string>(ACQUISITION_SOURCE_KEYS);

/** Positive decimal string without leading zeros — safe for BigInt conversion. */
const CANONICAL_POSITIVE_DECIMAL = /^[1-9]\d*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalLowercaseUuid(value: string): boolean {
  return CANONICAL_LOWERCASE_UUID.test(value);
}

export function parseCanonicalPositiveDecimalString(
  value: string,
): bigint | null {
  if (!CANONICAL_POSITIVE_DECIMAL.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function formatFeedOrder(value: bigint): string {
  return value.toString();
}

function rejectUnknownFields(
  body: Record<string, unknown>,
  allowed: Set<string>,
): ParseBotAcquisitionSourceBodyResult<never> | { ok: true } {
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

export function fixedBotAcquisitionSourceErrorMessage(
  code: BotAcquisitionSourceErrorCode,
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

export function isBotAcquisitionSourceOwnerKind(
  value: string | null | undefined,
): value is BotAcquisitionSourceOwnerKind {
  return value === "APPOINTMENT" || value === "BOOKING_REQUEST";
}

export function isAcquisitionSourceWireKey(
  value: string,
): value is AcquisitionSourceKey {
  return SOURCE_KEY_SET.has(value);
}

export function parseBotAcquisitionSourceFeedBody(
  body: unknown,
): ParseBotAcquisitionSourceBodyResult<BotAcquisitionSourceFeedRequest> {
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
    !cursorKeys.includes("feedOrder") ||
    !cursorKeys.includes("evidenceId")
  ) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid cursor",
    };
  }

  const feedOrderRaw = body.cursor.feedOrder;
  const evidenceId = body.cursor.evidenceId;
  if (typeof feedOrderRaw !== "string") {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid cursor",
    };
  }
  if (parseCanonicalPositiveDecimalString(feedOrderRaw) === null) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid cursor",
    };
  }
  if (typeof evidenceId !== "string" || !isCanonicalLowercaseUuid(evidenceId)) {
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
      cursor: { feedOrder: feedOrderRaw, evidenceId },
    },
  };
}

export function parseBotAcquisitionSourceContextBody(
  body: unknown,
): ParseBotAcquisitionSourceBodyResult<BotAcquisitionSourceContextRequest> {
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

  const evidenceId = body.evidenceId;
  if (
    typeof evidenceId !== "string" ||
    !isCanonicalLowercaseUuid(evidenceId)
  ) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid evidenceId",
    };
  }

  const ownerKind = body.ownerKind;
  if (
    typeof ownerKind !== "string" ||
    !isBotAcquisitionSourceOwnerKind(ownerKind)
  ) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid ownerKind",
    };
  }

  const ownerId = body.ownerId;
  if (typeof ownerId !== "string" || !isCanonicalLowercaseUuid(ownerId)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid ownerId",
    };
  }

  return {
    ok: true,
    value: { evidenceId, ownerKind, ownerId },
  };
}

/**
 * Convert stored owner phone digits to E.164 for bot CRM identity.
 */
export function ownerPhoneToE164(
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
