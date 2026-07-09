/**
 * Нормализация телефона для поиска и сравнения клиентов.
 * Российские номера приводятся к единому виду (7 + 10 цифр при 11-значном формате).
 * Иностранные номера не переписываются — только извлекаются цифры.
 */

export function extractPhoneDigits(phone: string | null | undefined): string {
  if (!phone?.trim()) {
    return "";
  }
  return phone.replace(/\D/g, "");
}

export function normalizePhone(
  phone: string | null | undefined,
): string | null {
  const digits = extractPhoneDigits(phone);
  if (!digits) {
    return null;
  }

  if (
    digits.length === 11 &&
    (digits.startsWith("7") || digits.startsWith("8"))
  ) {
    return `7${digits.slice(1)}`;
  }

  return digits;
}

export function getPhoneMatchSuffix(
  phone: string | null | undefined,
): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 10) {
    return null;
  }
  return normalized.slice(-10);
}

export function phonesAreEquivalent(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = normalizePhone(left);
  const normalizedRight = normalizePhone(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  if (normalizedLeft.length >= 10 && normalizedRight.length >= 10) {
    return normalizedLeft.slice(-10) === normalizedRight.slice(-10);
  }

  return false;
}
