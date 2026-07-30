import { Prisma } from "@prisma/client";
import { SEED_TEST_SERVICE_IDS } from "@/lib/services/seed-test-service-ids";

/**
 * Prisma-фильтр masterService для внутреннего editor-options списка OWNER/MANAGER.
 * Не зависит от isPublic / isOnlineBookingEnabled на service или masterService.
 */
export function internalEditorMasterServiceWhere(
  masterId: string,
): Prisma.MasterServiceWhereInput {
  return {
    masterId,
    isEnabled: true,
    service: {
      isActive: true,
      id: { notIn: [...SEED_TEST_SERVICE_IDS] },
    },
  };
}

/**
 * Услуга доступна для новой записи / смены услуги во внутреннем редакторе.
 * Историческая услуга текущей записи показывается локальным fallback формы.
 */
export function isInternalEditorServiceSelectable(input: {
  serviceIsActive: boolean;
  masterServiceIsEnabled: boolean | null | undefined;
}): boolean {
  return (
    input.serviceIsActive === true && input.masterServiceIsEnabled === true
  );
}
