import { prisma } from "@/lib/db";

export class ServiceCategoryValidationError extends Error {}

export async function findOrCreateServiceCategoryByName(
  rawName: string,
): Promise<string> {
  const name = rawName.trim();
  if (!name) {
    throw new ServiceCategoryValidationError("Укажите название категории");
  }

  const existing = await prisma.serviceCategory.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) {
    return existing.id;
  }

  const maxSort = await prisma.serviceCategory.aggregate({
    _max: { sortOrder: true },
  });

  const created = await prisma.serviceCategory.create({
    data: {
      name,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      isActive: true,
      isPublic: true,
    },
    select: { id: true },
  });

  return created.id;
}

export async function listAllActiveServiceCategories() {
  return prisma.serviceCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, sortOrder: true },
  });
}
