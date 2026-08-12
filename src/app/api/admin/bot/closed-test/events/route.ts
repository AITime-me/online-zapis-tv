import { NextResponse } from "next/server";
import {
  BOT_SETTINGS_EDIT_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import {
  requireClosedTestAdminAccess,
  resolveClosedTestUpstreamOr503,
} from "@/lib/bot-core/closed-test-access";
import { postClosedTestEventUpstream } from "@/lib/bot-core/closed-test-client";
import { validateClosedTestCreateInput } from "@/lib/bot-core/closed-test-contract";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(
    BOT_SETTINGS_EDIT_ROLES,
    request,
  );
  if ("response" in authResult) {
    return authResult.response;
  }

  const gate = await requireClosedTestAdminAccess();
  if (!gate.ok) {
    return gate.response;
  }

  const upstream = resolveClosedTestUpstreamOr503();
  if (!upstream.ok) {
    return upstream.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Некорректный JSON", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const validated = validateClosedTestCreateInput({
    sessionId: record.sessionId,
    requestId: record.requestId,
    text: record.text,
  });
  if (!validated.ok) {
    return NextResponse.json(
      { ok: false, error: validated.error, code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const result = await postClosedTestEventUpstream(
    upstream.config,
    validated.value,
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json(
    { ok: true, ack: result.data },
    { status: 202 },
  );
}
