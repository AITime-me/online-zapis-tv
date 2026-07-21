import { Prisma } from "@prisma/client";
import { SEED_TEST_SERVICE_IDS } from "@/lib/services/seed-test-service-ids";

/**
 * Prisma-фильтр masterService для публичных онлайн-capable услуг.
 * Согласован с assertOnlineBookable (service/category public+online+active)
 * и исключает seed-test ids как listServicesForMaster.
 */
export function onlinePublicMasterServiceWhere(
  masterId: string,
): Prisma.MasterServiceWhereInput {
  return {
    masterId,
    isEnabled: true,
    isOnlineBookingEnabled: true,
    service: {
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      id: { notIn: [...SEED_TEST_SERVICE_IDS] },
      category: { isActive: true, isPublic: true },
    },
  };
}
