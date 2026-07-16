import { NextResponse } from "next/server";
import {
  CommunicationsRedirectValidationError,
  resolveRedirectToken,
} from "@/services/CommunicationsRedirectService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ token: string }>;
};

/**
 * Публичный безопасный redirect без PII в URL.
 * Не зависит от VK. Повторные переходы учитываются отдельно.
 */
export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const origin = new URL(request.url).origin;

  try {
    const resolved = await resolveRedirectToken(token);
    const target = resolved.targetPath.startsWith("http")
      ? resolved.targetPath
      : new URL(resolved.targetPath, origin).toString();
    return NextResponse.redirect(target, 302);
  } catch (error) {
    if (error instanceof CommunicationsRedirectValidationError) {
      return NextResponse.redirect(new URL("/", origin), 302);
    }
    return NextResponse.json({ ok: false, error: "Redirect error" }, { status: 500 });
  }
}
