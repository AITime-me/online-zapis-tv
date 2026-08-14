import { withNeoAnalyticsAuth } from "@/lib/neo-analytics/auth";
import { prisma } from "@/lib/db";
import { analyticsResponse } from "@/lib/neo-analytics/response";

export const GET = withNeoAnalyticsAuth(async () => {
  const services = await prisma.service.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      categoryId: true,
      publicName: true,
      durationMinutes: true,
      breakAfterMinutes: true,
      price: true,
      priceFrom: true,
      priceTo: true,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      sortOrder: true,
      updatedAt: true,
    },
  });
  const rows = services.map((service) => ({
    ...service,
    price: service.price?.toString() ?? null,
    priceFrom: service.priceFrom?.toString() ?? null,
    priceTo: service.priceTo?.toString() ?? null,
  }));
  return analyticsResponse(
    {
      id: "uuid",
      categoryId: "uuid",
      publicName: "string",
      durationMinutes: "integer",
      breakAfterMinutes: "integer",
      price: "decimal|null",
      priceFrom: "decimal|null",
      priceTo: "decimal|null",
      isActive: "boolean",
      isPublic: "boolean",
      isOnlineBookingEnabled: "boolean",
      sortOrder: "integer",
      updatedAt: "datetime",
    },
    rows,
  );
});
