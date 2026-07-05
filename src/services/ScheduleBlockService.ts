import type { AppointmentStatus, ScheduleBlockType } from "@prisma/client";
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
  constructor(message: string) {
    super(message);
    this.name = "ScheduleBlockConflictError";
  }
}

export class ScheduleBlockValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleBlockValidationError";
  }
}

export type ScheduleBlockWriteInput = {
  masterId: string;
  dateKey: string;
  isFullDay: boolean;
  blockType: ScheduleBlockType;
  startTime?: string;
  endTime?: string;
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

async function assertNoAppointmentOverlap(
  masterId: string,
  dateKey: string,
  startsAt: Date,
  endsAt: Date,
  excludeBlockId?: string,
) {
  const { dayStart, dayEnd } = getStudioDayRangeFromDateKey(dateKey);

  const appointments = await prisma.appointment.findMany({
    where: {
      masterId,
      status: { not: "CANCELLED" },
      startsAt: { gte: dayStart, lte: dayEnd },
    },
    select: { id: true, startsAt: true, endsAt: true },
  });

  const hasOverlap = appointments.some(
    (appointment) =>
      appointment.startsAt < endsAt && appointment.endsAt > startsAt,
  );

  if (hasOverlap) {
    throw new ScheduleBlockConflictError(
      "Блок пересекается с записью клиента",
    );
  }

  void excludeBlockId;
}

async function assertNoActiveAppointmentsOnDay(
  masterId: string,
  dateKey: string,
) {
  const { dayStart, dayEnd } = getStudioDayRangeFromDateKey(dateKey);

  const activeCount = await prisma.appointment.count({
    where: {
      masterId,
      status: { not: "CANCELLED" },
      startsAt: { gte: dayStart, lte: dayEnd },
    },
  });

  if (activeCount > 0) {
    throw new ScheduleBlockConflictError("На этот день уже есть записи");
  }
}

function validateBlockInput(input: ScheduleBlockWriteInput) {
  if (input.isFullDay) {
    if (!isFullDayBlockType(input.blockType)) {
      throw new ScheduleBlockValidationError(
        "Недопустимый тип для закрытия дня",
      );
    }
    return;
  }

  if (!INTERVAL_BLOCK_TYPES.includes(input.blockType)) {
    throw new ScheduleBlockValidationError(
      "Недопустимый тип для интервального блока",
    );
  }

  if (!input.startTime || !input.endTime) {
    throw new ScheduleBlockValidationError("Укажите начало и окончание");
  }

  const startsAt = parseStudioDateTime(input.dateKey, input.startTime);
  const endsAt = parseStudioDateTime(input.dateKey, input.endTime);

  if (endsAt <= startsAt) {
    throw new ScheduleBlockValidationError("Окончание должно быть позже начала");
  }
}

export async function createScheduleBlock(
  input: ScheduleBlockWriteInput,
  createdByUserId: string,
): Promise<ScheduleDayBlock> {
  validateBlockInput(input);
  const { noteDate } = getStudioDayRangeFromDateKey(input.dateKey);

  if (input.isFullDay) {
    await assertNoActiveAppointmentsOnDay(input.masterId, input.dateKey);

    const existingFullDay = await prisma.scheduleBlock.findFirst({
      where: {
        masterId: input.masterId,
        isFullDay: true,
        blockDate: noteDate,
      },
    });

    if (existingFullDay) {
      throw new ScheduleBlockConflictError("День уже закрыт");
    }

    const block = await prisma.scheduleBlock.create({
      data: {
        masterId: input.masterId,
        blockDate: noteDate,
        isFullDay: true,
        blockType: input.blockType,
        startsAt: null,
        endsAt: null,
        createdByUserId,
      },
    });

    return mapBlock(block);
  }

  const startsAt = parseStudioDateTime(input.dateKey, input.startTime!);
  const endsAt = parseStudioDateTime(input.dateKey, input.endTime!);
  await assertNoAppointmentOverlap(
    input.masterId,
    input.dateKey,
    startsAt,
    endsAt,
  );

  const block = await prisma.scheduleBlock.create({
    data: {
      masterId: input.masterId,
      blockDate: noteDate,
      startsAt,
      endsAt,
      isFullDay: false,
      blockType: input.blockType,
      createdByUserId,
    },
  });

  return mapBlock(block);
}

export async function updateScheduleBlock(
  id: string,
  input: Partial<ScheduleBlockWriteInput>,
): Promise<ScheduleDayBlock> {
  const existing = await prisma.scheduleBlock.findUnique({ where: { id } });
  if (!existing) {
    throw new ScheduleBlockValidationError("Блок не найден");
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
      "Полное закрытие дня редактируется через снятие и повторное создание",
    );
  }

  validateBlockInput(merged);

  const startsAt = parseStudioDateTime(merged.dateKey, merged.startTime!);
  const endsAt = parseStudioDateTime(merged.dateKey, merged.endTime!);
  await assertNoAppointmentOverlap(
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
