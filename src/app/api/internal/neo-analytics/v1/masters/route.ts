import { withNeoAnalyticsAuth } from "@/lib/neo-analytics/auth";
import { prisma } from "@/lib/db";
import { analyticsResponse } from "@/lib/neo-analytics/response";

export const GET = withNeoAnalyticsAuth(async () => {
  const rows = await prisma.master.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      publicName: true,
      slotMinutes: true,
      workStart: true,
      workEnd: true,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      sortOrder: true,
      updatedAt: true,
    },
  });
  return analyticsResponse(
    {
      id: "uuid",
      publicName: "string",
      slotMinutes: "integer",
      workStart: "time",
      workEnd: "time",
      isActive: "boolean",
      isPublic: "boolean",
      isOnlineBookingEnabled: "boolean",
      sortOrder: "integer",
      updatedAt: "datetime",
    },
    rows,
  );
});
