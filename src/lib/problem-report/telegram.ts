import "server-only";

import {
  formatProblemReportTelegramMessage,
  type ProblemReportTelegramPayload,
} from "@/lib/problem-report/telegram-message";

const TELEGRAM_TIMEOUT_MS = 4_000;

export type ProblemReportTelegramResult =
  | { ok: true; skipped: true; reason: "missing_env" }
  | { ok: true; skipped: false }
  | { ok: false; skipped: false; error: string };

export type { ProblemReportTelegramPayload };

function readTelegramConfig(): { token: string; chatId: string } | null {
  const token = process.env.PROBLEM_REPORT_TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = process.env.PROBLEM_REPORT_TELEGRAM_CHAT_ID?.trim() ?? "";
  if (!token || !chatId) {
    return null;
  }
  return { token, chatId };
}

function warnTelegramFailure(reason: string): void {
  // Никогда не логируем token, URL с token и сырой response body.
  console.warn(`[problem-report] Telegram notify failed: ${reason}`);
}

/**
 * Опциональная отправка. Ошибки сети/API не пробрасываются как fatal —
 * вызывающий код должен сохранить заявку и вернуть успех клиенту.
 */
export async function sendProblemReportTelegramNotification(
  payload: ProblemReportTelegramPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<ProblemReportTelegramResult> {
  const config = readTelegramConfig();
  if (!config) {
    console.warn(
      "[problem-report] Telegram notify skipped: PROBLEM_REPORT_TELEGRAM_BOT_TOKEN / PROBLEM_REPORT_TELEGRAM_CHAT_ID not configured",
    );
    return { ok: true, skipped: true, reason: "missing_env" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);

  try {
    const response = await fetchImpl(
      `https://api.telegram.org/bot${config.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.chatId,
          text: formatProblemReportTelegramMessage(payload),
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      warnTelegramFailure(`HTTP ${response.status}`);
      return { ok: false, skipped: false, error: `http_${response.status}` };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      warnTelegramFailure("malformed_json");
      return { ok: false, skipped: false, error: "malformed_json" };
    }

    if (
      typeof body !== "object" ||
      body === null ||
      (body as { ok?: unknown }).ok !== true
    ) {
      warnTelegramFailure("api_ok_false");
      return { ok: false, skipped: false, error: "api_ok_false" };
    }

    return { ok: true, skipped: false };
  } catch (error) {
    const isAbort =
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError");
    if (isAbort) {
      warnTelegramFailure("timeout");
      return { ok: false, skipped: false, error: "timeout" };
    }
    warnTelegramFailure("telegram_request_failed");
    return { ok: false, skipped: false, error: "telegram_request_failed" };
  } finally {
    clearTimeout(timer);
  }
}

export { formatProblemReportTelegramMessage };
