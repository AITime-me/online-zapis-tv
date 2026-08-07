import type { Prisma, ScheduleBlockType, ScheduleResourceOrigin } from "@prisma/client";
import {
  APPOINTMENT_BUSY_TIMING_SELECT,
  getAppointmentBusyInterval,
} from "@/lib/schedule/appointment-busy";
import { NON_BLOCKING_APPOINTMENT_STATUSES } from "@/lib/schedule/non-blocking-appointment-statuses";
import { prisma } from "@/lib/db";
import {
  formatDateKeyInStudio,
  formatStudioTimeInput,
  parseStudioDateTime,
} from "@/lib/datetime/date-layer";
import { getStudioDayRangeFromDateKey } from "@/lib/datetime/studio";
import {
  FULL_DAY_BLOCK_TYPES,
  getBlockDisplayLabel,
  INTERVAL_BLOCK_TYPES,
  isFullDayBlockType,
} from "@/lib/schedule/labels";
import type { ScheduleDayBlock } from "@/types/schedule";

export class ScheduleBlockConflictError extends Error {
  readonly code: ScheduleBlockConflictCode;

  constructor(code: ScheduleBlockConflictCode, message: string) {
    super(message);
    this.name = "ScheduleBlockConflictError";
    this.code = code;
  }
}

export type ScheduleBlockConflictCode =
  | "APPOINTMENT_OVERLAP"
  | "DAY_HAS_APPOINTMENTS"
  | "FULL_DAY_EXISTS";

export class ScheduleBlockValidationError extends Error {
  readonly code: ScheduleBlockValidationCode;

  constructor(code: ScheduleBlockValidationCode, message: string) {
    super(message);
    this.name = "ScheduleBlockValidationError";
    this.code = code;
  }
}

export type ScheduleBlockValidationCode =
  | "NOT_FOUND"
  | "INVALID_TYPE"
  | "MISSING_TIMES"
  | "INVALID_RANGE"
  | "FULL_DAY_EDIT_FORBIDDEN";

export class ScheduleBlockOwnershipError extends Error {
  readonly code: ScheduleBlockOwnershipCode;

  constructor(code: ScheduleBlockOwnershipCode, message: string) {
    super(message);
    this.name = "ScheduleBlockOwnershipError";
    this.code = code;
  }
}

export type ScheduleBlockOwnershipCode = "CROSS_MASTER" | "WRONG_ORIGIN";

export type ScheduleBlockWriteInput = {
  masterId: string;
  dateKey: string;
  isFullDay: boolean;
  blockType: ScheduleBlockType;
  startTime?: string;
  endTime?: string;
};

export type ScheduleBlockDbClient = Pick<
  Prisma.TransactionClient,
  "appointment" | "scheduleBlock"
>;

export type ScheduleBlockCreateMeta = {
  createdByUserId: string | null;
  origin?: ScheduleResourceOrigin;
};

function mapBlock(block: {
  id: string;
  startsAt: Date | null;
  endsAt: Date | null;
  blockType: ScheduleBlockType;
  isFullDay: boolean;
  internalReason: string | null;
}): ScheduleDayBlock {
  return {
    id: block.id,
    startsAt: block.isFullDay ? "" : (block.startsAt?.toISOString() ?? ""),
    endsAt: block.isFullDay ? "" : (block.endsAt?.toISOString() ?? ""),
    blockType: block.blockType,
    blockTypeLabel: getBlockDisplayLabel(block.blockType, block.isFullDay),
    internalReason: block.internalReason,
    isFullDay: block.isFullDay,
  };
}

export function blocksForDayWhere(masterId: string, dateKey: string) {
  const { dayStart, dayEnd, noteDate } = getStudioDayRangeFromDateKey(dateKey);

  return {
    masterId,
    OR: [
      {
        isFullDay: false,
        startsAt: { gte: dayStart, lte: dayEnd },
      },
      {
        isFullDay: true,
        blockDate: noteDate,
      },
    ],
  };
}

export async function assertNoAppointmentOverlap(
  db: ScheduleBlockDbClient,
  masterId: string,
  dateKey: string,
  startsAt: Date,
  endsAt: Date,
) {
  const { dayStart, dayEnd } = getStudioDayRangeFromDateKey(dateKey);

  const appointments = await db.appointment.findMany({
    where: {
      masterId,
      status: { notIn: [...NON_BLOCKING_APPOINTMENT_STATUSES] },
      startsAt: { gte: dayStart, lte: dayEnd },
    },
    select: {
      ...APPOINTMENT_BUSY_TIMING_SELECT,
      status: true,
    },
  });

  const hasOverlap = appointments.some((appointment) => {
    const busy = getAppointmentBusyInterval(appointment);
    return busy.startsAt < endsAt && busy.endsAt > startsAt;
  });

  if (hasOverlap) {
    throw new ScheduleBlockConflictError(
      "APPOINTMENT_OVERLAP",
      "Блок пересекается с записью клиента",
    );
  }
}

export async function assertNoActiveAppointmentsOnDay(
  db: ScheduleBlockDbClient,
  masterId: string,
  dateKey: string,
) {
  const { dayStart, dayEnd } = getStudioDayRangeFromDateKey(dateKey);

  const activeCount = await db.appointment.count({
    where: {
      masterId,
      status: { notIn: [...NON_BLOCKING_APPOINTMENT_STATUSES] },
      startsAt: { gte: dayStart, lte: dayEnd },
    },
  });

  if (activeCount > 0) {
    throw new ScheduleBlockConflictError(
      "DAY_HAS_APPOINTMENTS",
      "На этот день уже есть записи",
    );
  }
}

function validateBlockInput(input: ScheduleBlockWriteInput) {
  if (input.isFullDay) {
    if (!isFullDayBlockType(input.blockType)) {
      throw new ScheduleBlockValidationError(
        "INVALID_TYPE",
        "Недопустимый тип для закрытия дня",
      );
    }
    return;
  }

  if (!INTERVAL_BLOCK_TYPES.includes(input.blockType)) {
    throw new ScheduleBlockValidationError(
      "INVALID_TYPE",
      "Недопустимый тип для интервального блока",
    );
  }

  if (!input.startTime || !input.endTime) {
    throw new ScheduleBlockValidationError(
      "MISSING_TIMES",
      "Укажите начало и окончание",
    );
  }

  const startsAt = parseStudioDateTime(input.dateKey, input.startTime);
  const endsAt = parseStudioDateTime(input.dateKey, input.endTime);

  if (endsAt <= startsAt) {
    throw new ScheduleBlockValidationError(
      "INVALID_RANGE",
      "Окончание должно быть позже начала",
    );
  }
}

/**
 * Create schedule block using the provided DB client (supports Serializable txs).
 */
export async function createScheduleBlockWithDb(
  db: ScheduleBlockDbClient,
  input: ScheduleBlockWriteInput,
  meta: ScheduleBlockCreateMeta,
): Promise<ScheduleDayBlock> {
  validateBlockInput(input);
  const { noteDate } = getStudioDayRangeFromDateKey(input.dateKey);
  const origin = meta.origin ?? "ADMIN_UI";

  if (input.isFullDay) {
    await assertNoActiveAppointmentsOnDay(db, input.masterId, input.dateKey);

    const existingFullDay = await db.scheduleBlock.findFirst({
      where: {
        masterId: input.masterId,
        isFullDay: true,
        blockDate: noteDate,
      },
    });

    if (existingFullDay) {
      throw new ScheduleBlockConflictError("FULL_DAY_EXISTS", "День уже закрыт");
    }

    const block = await db.scheduleBlock.create({
      data: {
        masterId: input.masterId,
        blockDate: noteDate,
        isFullDay: true,
        blockType: input.blockType,
        startsAt: null,
        endsAt: null,
        origin,
        createdByUserId: meta.createdByUserId,
      },
    });

    return mapBlock(block);
  }

  const startsAt = parseStudioDateTime(input.dateKey, input.startTime!);
  const endsAt = parseStudioDateTime(input.dateKey, input.endTime!);
  await assertNoAppointmentOverlap(
    db,
    input.masterId,
    input.dateKey,
    startsAt,
    endsAt,
  );

  const block = await db.scheduleBlock.create({
    data: {
      masterId: input.masterId,
      blockDate: noteDate,
      startsAt,
      endsAt,
      isFullDay: false,
      blockType: input.blockType,
      origin,
      createdByUserId: meta.createdByUserId,
    },
  });

  return mapBlock(block);
}

export async function createScheduleBlock(
  input: ScheduleBlockWriteInput,
  createdByUserId: string,
): Promise<ScheduleDayBlock> {
  return createScheduleBlockWithDb(prisma, input, {
    createdByUserId,
    origin: "ADMIN_UI",
  });
}

export async function updateScheduleBlock(
  id: string,
  input: Partial<ScheduleBlockWriteInput>,
): Promise<ScheduleDayBlock> {
  const existing = await prisma.scheduleBlock.findUnique({ where: { id } });
  if (!existing) {
    throw new ScheduleBlockValidationError("NOT_FOUND", "Блок не найден");
  }

  const merged: ScheduleBlockWriteInput = {
    masterId: input.masterId ?? existing.masterId!,
    dateKey:
      input.dateKey ??
      (existing.blockDate
        ? formatDateKeyInStudio(existing.blockDate)
        : existing.startsAt
          ? formatDateKeyInStudio(existing.startsAt)
          : ""),
    isFullDay: input.isFullDay ?? existing.isFullDay,
    blockType: input.blockType ?? existing.blockType,
    startTime: input.startTime,
    endTime: input.endTime,
  };

  if (!merged.startTime && existing.startsAt) {
    merged.startTime = formatStudioTimeInput(existing.startsAt);
  }
  if (!merged.endTime && existing.endsAt) {
    merged.endTime = formatStudioTimeInput(existing.endsAt);
  }

  if (merged.isFullDay) {
    throw new ScheduleBlockValidationError(
      "FULL_DAY_EDIT_FORBIDDEN",
      "Полное закрытие дня редактируется через снятие и повторное создание",
    );
  }

  validateBlockInput(merged);

  const startsAt = parseStudioDateTime(merged.dateKey, merged.startTime!);
  const endsAt = parseStudioDateTime(merged.dateKey, merged.endTime!);
  await assertNoAppointmentOverlap(
    prisma,
    merged.masterId,
    merged.dateKey,
    startsAt,
    endsAt,
  );

  const { noteDate } = getStudioDayRangeFromDateKey(merged.dateKey);

  const block = await prisma.scheduleBlock.update({
    where: { id },
    data: {
      blockDate: noteDate,
      startsAt,
      endsAt,
      blockType: merged.blockType,
      isFullDay: false,
    },
  });

  return mapBlock(block);
}

export async function deleteScheduleBlock(id: string): Promise<void> {
  await prisma.scheduleBlock.delete({ where: { id } });
}

/**
 * Delete only a caller-owned master-command block (provenance-gated).
 */
export async function deleteOwnedMasterScheduleBlock(
  db: ScheduleBlockDbClient,
  input: {
    blockId: string;
    masterId: string;
    requiredOrigin?: ScheduleResourceOrigin;
  },
): Promise<{ blockId: string }> {
  const requiredOrigin = input.requiredOrigin ?? "BOT_MASTER_COMMAND";
  const existing = await db.scheduleBlock.findUnique({
    where: { id: input.blockId },
    select: {
      id: true,
      masterId: true,
      origin: true,
    },
  });

  if (!existing) {
    throw new ScheduleBlockValidationError("NOT_FOUND", "Блок не найден");
  }

  if (existing.masterId !== input.masterId) {
    throw new ScheduleBlockOwnershipError(
      "CROSS_MASTER",
      "Блок принадлежит другому мастеру",
    );
  }

  if (existing.origin !== requiredOrigin) {
    throw new ScheduleBlockOwnershipError(
      "WRONG_ORIGIN",
      "Блок нельзя удалить через master command",
    );
  }

  await db.scheduleBlock.delete({ where: { id: existing.id } });
  return { blockId: existing.id };
}

export async function hasFullDayBlock(
  masterId: string,
  dateKey: string,
): Promise<boolean> {
  const { noteDate } = getStudioDayRangeFromDateKey(dateKey);
  const block = await prisma.scheduleBlock.findFirst({
    where: {
      masterId,
      isFullDay: true,
      blockDate: noteDate,
    },
  });
  return Boolean(block);
}

export { mapBlock as mapScheduleBlockDto };
