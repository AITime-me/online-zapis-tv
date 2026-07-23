import {
  extractPhoneDigits,
  normalizePhone,
} from "@/lib/phone/normalize-phone";

/**
 * Нормализованные placeholder/технические номера, подтверждённые продуктовым кодом.
 * Форма новой записи по умолчанию ставит +70000000000 → 70000000000.
 */
export const TECHNICAL_NORMALIZED_PHONES = new Set<string>(["70000000000"]);

/** Согласовано с публичной валидацией контактов (MIN/MAX digits). */
export const USABLE_CLIENT_PHONE_MIN_DIGITS = 10;
export const USABLE_CLIENT_PHONE_MAX_DIGITS = 15;

export type UsableClientPhoneResult =
  | { ok: true; normalized: string }
  | {
      ok: false;
      reason: "empty" | "invalid" | "technical";
    };

/**
 * Пригоден ли телефон для автосоздания/поиска CRM-клиента.
 * Не меняет семантику normalizePhone / phonesAreEquivalent.
 */
export function classifyClientPhone(
  phone: string | null | undefined,
): UsableClientPhoneResult {
  if (phone == null || !String(phone).trim()) {
    return { ok: false, reason: "empty" };
  }

  const digits = extractPhoneDigits(phone);
  if (
    digits.length < USABLE_CLIENT_PHONE_MIN_DIGITS ||
    digits.length > USABLE_CLIENT_PHONE_MAX_DIGITS
  ) {
    return { ok: false, reason: "invalid" };
  }

  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { ok: false, reason: "invalid" };
  }

  if (
    normalized.length < USABLE_CLIENT_PHONE_MIN_DIGITS ||
    normalized.length > USABLE_CLIENT_PHONE_MAX_DIGITS
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (TECHNICAL_NORMALIZED_PHONES.has(normalized)) {
    return { ok: false, reason: "technical" };
  }

  return { ok: true, normalized };
}

export function isUsableClientPhone(
  phone: string | null | undefined,
): boolean {
  return classifyClientPhone(phone).ok;
}
