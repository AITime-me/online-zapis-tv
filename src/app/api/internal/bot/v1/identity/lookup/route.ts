import { NextResponse } from "next/server";
import { withBotInternalApi } from "@/lib/auth/bot-internal-api";
import {
  BOT_INTERNAL_MAX_JSON_BODY_BYTES,
  readBoundedJsonBody,
} from "@/lib/bot-api/bounded-json-body";
import { lookupClientIdForBotIdentity } from "@/services/BotIdentityLookupService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function invalid(code: "VALIDATION_ERROR" | "PAYLOAD_TOO_LARGE") {
  return NextResponse.json(
    { ok: false as const, code, error: code === "PAYLOAD_TOO_LARGE" ? "Payload too large" : "Invalid request" },
    { status: code === "PAYLOAD_TOO_LARGE" ? 413 : 400 },
  );
}

/**
 * POST keeps a normalized phone out of URLs and logs. The only successful
 * disclosure is an online-zapis internal client UUID to the authenticated bot.
 */
export const POST = withBotInternalApi(async (request: Request) => {
  const body = await readBoundedJsonBody(request, BOT_INTERNAL_MAX_JSON_BODY_BYTES);
  if (!body.ok) return invalid(body.code === "PAYLOAD_TOO_LARGE" ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR");
  if (
    typeof body.value !== "object" ||
    body.value === null ||
    Array.isArray(body.value) ||
    Object.keys(body.value).length !== 1 ||
    typeof (body.value as { phone?: unknown }).phone !== "string" ||
    (body.value as { phone: string }).phone.length > 32
  ) {
    return invalid("VALIDATION_ERROR");
  }

  const result = await lookupClientIdForBotIdentity(
    (body.value as { phone: string }).phone,
  );
  return NextResponse.json({ ok: true as const, ...result });
});
