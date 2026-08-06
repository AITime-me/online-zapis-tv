/**
 * Server-issued bot slot id codec (CURSOR-21 / CURSOR-24).
 * Deterministic, unsigned reference — never trust as availability proof.
 */

import { isValidDateKey } from "@/lib/datetime/date-layer";

export const BOT_SLOT_ID_PREFIX = "bs1";

const CANONICAL_LOWERCASE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const STRICT_HHMM = /^([01]\d|2[0-3])([0-5]\d)$/;

export type BotSlotIdParts = Readonly<{
  version: typeof BOT_SLOT_ID_PREFIX;
  serviceId: string;
  masterId: string;
  dateKey: string;
  startTime: string;
}>;

export type ParseBotSlotIdResult =
  | { ok: true; value: BotSlotIdParts }
  | { ok: false; error: "SLOT_INVALID" };

function isCanonicalLowercaseUuid(value: string): boolean {
  return value.length === 36 && CANONICAL_LOWERCASE_UUID.test(value);
}

/**
 * Opaque stable slot id — deterministic over canonical service/master/date/time.
 * Never includes PII, tokens, or randomness.
 */
export function buildBotSlotId(input: {
  serviceId: string;
  masterId: string;
  dateKey: string;
  startTime: string;
}): string {
  const hhmm = input.startTime.replace(":", "");
  return [
    BOT_SLOT_ID_PREFIX,
    input.serviceId,
    input.masterId,
    input.dateKey,
    hhmm,
  ].join(".");
}

/**
 * Strict parser — rejects whitespace, non-canonical UUIDs, bad dates/times.
 * Does not normalize malformed input.
 */
export function parseBotSlotId(raw: unknown): ParseBotSlotIdResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "SLOT_INVALID" };
  }

  if (raw.length === 0 || /\s/.test(raw)) {
    return { ok: false, error: "SLOT_INVALID" };
  }

  const parts = raw.split(".");
  if (parts.length !== 5) {
    return { ok: false, error: "SLOT_INVALID" };
  }

  const [version, serviceId, masterId, dateKey, hhmm] = parts;

  if (version !== BOT_SLOT_ID_PREFIX) {
    return { ok: false, error: "SLOT_INVALID" };
  }

  if (
    typeof serviceId !== "string" ||
    typeof masterId !== "string" ||
    typeof dateKey !== "string" ||
    typeof hhmm !== "string"
  ) {
    return { ok: false, error: "SLOT_INVALID" };
  }

  if (!isCanonicalLowercaseUuid(serviceId) || !isCanonicalLowercaseUuid(masterId)) {
    return { ok: false, error: "SLOT_INVALID" };
  }

  if (!isValidDateKey(dateKey)) {
    return { ok: false, error: "SLOT_INVALID" };
  }

  if (!STRICT_HHMM.test(hhmm)) {
    return { ok: false, error: "SLOT_INVALID" };
  }

  const startTime = `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;

  return {
    ok: true,
    value: Object.freeze({
      version: BOT_SLOT_ID_PREFIX,
      serviceId,
      masterId,
      dateKey,
      startTime,
    }),
  };
}
