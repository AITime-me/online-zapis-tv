/**
 * Безопасное получение IP клиента для login-throttle.
 *
 * Без TRUST_PROXY_HEADERS=true заголовки X-Forwarded-For / X-Real-IP не доверяются:
 * клиент или промежуточный узел могут подставить произвольное значение.
 *
 * Для staging через SSH-туннель и будущего reverse proxy включите
 * TRUST_PROXY_HEADERS только когда приложение стоит за доверенным прокси,
 * который перезаписывает/нормализует эти заголовки.
 */

type HeaderLike = {
  get(name: string): string | null;
};

export function isTrustedProxyEnabled(): boolean {
  return process.env.TRUST_PROXY_HEADERS === "true";
}

function firstForwardedIp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/**
 * Возвращает IP только в trusted-proxy режиме; иначе null (IP-throttle не применяется).
 */
export function resolveTrustedClientIp(headers: HeaderLike): string | null {
  if (!isTrustedProxyEnabled()) {
    return null;
  }

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return firstForwardedIp(headers.get("x-forwarded-for"));
}
