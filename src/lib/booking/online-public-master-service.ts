import { Prisma } from "@prisma/client";
import {
  isSeedTestServiceId,
  SEED_TEST_SERVICE_IDS,
} from "@/lib/services/seed-test-service-ids";

/**
 * Каноническое правило публичной самостоятельной онлайн-записи.
 *
 * Разрешено только когда одновременно:
 * - service: active + public + online + не seed/test;
 * - category: active + public (online-флага категории в модели нет);
 * - master: active + public + online;
 * - masterService: существует, enabled + public + online.
 *
 * MANAGER_ONLY — отдельный режим каталога (нет полного ONLINE-пути),
 * не смешивается с этим правилом.
 */

export type OnlinePublicServiceParts = {
  id: string;
  isActive: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
  category: { isActive: boolean; isPublic: boolean } | null;
};

export type OnlinePublicMasterParts = {
  isActive: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
};

export type OnlinePublicLinkParts = {
  isEnabled: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
};

/** Вход для master-first каталога услуг (мастер уже выбран/отфильтрован). */
export type OnlinePublicCatalogLinkInput = OnlinePublicLinkParts & {
  service: OnlinePublicServiceParts;
};

/** Полная цепочка для assertOnlineBookable / service-first ONLINE. */
export type OnlinePublicBookableInput = {
  service: OnlinePublicServiceParts | null;
  master: OnlinePublicMasterParts | null;
  masterService: OnlinePublicLinkParts | null;
};

export function isOnlinePublicServiceEligible(
  service: OnlinePublicServiceParts | null | undefined,
): boolean {
  if (!service) {
    return false;
  }

  if (isSeedTestServiceId(service.id)) {
    return false;
  }

  return (
    service.isActive === true &&
    service.isPublic === true &&
    service.isOnlineBookingEnabled === true &&
    service.category?.isActive === true &&
    service.category?.isPublic === true
  );
}

export function isOnlinePublicMasterEligible(
  master: OnlinePublicMasterParts | null | undefined,
): boolean {
  return (
    master?.isActive === true &&
    master.isPublic === true &&
    master.isOnlineBookingEnabled === true
  );
}

export function isOnlinePublicLinkEligible(
  link: OnlinePublicLinkParts | null | undefined,
): boolean {
  return (
    link?.isEnabled === true &&
    link.isPublic === true &&
    link.isOnlineBookingEnabled === true
  );
}

/**
 * Чистая проверка: должна ли связь попасть в публичный GET /api/booking/services
 * для уже выбранного публичного мастера.
 */
export function isOnlinePublicCatalogServiceLink(
  link: OnlinePublicCatalogLinkInput,
): boolean {
  return (
    isOnlinePublicLinkEligible(link) && isOnlinePublicServiceEligible(link.service)
  );
}

/** Полная публичная ONLINE-цепочка master↔service↔category. */
export function isOnlinePublicBookable(input: OnlinePublicBookableInput): boolean {
  return (
    isOnlinePublicServiceEligible(input.service) &&
    isOnlinePublicMasterEligible(input.master) &&
    isOnlinePublicLinkEligible(input.masterService)
  );
}

/**
 * Prisma-фильтр masterService для публичных онлайн-услуг выбранного мастера.
 * Согласован с isOnlinePublicCatalogServiceLink / isOnlinePublicBookable.
 */
export function onlinePublicMasterServiceWhere(
  masterId: string,
): Prisma.MasterServiceWhereInput {
  return {
    masterId,
    isEnabled: true,
    isPublic: true,
    isOnlineBookingEnabled: true,
    master: {
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    },
    service: {
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      id: { notIn: [...SEED_TEST_SERVICE_IDS] },
      category: { isActive: true, isPublic: true },
    },
  };
}

/**
 * Prisma-фильтр мастеров, у которых услуга доступна для публичной ONLINE-записи.
 * Согласован с isOnlinePublicBookable.
 */
export function onlinePublicMastersForServiceWhere(
  serviceId: string,
): Prisma.MasterWhereInput {
  return {
    isActive: true,
    isPublic: true,
    isOnlineBookingEnabled: true,
    masterServices: {
      some: {
        serviceId,
        isEnabled: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
        service: {
          isActive: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
          id: { notIn: [...SEED_TEST_SERVICE_IDS] },
          category: { isActive: true, isPublic: true },
        },
      },
    },
  };
}
