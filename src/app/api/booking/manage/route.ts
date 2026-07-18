import {
  applyManageSecurityHeaders,
  MANAGE_LINK_INVALID_MESSAGE,
  manageJsonResponse,
  manageUnauthorizedResponse,
} from "@/lib/booking/manage-response";
import { resolveManageBearerToken } from "@/lib/booking/manage-session-cookie";
import { manageTokenRateLimitFingerprint } from "@/lib/booking/manage-token";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import { getPublicManageAppointmentByToken } from "@/services/BookingManageService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const token = resolveManageBearerToken({ request });

    const rateLimitResponse = enforceRequestRateLimit(
      request,
      token ? [manageTokenRateLimitFingerprint(token)] : [],
    );
    if (rateLimitResponse) {
      return applyManageSecurityHeaders(rateLimitResponse);
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
  } catch {
    // Fail closed with no-store; do not distinguish schema/DB outages for enumeration.
    return manageJsonResponse(
      { ok: false as const, error: MANAGE_LINK_INVALID_MESSAGE },
      { status: 404 },
    );
  }
}
