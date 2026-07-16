import type { Prisma } from "@prisma/client";

export type PromotionServiceLinkCandidate = {
  id: string;
  isActive: boolean;
  internalName: string;
};

export type ResolvePromotionServiceIdsInput = {
  requestedIds: string[];
  /** Услуги, найденные в БД по requestedIds. */
  foundServices: PromotionServiceLinkCandidate[];
  /** Уже привязанные к акции serviceId (при update). */
  previouslyLinkedIds: string[];
};

/**
 * Валидирует serviceIds для promotion_services.
 * - неизвестные ID запрещены;
 * - новые привязки только к активным не-тестовым услугам;
 * - ранее привязанные могут остаться даже если услуга стала неактивной.
 */
export function resolvePromotionServiceIdsForSync(
  input: ResolvePromotionServiceIdsInput,
): string[] {
  const uniqueIds = [...new Set(input.requestedIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return [];
  }

  const foundById = new Map(
    input.foundServices.map((service) => [service.id, service]),
  );
  if (foundById.size !== uniqueIds.length) {
    throw new Error("Одна или несколько услуг не найдены");
  }

  const previouslyLinked = new Set(input.previouslyLinkedIds);

  for (const id of uniqueIds) {
    const service = foundById.get(id)!;
    const isTest = service.internalName.toLowerCase().includes("(тест)");
    const wasLinked = previouslyLinked.has(id);

    if (isTest && !wasLinked) {
      throw new Error("Нельзя привязать тестовую услугу");
    }
    if (!service.isActive && !wasLinked) {
      throw new Error("Нельзя привязать неактивную услугу");
    }
  }

  return uniqueIds;
}

export type TxLike = {
  service: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: { id: true; isActive: true; internalName: true };
    }) => Promise<PromotionServiceLinkCandidate[]>;
  };
  promotionService: {
    findMany: (args: {
      where: { promotionId: string };
      select: { serviceId: true };
    }) => Promise<Array<{ serviceId: string }>>;
    deleteMany: (args: {
      where: { promotionId: string };
    }) => Promise<unknown>;
    createMany: (args: {
      data: Array<{ promotionId: string; serviceId: string }>;
      skipDuplicates: boolean;
    }) => Promise<unknown>;
  };
};

export async function syncPromotionServicesInTx(
  tx: TxLike,
  promotionId: string,
  serviceIds: string[],
): Promise<string[]> {
  const uniqueRequested = [...new Set(serviceIds.map((id) => id.trim()).filter(Boolean))];

  if (uniqueRequested.length === 0) {
    await tx.promotionService.deleteMany({ where: { promotionId } });
    return [];
  }

  const [foundServices, previousLinks] = await Promise.all([
    tx.service.findMany({
      where: { id: { in: uniqueRequested } },
      select: { id: true, isActive: true, internalName: true },
    }),
    tx.promotionService.findMany({
      where: { promotionId },
      select: { serviceId: true },
    }),
  ]);

  const resolved = resolvePromotionServiceIdsForSync({
    requestedIds: uniqueRequested,
    foundServices,
    previouslyLinkedIds: previousLinks.map((link) => link.serviceId),
  });

  await tx.promotionService.deleteMany({ where: { promotionId } });
  if (resolved.length > 0) {
    await tx.promotionService.createMany({
      data: resolved.map((serviceId) => ({ promotionId, serviceId })),
      skipDuplicates: true,
    });
  }

  return resolved;
}

/** Для create: previouslyLinked пустой. */
export async function validateNewPromotionServiceIds(
  tx: Pick<TxLike, "service">,
  serviceIds: string[],
): Promise<string[]> {
  const uniqueRequested = [...new Set(serviceIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueRequested.length === 0) {
    return [];
  }

  const foundServices = await tx.service.findMany({
    where: { id: { in: uniqueRequested } },
    select: { id: true, isActive: true, internalName: true },
  });

  return resolvePromotionServiceIdsForSync({
    requestedIds: uniqueRequested,
    foundServices,
    previouslyLinkedIds: [],
  });
}

export type { Prisma };
