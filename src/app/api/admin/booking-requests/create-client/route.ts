import { NextResponse } from "next/server";
import { BOOKING_REQUESTS_ADMIN_ROLES, requireApiRoles } from "@/lib/auth/api-access";
import {
  BookingRequestValidationError,
  createSeparateClientForBookingRequest,
} from "@/services/BookingRequestService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function bookingRequestErrorResponse(error: unknown): NextResponse {
  if (error instanceof BookingRequestValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    { ok: false, error: "Не удалось создать клиента из заявки" },
    { status: 500 },
  );
}

type CreateClientBody = {
  requestId?: string;
};

export async function POST(request: Request) {
  const authResult = await requireApiRoles(BOOKING_REQUESTS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  let body: CreateClientBody;
  try {
    body = (await request.json()) as CreateClientBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Пустое или некорректное тело запроса" },
      { status: 400 },
    );
  }

  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  if (!requestId) {
    return NextResponse.json(
      { ok: false, error: "Укажите requestId" },
      { status: 400 },
    );
  }

  try {
    const bookingRequest = await createSeparateClientForBookingRequest(requestId);
    return NextResponse.json({ ok: true, request: bookingRequest });
  } catch (error) {
    return bookingRequestErrorResponse(error);
  }
}
