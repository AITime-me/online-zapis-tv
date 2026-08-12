import "server-only";

import {
  BOT_CLOSED_TEST_TOKEN_HEADER,
  type ClosedTestUpstreamConfig,
} from "@/lib/bot-core/closed-test-config";
import {
  mapUpstreamStatusToAdminError,
  sanitizeClosedTestAck,
  sanitizeClosedTestStatus,
  type ClosedTestCreateInput,
  type ClosedTestEventAckDto,
  type ClosedTestEventStatusDto,
  type ClosedTestUpstreamErrorCode,
} from "@/lib/bot-core/closed-test-contract";

const UPSTREAM_TIMEOUT_MS = 8_000;

export type ClosedTestUpstreamResult<T> =
  | { ok: true; status: number; data: T }
  | {
      ok: false;
      status: number;
      code: ClosedTestUpstreamErrorCode;
      error: string;
    };

function eventsUrl(config: ClosedTestUpstreamConfig): string {
  return `${config.baseUrl}/internal/closed-test/events`;
}

function eventUrl(config: ClosedTestUpstreamConfig, eventId: string): string {
  return `${eventsUrl(config)}/${encodeURIComponent(eventId)}`;
}

function warnUpstream(reason: string): void {
  // Never log token, Authorization, or raw request/response bodies.
  console.warn(`[bot-closed-test] upstream: ${reason}`);
}

async function readJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function upstreamFetch(
  config: ClosedTestUpstreamConfig,
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      ...init,
      // Fail-closed: never follow 3xx with X-Bot-Closed-Test-Token attached.
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        [BOT_CLOSED_TEST_TOKEN_HEADER]: config.token,
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function rejectUpstreamRedirect(
  method: "POST" | "GET",
  status: number,
): ClosedTestUpstreamResult<never> {
  warnUpstream(`${method} redirect ${status} blocked`);
  return {
    ok: false,
    status: 502,
    code: "UPSTREAM_ERROR",
    error: "Ошибка ответа Bot Core closed-test",
  };
}

export async function postClosedTestEventUpstream(
  config: ClosedTestUpstreamConfig,
  input: ClosedTestCreateInput,
  fetchImpl: typeof fetch = fetch,
): Promise<ClosedTestUpstreamResult<ClosedTestEventAckDto>> {
  let response: Response;
  try {
    response = await upstreamFetch(
      config,
      eventsUrl(config),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: input.sessionId,
          request_id: input.requestId,
          text: input.text,
        }),
      },
      fetchImpl,
    );
  } catch {
    warnUpstream("POST network/timeout");
    return {
      ok: false,
      status: 503,
      code: "INGRESS_UNAVAILABLE",
      error: "Bot Core closed-test недоступен",
    };
  }

  if (isRedirectStatus(response.status)) {
    return rejectUpstreamRedirect("POST", response.status);
  }

  const body = await readJsonSafe(response);

  if (response.status === 202) {
    const ack = sanitizeClosedTestAck(body);
    if (!ack) {
      warnUpstream("POST malformed 202");
      return {
        ok: false,
        status: 502,
        code: "UPSTREAM_MALFORMED",
        error: "Некорректный ack от Bot Core",
      };
    }
    return { ok: true, status: 202, data: ack };
  }

  const mapped = mapUpstreamStatusToAdminError(response.status, body);
  warnUpstream(`POST HTTP ${response.status} → ${mapped.code}`);
  return {
    ok: false,
    status: mapped.status,
    code: mapped.code,
    error: mapped.error,
  };
}

export async function getClosedTestEventUpstream(
  config: ClosedTestUpstreamConfig,
  eventId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ClosedTestUpstreamResult<ClosedTestEventStatusDto>> {
  let response: Response;
  try {
    response = await upstreamFetch(
      config,
      eventUrl(config, eventId),
      { method: "GET" },
      fetchImpl,
    );
  } catch {
    warnUpstream("GET network/timeout");
    return {
      ok: false,
      status: 503,
      code: "INGRESS_UNAVAILABLE",
      error: "Bot Core closed-test недоступен",
    };
  }

  if (isRedirectStatus(response.status)) {
    return rejectUpstreamRedirect("GET", response.status);
  }

  const body = await readJsonSafe(response);

  if (response.status === 200) {
    const statusDto = sanitizeClosedTestStatus(body);
    if (!statusDto) {
      warnUpstream("GET malformed 200");
      return {
        ok: false,
        status: 502,
        code: "UPSTREAM_MALFORMED",
        error: "Некорректный status от Bot Core",
      };
    }
    return { ok: true, status: 200, data: statusDto };
  }

  const mapped = mapUpstreamStatusToAdminError(response.status, body);
  warnUpstream(`GET HTTP ${response.status} → ${mapped.code}`);
  return {
    ok: false,
    status: mapped.status,
    code: mapped.code,
    error: mapped.error,
  };
}
