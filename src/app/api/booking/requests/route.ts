import { NextResponse } from "next/server";
import type { BookingRequestStatus, UserRole } from "@prisma/client";
import { requireApiRoles } from "@/lib/auth/api-access";
import {
  listBookingRequests,
  updateBookingRequestStatus,
} from "@/services/BookingRequestService";

const ADMIN_ROLES: UserRole[] = ["OWNER", "MANAGER"];

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const authResult = await requireApiRoles(ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const requests = await listBookingRequests();
  return NextResponse.json({ ok: true, requests });
}

export async function PATCH(request: Request) {
  const authResult = await requireApiRoles(ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const body = (await request.json()) as {
    id?: string;
    status?: BookingRequestStatus;
  };

  if (!body.id || !body.status) {
    return NextResponse.json(
      { ok: false, error: "id and status are required" },
      { status: 400 },
    );
  }

  const updated = await updateBookingRequestStatus(body.id, body.status);
  return NextResponse.json({ ok: true, request: updated });
}
