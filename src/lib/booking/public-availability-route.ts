import { NextResponse } from "next/server";
import {
  logServiceError,
  toApiErrorBody,
} from "@/lib/errors/format-service-error";
import { OnlineServiceUnavailableError } from "@/services/BookingService";

/**
 * Public availability GET routes (available-days / slots) share the
 * booking-create contract for studio/service online unavailability:
 * HTTP 400 + code SERVICE_UNAVAILABLE (error.name), sanitized message.
 * Unexpected errors stay sanitized HTTP 500.
 */
export function mapPublicAvailabilityError(
  scope: string,
  error: unknown,
): NextResponse {
  if (error instanceof OnlineServiceUnavailableError) {
    return NextResponse.json(
      {
        ok: false as const,
        error: error.message,
        code: error.name,
      },
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }

  logServiceError(scope, error);
  return NextResponse.json(toApiErrorBody(error, { includeStack: false }), {
    status: 500,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function withPublicAvailabilityErrors<T>(
  scope: string,
  run: () => Promise<T>,
  toSuccess: (value: T) => NextResponse,
): Promise<NextResponse> {
  try {
    return toSuccess(await run());
  } catch (error) {
    return mapPublicAvailabilityError(scope, error);
  }
}
