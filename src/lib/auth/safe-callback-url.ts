/**
 * Safe post-login redirect targets: same-origin relative paths only.
 * Rejects protocol-relative, absolute, backslash, and encoded bypass attempts.
 */

export const DEFAULT_SAFE_LOGIN_CALLBACK = "/schedule";

/**
 * Returns a safe internal path for router.push / redirects, or the fallback.
 */
export function resolveSafeInternalCallbackUrl(
  raw: string | null | undefined,
  fallback: string = DEFAULT_SAFE_LOGIN_CALLBACK,
): string {
  const safeFallback = isSafeInternalCallbackPath(fallback)
    ? fallback
    : DEFAULT_SAFE_LOGIN_CALLBACK;

  if (typeof raw !== "string") {
    return safeFallback;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return safeFallback;
  }

  if (!isSafeInternalCallbackPath(trimmed)) {
    return safeFallback;
  }

  return trimmed;
}

/**
 * True only for same-app relative paths starting with a single `/`.
 */
export function isSafeInternalCallbackPath(value: string): boolean {
  if (!value || typeof value !== "string") {
    return false;
  }

  // Disallow whitespace / control characters early.
  if (/[\u0000-\u001F\u007F\s]/.test(value)) {
    return false;
  }

  // Must be a path, not scheme-relative or absolute.
  if (!value.startsWith("/")) {
    return false;
  }

  // Protocol-relative `//evil` and `/\\evil`.
  if (value.startsWith("//") || value.startsWith("/\\")) {
    return false;
  }

  // Backslashes enable some browser/path oddities.
  if (value.includes("\\")) {
    return false;
  }

  // Reject encoded separators / scheme starters before decoding loops.
  if (/%2f/i.test(value) || /%5c/i.test(value) || /%00/i.test(value)) {
    return false;
  }

  let decoded = value;
  try {
    // Decode once; repeated %2f encodings after decode are still rejected below.
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }

  if (decoded !== value) {
    if (
      decoded.includes("\\") ||
      decoded.startsWith("//") ||
      /[\u0000-\u001F\u007F]/.test(decoded)
    ) {
      return false;
    }
    // Encoded absolute or scheme after decode (e.g. /%2f%2fevil → ///evil handled;
    // javascript: via other encodings).
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) {
      return false;
    }
  }

  const lower = decoded.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    return false;
  }

  // Absolute URL mistakenly passed as path segment.
  if (/^https?:/i.test(decoded) || /^\/{2,}/.test(decoded)) {
    return false;
  }

  // Final structural check: single leading slash, no second slash immediately.
  if (!/^\/(?!\/)/.test(value)) {
    return false;
  }

  return true;
}
