/**
 * Client must never supply prize/sector identifiers for wheel results.
 * Extends catch-time forbidden gift activation keys.
 */

import {
  FORBIDDEN_CLIENT_GIFT_ACTIVATION_KEYS,
  collectForbiddenClientGiftActivationKeys,
} from "@/lib/game/gift-activation";

export const FORBIDDEN_CLIENT_WHEEL_RESULT_KEYS = [
  ...FORBIDDEN_CLIENT_GIFT_ACTIVATION_KEYS,
  "prizeId",
  "sectorId",
  "sectorIndex",
  "prizeSystemKey",
  "serverAssignment",
  "originalPrize",
  "finalPrize",
] as const;

export function collectForbiddenClientWheelResultKeys(
  body: Record<string, unknown>,
): string[] {
  const base = collectForbiddenClientGiftActivationFields(body);
  const wheel = FORBIDDEN_CLIENT_WHEEL_RESULT_KEYS.filter(
    (key) =>
      !(FORBIDDEN_CLIENT_GIFT_ACTIVATION_KEYS as readonly string[]).includes(
        key,
      ) && key in body,
  );
  return [...base, ...wheel];
}

function collectForbiddenClientGiftActivationFields(
  body: Record<string, unknown>,
): string[] {
  return collectForbiddenClientGiftActivationKeys(body);
}

export function rejectForbiddenClientWheelResultFields(
  body: unknown,
): { ok: true } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: true };
  }
  const forbidden = collectForbiddenClientWheelResultKeys(
    body as Record<string, unknown>,
  );
  if (forbidden.length === 0) {
    return { ok: true };
  }
  return { ok: false, error: `${forbidden[0]} не поддерживается` };
}

/**
 * Complete for wheel must not accept a client-chosen sector/prize.
 * Idempotent complete returns the persisted assignment result only.
 */
export function assertCompleteUsesServerWheelAssignment(input: {
  clientSectorIndex: unknown;
  clientPrizeId: unknown;
  clientGiftId: unknown;
  serverSectorIndex: number;
  serverGiftId: string;
}): { ok: true } | { ok: false; error: string } {
  if (input.clientSectorIndex !== undefined) {
    return { ok: false, error: "sectorIndex не поддерживается" };
  }
  if (input.clientPrizeId !== undefined) {
    return { ok: false, error: "prizeId не поддерживается" };
  }
  if (input.clientGiftId !== undefined) {
    return { ok: false, error: "giftId не поддерживается" };
  }
  if (
    typeof input.serverSectorIndex !== "number" ||
    !Number.isInteger(input.serverSectorIndex) ||
    input.serverSectorIndex < 0
  ) {
    return { ok: false, error: "Серверное назначение сектора недоступно" };
  }
  if (!input.serverGiftId) {
    return { ok: false, error: "Серверное назначение приза недоступно" };
  }
  return { ok: true };
}
