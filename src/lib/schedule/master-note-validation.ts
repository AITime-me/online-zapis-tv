export const MASTER_NOTE_MAX_LENGTH = 500;

export const MASTER_NOTE_VALIDATION_ERROR =
  "В пометке для мастера нельзя указывать телефон или email.";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Российский номер: +7/8 и 10 цифр или 7/8 + 10 цифр подряд. */
const PHONE_PATTERNS = [
  /\+7[\s\-()]*(?:\d[\s\-()]*){10}/,
  /(?:^|[\s(,;:])(?:8|7)[\s\-()]*(?:\d[\s\-()]*){10}(?:$|[\s),;:.])/,
] as const;

export function containsEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

export function containsPhoneNumber(value: string): boolean {
  return PHONE_PATTERNS.some((pattern) => pattern.test(value));
}

export function validateMasterNote(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > MASTER_NOTE_MAX_LENGTH) {
    return `Пометка для мастера не может быть длиннее ${MASTER_NOTE_MAX_LENGTH} символов.`;
  }

  if (containsEmail(trimmed) || containsPhoneNumber(trimmed)) {
    return MASTER_NOTE_VALIDATION_ERROR;
  }

  return null;
}

export function normalizeMasterNote(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}
