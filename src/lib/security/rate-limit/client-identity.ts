import { hashRateLimitIdentity } from "./hash-key";

export function isTrustedProxyEnabled(): boolean {
  return process.env.TRUST_PROXY_HEADERS === "true";
}

type HeaderLike = {
  get(name: string): string | null;
};

function firstForwardedIp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function buildClientFingerprint(headers: HeaderLike): string {
  const userAgent = headers.get("user-agent")?.trim() ?? "unknown-ua";
  const acceptLanguage = headers.get("accept-language")?.trim() ?? "unknown-lang";
  const secChUa = headers.get("sec-ch-ua")?.trim() ?? "unknown-sec-ch-ua";

  return hashRateLimitIdentity([
    "client-fingerprint",
    userAgent,
    acceptLanguage,
    secChUa,
  ]);
}

export function resolveClientIp(headers: HeaderLike): string | null {
  if (isTrustedProxyEnabled()) {
    const realIp = headers.get("x-real-ip")?.trim();
    if (realIp) {
      return realIp;
    }

    const forwarded = firstForwardedIp(headers.get("x-forwarded-for"));
    if (forwarded) {
      return forwarded;
    }
  }

  return null;
}

export function buildIpRateLimitKey(headers: HeaderLike): string {
  const ip = resolveClientIp(headers);

  if (ip) {
    return hashRateLimitIdentity(["ip", ip]);
  }

  return buildClientFingerprint(headers);
}

export function buildLoginRateLimitKey(
  normalizedEmail: string,
  headers: HeaderLike,
): string {
  return hashRateLimitIdentity([
    "login",
    normalizedEmail,
    buildIpRateLimitKey(headers),
  ]);
}

export function buildEndpointRateLimitKey(
  policyId: string,
  headers: HeaderLike,
  extraParts: string[] = [],
): string {
  return hashRateLimitIdentity([
    policyId,
    buildIpRateLimitKey(headers),
    ...extraParts,
  ]);
}
