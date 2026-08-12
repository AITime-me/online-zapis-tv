import "server-only";

import { NextResponse } from "next/server";
import {
  ClosedTestUpstreamConfigError,
  readClosedTestUpstreamConfig,
} from "@/lib/bot-core/closed-test-config";
import { evaluateClosedTestAdminGate } from "@/lib/bot-core/closed-test-gate";
import { getBotSettings } from "@/services/BotSettingsService";

export async function requireClosedTestAdminAccess(): Promise<
  | { ok: true }
  | { ok: false; response: NextResponse }
> {
  const settings = await getBotSettings();
  const gate = evaluateClosedTestAdminGate(settings);
  if (!gate.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error:
            gate.code === "CLOSED_TEST_NOT_ENABLED"
              ? "Закрытый тест доступен только при активной конфигурации в режиме TEST"
              : "Закрытый тест доступен только в сохранённом режиме TEST",
          code: gate.code,
        },
        { status: 403 },
      ),
    };
  }
  return { ok: true };
}

export function resolveClosedTestUpstreamOr503():
  | { ok: true; config: ReturnType<typeof readClosedTestUpstreamConfig> }
  | { ok: false; response: NextResponse } {
  try {
    return { ok: true, config: readClosedTestUpstreamConfig() };
  } catch (error) {
    if (error instanceof ClosedTestUpstreamConfigError) {
      console.warn(`[bot-closed-test] config fail-closed: ${error.code}`);
      return {
        ok: false,
        response: NextResponse.json(
          {
            ok: false,
            error: "Closed-test upstream не настроен",
            code: error.code,
          },
          { status: 503 },
        ),
      };
    }
    console.warn("[bot-closed-test] config fail-closed: unexpected");
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: "Closed-test upstream не настроен",
          code: "CLOSED_TEST_UPSTREAM_UNCONFIGURED",
        },
        { status: 503 },
      ),
    };
  }
}
