import { withNeoAnalyticsAuth } from "@/lib/neo-analytics/auth";
import { prisma } from "@/lib/db";
import { analyticsResponse, badRequest } from "@/lib/neo-analytics/response";

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 5000;

export const GET = withNeoAnalyticsAuth(async (request) => {
  const url = new URL(request.url);
  const from = new Date(url.searchParams.get("from") ?? "");
  const to = new Date(url.searchParams.get("to") ?? "");
  const limit = Number(url.searchParams.get("limit") ?? MAX_ROWS);

  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    to <= from ||
    to.getTime() - from.getTime() > MAX_RANGE_MS
  ) {
    return badRequest("Use valid from/to ISO dates with a range of at most 31 days");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROWS) {
    return badRequest("limit must be an integer from 1 to 5000");
  }

  const rows = await prisma.appointment.findMany({
    where: { startsAt: { gte: from, lt: to } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      masterId: true,
      serviceId: true,
      startsAt: true,
      endsAt: true,
      status: true,
      source: true,
      serviceDurationMinutes: true,
      breakAfterMinutes: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return analyticsResponse(
    {
      id: "uuid",
      masterId: "uuid",
      serviceId: "uuid|null",
      startsAt: "datetime",
      endsAt: "datetime",
      status: "AppointmentStatus",
      source: "AppointmentSource",
      serviceDurationMinutes: "integer|null",
      breakAfterMinutes: "integer|null",
      createdAt: "datetime",
      updatedAt: "datetime",
    },
    rows,
  );
});
