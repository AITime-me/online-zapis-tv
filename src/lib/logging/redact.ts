const SENSITIVE_KEY_PATTERN =
  /(password|passwd|pwd|secret|token|cookie|authorization|auth|api[_-]?key|manage[_-]?token|schedule[_-]?view[_-]?token|database[_-]?url|session)/i;

const SENSITIVE_VALUE_PATTERNS = [
  /^Bearer\s+/i,
  /^postgresql:\/\//i,
  /^postgres:\/\//i,
];

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/;

function redactString(value: string): string {
  if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    return "[REDACTED]";
  }

  if (EMAIL_PATTERN.test(value)) {
    return "[REDACTED_EMAIL]";
  }

  if (PHONE_PATTERN.test(value) && value.replace(/\D/g, "").length >= 10) {
    return "[REDACTED_PHONE]";
  }

  return value;
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return (
    SENSITIVE_KEY_PATTERN.test(normalized) ||
    normalized.includes("phone") ||
    normalized.includes("email") ||
    normalized.includes("cookie") ||
    normalized.includes("authorization")
  );
}

export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[REDACTED_DEPTH]";
  }

  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactForLog(entry, depth + 1));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (shouldRedactKey(key)) {
        result[key] = "[REDACTED]";
        continue;
      }
      result[key] = redactForLog(entry, depth + 1);
    }
    return result;
  }

  return String(value);
}

export function safeLogError(
  scope: string,
  error: unknown,
  meta?: Record<string, unknown>,
): void {
  const payload = {
    ...(meta ? { meta: redactForLog(meta) } : {}),
    error: redactForLog(error),
  };

  if (process.env.NODE_ENV === "production") {
    console.error(`[${scope}]`, payload);
    return;
  }

  console.error(`[${scope}]`, {
    ...payload,
    stack: error instanceof Error ? error.stack : undefined,
  });
}
