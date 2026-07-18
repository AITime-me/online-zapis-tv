import {
  applyManageSecurityHeaders,
  manageJsonResponse,
  manageUnauthorizedResponse,
} from "@/lib/booking/manage-response";
import { resolveManageBearerToken } from "@/lib/booking/manage-session-cookie";
import { manageTokenRateLimitFingerprint } from "@/lib/booking/manage-token";
import { enforceSameOriginForMutatingRequest } from "@/lib/security/csrf";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import {
  BookingManageError,
  cancelAppointmentByManageToken,
} from "@/services/BookingManageService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CancelBody = {
  token?: string;
  reason?: string;
};

export async function POST(request: Request) {
  const originResponse = enforceSameOriginForMutatingRequest(request);
  if (originResponse) {
    return applyManageSecurityHeaders(originResponse);
  }

  try {
    const body = (await request.json()) as CancelBody;
    const token = resolveManageBearerToken({
      request,
      bodyToken: body.token,
    });
    const reason = typeof body.reason === "string" ? body.reason : undefined;

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

    const result = await cancelAppointmentByManageToken(token, reason);

    return manageJsonResponse({
      ok: true,
      alreadyCancelled: result.alreadyCancelled,
      appointment: result.view,
    });
  } catch (error) {
    if (error instanceof BookingManageError) {
      if (error.message === "UNAUTHORIZED") {
        return manageUnauthorizedResponse();
      }
      return manageJsonResponse({ ok: false, error: error.message }, { status: 400 });
    }
    throw error;
  }
}
