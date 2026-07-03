import { prisma } from "@/lib/db";
import type {
  MasterAdminRow,
  MasterReorderInput,
  MasterWriteInput,
} from "@/types/master-admin";

export class MasterAdminValidationError extends Error {}

export class MasterAdminNotFoundError extends Error {}

export class MasterAdminConflictError extends Error {}

function mapMaster(
  master: Awaited<ReturnType<typeof prisma.master.findMany>>[number] & {
    user: { id: string; email: string; name: string } | null;
  },
): MasterAdminRow {
  return {
    id: master.id,
    internalName: master.internalName,
    publicName: master.publicName,
    clientDescription: master.clientDescription,
    workStart: master.workStart,
    workEnd: master.workEnd,
    slotMinutes: master.slotMinutes,
    breakAfterMinutes: master.breakAfterMinutes,
    sortOrder: master.sortOrder,
    isActive: master.isActive,
    isPublic: master.isPublic,
    isOnlineBookingEnabled: master.isOnlineBookingEnabled,
    userId: master.userId,
    user: master.user
      ? {
          id: master.user.id,
          email: master.user.email,
          name: master.user.name,
        }
      : null,
  };
}

function validateTimeRange(workStart: string, workEnd: string) {
  if (workStart >= workEnd) {
    throw new MasterAdminValidationError(
      "Время окончания должно быть позже начала",
    );
  }
}

function validateRequiredNames(internalName: string, publicName: string) {
  if (!internalName.trim()) {
    throw new MasterAdminValidationError("Укажите внутреннее имя");
  }
  if (!publicName.trim()) {
    throw new MasterAdminValidationError("Укажите публичное имя");
  }
}

async function assertUserAvailable(userId: string | null | undefined, excludeMasterId?: string) {
  if (!userId) {
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new MasterAdminValidationError("Пользователь не найден");
  }

  const existing = await prisma.master.findUnique({ where: { userId } });
  if (existing && existing.id !== excludeMasterId) {
    throw new MasterAdminConflictError("У пользователя уже есть профиль мастера");
  }
}

export async function listMasters(includeInactive: boolean): Promise<MasterAdminRow[]> {
  const masters = await prisma.master.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { internalName: "asc" }],
    include: {
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  });

  return masters.map(mapMaster);
}

export async function createMaster(input: MasterWriteInput): Promise<MasterAdminRow> {
  const internalName = input.internalName.trim();
  const publicName = input.publicName.trim();
  validateRequiredNames(internalName, publicName);

  const workStart = input.workStart ?? "09:00";
  const workEnd = input.workEnd ?? "18:00";
  validateTimeRange(workStart, workEnd);

  const slotMinutes = input.slotMinutes ?? 30;
  if (slotMinutes <= 0) {
    throw new MasterAdminValidationError("Длительность слота должна быть больше 0");
  }

  await assertUserAvailable(input.userId ?? null);

  let sortOrder = input.sortOrder;
  if (sortOrder == null) {
    const maxSort = await prisma.master.aggregate({ _max: { sortOrder: true } });
    sortOrder = (maxSort._max.sortOrder ?? 0) + 1;
  }

  const master = await prisma.master.create({
    data: {
      internalName,
      publicName,
      clientDescription: input.clientDescription?.trim() || null,
      workStart,
      workEnd,
      slotMinutes,
      breakAfterMinutes: input.breakAfterMinutes ?? 0,
      sortOrder,
      isActive: input.isActive ?? true,
      isPublic: input.isPublic ?? true,
      isOnlineBookingEnabled: input.isOnlineBookingEnabled ?? true,
      userId: input.userId ?? null,
    },
    include: {
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  });

  return mapMaster(master);
}

export async function updateMaster(
  id: string,
  input: Partial<MasterWriteInput>,
): Promise<MasterAdminRow> {
  const existing = await prisma.master.findUnique({
    where: { id },
    include: {
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  });

  if (!existing) {
    throw new MasterAdminNotFoundError("Мастер не найден");
  }

  const internalName = input.internalName?.trim() ?? existing.internalName;
  const publicName = input.publicName?.trim() ?? existing.publicName;
  validateRequiredNames(internalName, publicName);

  const workStart = input.workStart ?? existing.workStart;
  const workEnd = input.workEnd ?? existing.workEnd;
  validateTimeRange(workStart, workEnd);

  const slotMinutes = input.slotMinutes ?? existing.slotMinutes;
  if (slotMinutes <= 0) {
    throw new MasterAdminValidationError("Длительность слота должна быть больше 0");
  }

  if (input.userId !== undefined) {
    await assertUserAvailable(input.userId, id);
  }

  const master = await prisma.master.update({
    where: { id },
    data: {
      internalName,
      publicName,
      clientDescription:
        input.clientDescription !== undefined
          ? input.clientDescription?.trim() || null
          : undefined,
      workStart,
      workEnd,
      slotMinutes,
      breakAfterMinutes: input.breakAfterMinutes,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      isPublic: input.isPublic,
      isOnlineBookingEnabled: input.isOnlineBookingEnabled,
      userId: input.userId,
    },
    include: {
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  });

  return mapMaster(master);
}

export async function reorderMasters(input: MasterReorderInput): Promise<MasterAdminRow[]> {
  if (input.items.length === 0) {
    throw new MasterAdminValidationError("Передайте список мастеров для сортировки");
  }

  await prisma.$transaction(
    input.items.map((item) =>
      prisma.master.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder },
      }),
    ),
  );

  return listMasters(true);
}
