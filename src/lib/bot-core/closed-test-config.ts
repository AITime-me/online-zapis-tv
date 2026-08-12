import "server-only";

/**
 * Server-only upstream config for Bot Core closed-test (BOT-CLOSED-TEST-01B).
 * Token never appears in logs, client bundles, or API responses.
 */

export const BOT_CLOSED_TEST_TOKEN_HEADER = "X-Bot-Closed-Test-Token";

const TOKEN_MIN = 32;
const TOKEN_MAX = 256;

export type ClosedTestUpstreamConfig = {
  baseUrl: string;
  token: string;
};

export type ClosedTestConfigErrorCode =
  | "CLOSED_TEST_UPSTREAM_UNCONFIGURED"
  | "CLOSED_TEST_UPSTREAM_URL_INVALID"
  | "CLOSED_TEST_UPSTREAM_TOKEN_INVALID";

export class ClosedTestUpstreamConfigError extends Error {
  readonly code: ClosedTestConfigErrorCode;

  constructor(code: ClosedTestConfigErrorCode) {
    super(code);
    this.name = "ClosedTestUpstreamConfigError";
    this.code = code;
  }
}

function isStrongToken(value: string): boolean {
  if (value.length < TOKEN_MIN || value.length > TOKEN_MAX) {
    return false;
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127 || /\s/.test(value[i]!)) {
      return false;
    }
  }
  return true;
}

export function normalizeClosedTestBaseUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  if (parsed.search || parsed.hash) {
    return null;
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

/**
 * Fail-closed reader. Missing/invalid → throw (routes map to 503).
 * Never embeds the token in the error message.
 */
export function readClosedTestUpstreamConfig(
  env: NodeJS.ProcessEnv = process.env,
): ClosedTestUpstreamConfig {
  const urlRaw = env.BOT_CORE_INTERNAL_URL;
  const tokenRaw = env.BOT_CLOSED_TEST_TOKEN;

  if (
    urlRaw === undefined ||
    urlRaw.trim() === "" ||
    tokenRaw === undefined ||
    tokenRaw.trim() === ""
  ) {
    throw new ClosedTestUpstreamConfigError("CLOSED_TEST_UPSTREAM_UNCONFIGURED");
  }

  const baseUrl = normalizeClosedTestBaseUrl(urlRaw);
  if (!baseUrl) {
    throw new ClosedTestUpstreamConfigError("CLOSED_TEST_UPSTREAM_URL_INVALID");
  }

  const token = tokenRaw.trim();
  if (!isStrongToken(token)) {
    throw new ClosedTestUpstreamConfigError("CLOSED_TEST_UPSTREAM_TOKEN_INVALID");
  }

  return { baseUrl, token };
}
