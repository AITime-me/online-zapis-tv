import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  findOrCreateServiceCategoryByName,
  listAllActiveServiceCategories,
  ServiceCategoryValidationError,
} from "@/services/ServiceCategoryService";
import { SEED_TEST_SERVICE_IDS } from "@/lib/services/seed-test-service-ids";
import type {
  ServiceAdminRow,
  ServiceCategoryOption,
  ServiceMasterOption,
  ServiceWriteInput,
} from "@/types/service-admin";

export class ServiceAdminValidationError extends Error {}

export class ServiceAdminNotFoundError extends Error {}

function revalidatePublicBookingCatalog() {
  revalidatePath("/api/booking/catalog");
  revalidatePath("/api/booking/services");
  revalidatePath("/api/booking/masters");
  revalidatePath("/booking");
}

function decimalToNumber(value: Prisma.Decimal | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  return Number(value);
}

type ServiceWithRelations = Prisma.ServiceGetPayload<{
  include: {
    category: { select: { id: true; name: true } };
    masterServices: {
      include: {
        master: {
          select: { id: true; internalName: true; publicName: true };
        };
      };
    };
  };
}>;

function mapService(service: ServiceWithRelations): ServiceAdminRow {
  return {
    id: service.id,
    categoryId: service.categoryId,
    categoryName: service.category.name,
    internalName: service.internalName,
    publicName: service.publicName,
    clientDescription: service.clientDescription,
    price: decimalToNumber(service.price),
    priceFrom: decimalToNumber(service.priceFrom),
    priceTo: decimalToNumber(service.priceTo),
    durationMinutes: service.durationMinutes,
    breakAfterMinutes: service.breakAfterMinutes,
    sortOrder: service.sortOrder,
    isActive: service.isActive,
    isPublic: service.isPublic,
    isOnlineBookingEnabled: service.isOnlineBookingEnabled,
    masters: service.masterServices
      .slice()
      .sort((a, b) => {
        if (a.isEnabled !== b.isEnabled) {
          return a.isEnabled ? -1 : 1;
        }
        return a.sortOrder - b.sortOrder;
      })
      .map((link) => ({
        masterId: link.masterId,
        masterInternalName: link.master.internalName,
        masterPublicName: link.master.publicName,
        isEnabled: link.isEnabled,
        isPublic: link.isPublic,
        isOnlineBookingEnabled: link.isOnlineBookingEnabled,
      })),
  };
}

function validateWriteInput(input: ServiceWriteInput, partial = false) {
  if (!partial || input.internalName !== undefined) {
    if (!input.internalName?.trim()) {
      throw new ServiceAdminValidationError("Укажите внутреннее название");
    }
  }
  if (!partial || input.publicName !== undefined) {
    if (!input.publicName?.trim()) {
      throw new ServiceAdminValidationError("Укажите публичное название");
    }
  }
  if (!partial || input.categoryId !== undefined || input.newCategoryName !== undefined) {
    const hasNewCategory = Boolean(input.newCategoryName?.trim());
    if (!hasNewCategory && !input.categoryId?.trim()) {
      throw new ServiceAdminValidationError("Выберите категорию");
    }
  }
  if (!partial || input.durationMinutes !== undefined) {
    if (input.durationMinutes == null || input.durationMinutes <= 0) {
      throw new ServiceAdminValidationError(
        "Длительность должна быть больше 0 минут",
      );
    }
  }
  if (input.breakAfterMinutes != null && input.breakAfterMinutes < 0) {
    throw new ServiceAdminValidationError("Перерыв не может быть отрицательным");
  }
  if (
    input.priceFrom != null &&
    input.priceTo != null &&
    input.priceFrom > input.priceTo
  ) {
    throw new ServiceAdminValidationError(
      "Минимальная цена не может быть больше максимальной",
    );
  }
}

function applyArchiveRules(input: {
  isActive: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
}) {
  if (!input.isActive) {
    return {
      isActive: false,
      isPublic: false,
      isOnlineBookingEnabled: false,
    };
  }
  return input;
}

async function resolveCategoryId(
  input: Pick<ServiceWriteInput, "categoryId" | "newCategoryName">,
): Promise<string> {
  const newCategoryName = input.newCategoryName?.trim();
  if (newCategoryName) {
    try {
      return await findOrCreateServiceCategoryByName(newCategoryName);
    } catch (error) {
      if (error instanceof ServiceCategoryValidationError) {
        throw new ServiceAdminValidationError(error.message);
      }
      throw error;
    }
  }

  const categoryId = input.categoryId?.trim();
  if (!categoryId) {
    throw new ServiceAdminValidationError("Выберите категорию");
  }

  const category = await prisma.serviceCategory.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  if (!category) {
    throw new ServiceAdminValidationError("Категория не найдена");
  }

  return category.id;
}

async function syncMasterServices(
  serviceId: string,
  masterIds: string[],
  flags: {
    isActive: boolean;
    isPublic: boolean;
    isOnlineBookingEnabled: boolean;
  },
) {
  const uniqueMasterIds = [...new Set(masterIds)];
  const existing = await prisma.masterService.findMany({
    where: { serviceId },
  });
  const selected = new Set(uniqueMasterIds);

  for (const link of existing) {
    if (selected.has(link.masterId)) {
      await prisma.masterService.update({
        where: {
          masterId_serviceId: {
            masterId: link.masterId,
            serviceId,
          },
        },
        data: {
          isEnabled: flags.isActive,
          isPublic: flags.isActive && flags.isPublic,
          isOnlineBookingEnabled:
            flags.isActive && flags.isOnlineBookingEnabled,
        },
      });
    } else if (link.isEnabled) {
      await prisma.masterService.update({
        where: {
          masterId_serviceId: {
            masterId: link.masterId,
            serviceId,
          },
        },
        data: {
          isEnabled: false,
          isPublic: false,
          isOnlineBookingEnabled: false,
        },
      });
    }
  }

  for (const masterId of uniqueMasterIds) {
    const exists = existing.some((link) => link.masterId === masterId);
    if (exists) {
      continue;
    }

    await prisma.masterService.create({
      data: {
        masterId,
        serviceId,
        isEnabled: flags.isActive,
        isPublic: flags.isActive && flags.isPublic,
        isOnlineBookingEnabled: flags.isActive && flags.isOnlineBookingEnabled,
      },
    });
  }
}

async function disableAllMasterServices(serviceId: string) {
  await prisma.masterService.updateMany({
    where: { serviceId, isEnabled: true },
    data: {
      isEnabled: false,
      isPublic: false,
      isOnlineBookingEnabled: false,
    },
  });
}

async function fetchServiceById(id: string): Promise<ServiceAdminRow | null> {
  const service = await prisma.service.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      masterServices: {
        include: {
          master: {
            select: { id: true, internalName: true, publicName: true },
          },
        },
      },
    },
  });

  return service ? mapService(service) : null;
}

export async function listServiceFilterCategories(
  services: ServiceAdminRow[],
): Promise<ServiceCategoryOption[]> {
  const categoryIds = [...new Set(services.map((service) => service.categoryId))];
  if (categoryIds.length === 0) {
    return [];
  }

  return prisma.serviceCategory.findMany({
    where: { id: { in: categoryIds } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, sortOrder: true },
  });
}

export async function listServiceFilterMasters(
  services: ServiceAdminRow[],
): Promise<ServiceMasterOption[]> {
  const masterIds = new Set<string>();
  for (const service of services) {
    for (const link of service.masters) {
      if (link.isEnabled) {
        masterIds.add(link.masterId);
      }
    }
  }

  if (masterIds.size === 0) {
    return [];
  }

  return prisma.master.findMany({
    where: {
      id: { in: [...masterIds] },
      isActive: true,
    },
    orderBy: [{ sortOrder: "asc" }, { internalName: "asc" }],
    select: {
      id: true,
      internalName: true,
      publicName: true,
      isActive: true,
    },
  });
}

/** Категории для формы — все активные категории студии. */
export async function listServiceFormCategories(): Promise<ServiceCategoryOption[]> {
  return listAllActiveServiceCategories();
}

/** Мастера для формы — активные, без seed-тестовых. */
export async function listServiceFormMasters(): Promise<ServiceMasterOption[]> {
  const masters = await prisma.master.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { internalName: "asc" }],
    select: {
      id: true,
      internalName: true,
      publicName: true,
      isActive: true,
      clientDescription: true,
    },
  });

  return masters
    .filter((master) => !master.clientDescription?.includes("(тест)"))
    .map(({ clientDescription: _clientDescription, ...master }) => master);
}

export async function getServiceAdminPageData() {
  const services = await listServices();
  const [filterCategories, filterMasters, formCategories, formMasters] =
    await Promise.all([
      listServiceFilterCategories(services),
      listServiceFilterMasters(services),
      listServiceFormCategories(),
      listServiceFormMasters(),
    ]);

  return {
    services,
    filterCategories,
    filterMasters,
    formCategories,
    formMasters,
  };
}

/** @deprecated Используйте listServiceFilterCategories(services) */
export async function listServiceCategories(): Promise<ServiceCategoryOption[]> {
  const services = await listServices();
  return listServiceFilterCategories(services);
}

/** @deprecated Используйте listServiceFilterMasters(services) */
export async function listServiceMasterOptions(): Promise<ServiceMasterOption[]> {
  const services = await listServices();
  return listServiceFilterMasters(services);
}

export async function listServices(options?: {
  includeSeedTest?: boolean;
}): Promise<ServiceAdminRow[]> {
  const where: Prisma.ServiceWhereInput = {};

  if (!options?.includeSeedTest) {
    where.id = { notIn: [...SEED_TEST_SERVICE_IDS] };
  }

  const services = await prisma.service.findMany({
    where,
    include: {
      category: { select: { id: true, name: true } },
      masterServices: {
        include: {
          master: {
            select: { id: true, internalName: true, publicName: true },
          },
        },
      },
    },
    orderBy: [
      { category: { sortOrder: "asc" } },
      { sortOrder: "asc" },
      { publicName: "asc" },
    ],
  });

  return services.map(mapService);
}

export async function createService(
  input: ServiceWriteInput,
): Promise<ServiceAdminRow> {
  validateWriteInput(input);

  const categoryId = await resolveCategoryId(input);

  const flags = applyArchiveRules({
    isActive: input.isActive ?? true,
    isPublic: input.isPublic ?? true,
    isOnlineBookingEnabled: input.isOnlineBookingEnabled ?? true,
  });

  const service = await prisma.service.create({
    data: {
      categoryId,
      internalName: input.internalName.trim(),
      publicName: input.publicName.trim(),
      clientDescription: input.clientDescription?.trim() || null,
      priceFrom: input.priceFrom ?? null,
      priceTo: input.priceTo ?? null,
      durationMinutes: input.durationMinutes,
      breakAfterMinutes: input.breakAfterMinutes ?? 0,
      sortOrder: input.sortOrder ?? 0,
      isActive: flags.isActive,
      isPublic: flags.isPublic,
      isOnlineBookingEnabled: flags.isOnlineBookingEnabled,
    },
  });

  if (input.masterIds && input.masterIds.length > 0) {
    await syncMasterServices(service.id, input.masterIds, flags);
  } else if (!flags.isActive) {
    await disableAllMasterServices(service.id);
  }

  const created = await fetchServiceById(service.id);
  if (!created) {
    throw new ServiceAdminNotFoundError("Услуга не найдена после создания");
  }
  revalidatePublicBookingCatalog();
  return created;
}

export async function updateService(
  id: string,
  input: Partial<ServiceWriteInput>,
): Promise<ServiceAdminRow> {
  const existing = await prisma.service.findUnique({ where: { id } });
  if (!existing) {
    throw new ServiceAdminNotFoundError("Услуга не найдена");
  }

  validateWriteInput(input as ServiceWriteInput, true);

  let nextCategoryId: string | undefined;
  if (input.categoryId !== undefined || input.newCategoryName !== undefined) {
    nextCategoryId = await resolveCategoryId({
      categoryId: input.categoryId,
      newCategoryName: input.newCategoryName,
    });
  }

  const nextFlags = applyArchiveRules({
    isActive: input.isActive ?? existing.isActive,
    isPublic: input.isPublic ?? existing.isPublic,
    isOnlineBookingEnabled:
      input.isOnlineBookingEnabled ?? existing.isOnlineBookingEnabled,
  });

  await prisma.service.update({
    where: { id },
    data: {
      ...(input.internalName !== undefined
        ? { internalName: input.internalName.trim() }
        : {}),
      ...(input.publicName !== undefined
        ? { publicName: input.publicName.trim() }
        : {}),
      ...(input.clientDescription !== undefined
        ? { clientDescription: input.clientDescription?.trim() || null }
        : {}),
      ...(nextCategoryId !== undefined ? { categoryId: nextCategoryId } : {}),
      ...(input.priceFrom !== undefined ? { priceFrom: input.priceFrom } : {}),
      ...(input.priceTo !== undefined ? { priceTo: input.priceTo } : {}),
      ...(input.durationMinutes !== undefined
        ? { durationMinutes: input.durationMinutes }
        : {}),
      ...(input.breakAfterMinutes !== undefined
        ? { breakAfterMinutes: input.breakAfterMinutes }
        : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      isActive: nextFlags.isActive,
      isPublic: nextFlags.isPublic,
      isOnlineBookingEnabled: nextFlags.isOnlineBookingEnabled,
    },
  });

  if (input.masterIds !== undefined) {
    await syncMasterServices(id, input.masterIds, nextFlags);
  } else if (!nextFlags.isActive) {
    await disableAllMasterServices(id);
  } else {
    const enabledLinks = await prisma.masterService.findMany({
      where: { serviceId: id, isEnabled: true },
      select: { masterId: true },
    });
    if (enabledLinks.length > 0) {
      await syncMasterServices(
        id,
        enabledLinks.map((link) => link.masterId),
        nextFlags,
      );
    }
  }

  const updated = await fetchServiceById(id);
  if (!updated) {
    throw new ServiceAdminNotFoundError("Услуга не найдена после обновления");
  }
  revalidatePublicBookingCatalog();
  return updated;
}
