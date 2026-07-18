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
  requestRescheduleByManageToken,
} from "@/services/BookingManageService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RescheduleBody = {
  token?: string;
  message?: string;
};

export async function POST(request: Request) {
  const originResponse = enforceSameOriginForMutatingRequest(request);
  if (originResponse) {
    return applyManageSecurityHeaders(originResponse);
  }

  try {
    const body = (await request.json()) as RescheduleBody;
    const token = resolveManageBearerToken({
      request,
      bodyToken: body.token,
    });
    const message = typeof body.message === "string" ? body.message : "";

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

    const appointment = await requestRescheduleByManageToken(token, message);

    return manageJsonResponse({
      ok: true,
      appointment,
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
