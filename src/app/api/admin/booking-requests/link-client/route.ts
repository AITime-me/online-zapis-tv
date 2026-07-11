import { NextResponse } from "next/server";
import { BOOKING_REQUESTS_ADMIN_ROLES, requireApiRoles, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import {
  BookingRequestValidationError,
  linkBookingRequestToClient,
} from "@/services/BookingRequestService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function bookingRequestErrorResponse(error: unknown): NextResponse {
  if (error instanceof BookingRequestValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    { ok: false, error: "Не удалось связать заявку с клиентом" },
    { status: 500 },
  );
}

type LinkClientBody = {
  requestId?: string;
  clientId?: string;
};

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(BOOKING_REQUESTS_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  let body: LinkClientBody;
  try {
    body = (await request.json()) as LinkClientBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Пустое или некорректное тело запроса" },
      { status: 400 },
    );
  }

  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";

  if (!requestId || !clientId) {
    return NextResponse.json(
      { ok: false, error: "Укажите requestId и clientId" },
      { status: 400 },
    );
  }

  try {
    const bookingRequest = await linkBookingRequestToClient(requestId, clientId);
    return NextResponse.json({ ok: true, request: bookingRequest });
  } catch (error) {
    return bookingRequestErrorResponse(error);
  }
}
