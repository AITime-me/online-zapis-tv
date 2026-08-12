import { NextResponse } from "next/server";
import {
  BOT_SETTINGS_VIEW_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import {
  requireClosedTestAdminAccess,
  resolveClosedTestUpstreamOr503,
} from "@/lib/bot-core/closed-test-access";
import { getClosedTestEventUpstream } from "@/lib/bot-core/closed-test-client";
import { isClosedTestEventId } from "@/lib/bot-core/closed-test-contract";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(BOT_SETTINGS_VIEW_ROLES);
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

  const { eventId } = await context.params;
  if (!isClosedTestEventId(eventId)) {
    return NextResponse.json(
      { ok: false, error: "Некорректный eventId", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const result = await getClosedTestEventUpstream(upstream.config, eventId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, status: result.data });
}
