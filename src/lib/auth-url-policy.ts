/**
 * Политика допустимых значений AUTH_URL по окружению.
 *
 * Правила:
 *   - в настоящем production (APP_ENV !== "staging") разрешён только https://;
 *   - в APP_ENV=staging разрешён http:// только для loopback-хоста
 *     (127.0.0.1, localhost, ::1) — закрытый доступ через SSH-туннель;
 *   - внешние домены и IP по HTTP запрещены всегда;
 *   - AUTH_URL всегда разбирается через new URL(), а не по префиксу строки.
 *
 * Модуль без побочных эффектов — безопасен для импорта в тестах.
 */

export type AppEnv = "development" | "staging" | "production";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

export type AuthUrlValidationResult =
  | { ok: true }
  | { ok: false; message: string };

function normalizeHostname(hostname: string): string {
  // WHATWG URL возвращает IPv6-хост в квадратных скобках: [::1]
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(normalizeHostname(hostname));
}

/**
 * Проверяет AUTH_URL для runtime-окружения.
 * appEnv — значение APP_ENV; "staging" включает loopback-HTTP исключение.
 */
export function validateAuthUrlForRuntime(
  authUrl: string,
  appEnv: AppEnv | undefined,
): AuthUrlValidationResult {
  let parsed: URL;

  try {
    parsed = new URL(authUrl);
  } catch {
    return { ok: false, message: "AUTH_URL должен быть валидным URL" };
  }

  if (parsed.protocol === "https:") {
    return { ok: true };
  }

  if (parsed.protocol === "http:") {
    if (appEnv === "staging" && isLoopbackHostname(parsed.hostname)) {
      return { ok: true };
    }

    return {
      ok: false,
      message:
        appEnv === "staging"
          ? "AUTH_URL по HTTP в staging разрешён только для loopback-адресов (127.0.0.1, localhost, ::1)"
          : "AUTH_URL должен использовать HTTPS в production",
    };
  }

  return {
    ok: false,
    message: "AUTH_URL должен использовать протокол http или https",
  };
}
