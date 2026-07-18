import { NextResponse } from "next/server";
import {
  manageJsonResponse,
  manageUnauthorizedResponse,
} from "@/lib/booking/manage-response";
import { manageTokenRateLimitFingerprint } from "@/lib/booking/manage-token";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import { getPublicManageAppointmentByToken } from "@/services/BookingManageService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token")?.trim() ?? "";

  const rateLimitResponse = enforceRequestRateLimit(
    request,
    token ? [manageTokenRateLimitFingerprint(token)] : [],
  );
  if (rateLimitResponse) {
    const headers = new Headers(rateLimitResponse.headers);
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    headers.set("Referrer-Policy", "no-referrer");
    return new NextResponse(rateLimitResponse.body, {
      status: rateLimitResponse.status,
      headers,
    });
  }

  if (!token) {
    return manageUnauthorizedResponse();
  }

  const appointment = await getPublicManageAppointmentByToken(token);

  if (!appointment) {
    return manageUnauthorizedResponse();
  }

  return manageJsonResponse({
    ok: true,
    appointment,
  });
}
