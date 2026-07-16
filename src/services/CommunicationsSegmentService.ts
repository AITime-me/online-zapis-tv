import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  buildSegmentWhere,
  SYSTEM_COMMUNICATION_SEGMENTS,
  type CommSegmentDefinition,
} from "@/lib/communications/segments";
import type { CommSegmentDto } from "@/types/communications";

export class CommunicationsSegmentValidationError extends Error {}

function toDto(
  row: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    definition: unknown;
    isSystem: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  estimatedCount: number | null,
): CommSegmentDto {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    definition: row.definition,
    isSystem: row.isSystem,
    estimatedCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function ensureSystemSegments(): Promise<void> {
  for (const segment of SYSTEM_COMMUNICATION_SEGMENTS) {
    await prisma.communicationSegment.upsert({
      where: { key: segment.key },
      create: {
        key: segment.key,
        name: segment.name,
        description: segment.description,
        definition: segment.definition as unknown as Prisma.InputJsonValue,
        isSystem: true,
      },
      update: {
        name: segment.name,
        description: segment.description,
        definition: segment.definition as unknown as Prisma.InputJsonValue,
        isSystem: true,
      },
    });
  }
}

export async function countSegmentAudience(
  definition: CommSegmentDefinition,
): Promise<number> {
  const where = buildSegmentWhere(definition);

  if (definition.excludedOnly) {
    const [contactCount, suppressionCount] = await Promise.all([
      prisma.communicationContact.count({ where }),
      prisma.communicationSuppression.count({
        where: { channel: definition.channel ?? "VK" },
      }),
    ]);
    return Math.max(contactCount, suppressionCount);
  }

  if (definition.requireEligible) {
    const contacts = await prisma.communicationContact.findMany({
      where,
      select: {
        channel: true,
        communityId: true,
        channelUserId: true,
      },
    });
    if (contacts.length === 0) {
      return 0;
    }
    const suppressions = await prisma.communicationSuppression.findMany({
      where: {
        OR: contacts.map((c) => ({
          channel: c.channel,
          communityId: c.communityId,
          channelUserId: c.channelUserId,
        })),
      },
      select: { channelUserId: true, communityId: true, channel: true },
    });
    const suppressed = new Set(
      suppressions.map(
        (s) => `${s.channel}:${s.communityId}:${s.channelUserId}`,
      ),
    );
    return contacts.filter(
      (c) => !suppressed.has(`${c.channel}:${c.communityId}:${c.channelUserId}`),
    ).length;
  }

  return prisma.communicationContact.count({ where });
}

export async function listCommunicationSegments(): Promise<CommSegmentDto[]> {
  await ensureSystemSegments();
  const rows = await prisma.communicationSegment.findMany({
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });

  const result: CommSegmentDto[] = [];
  for (const row of rows) {
    const definition = row.definition as CommSegmentDefinition;
    const estimatedCount = await countSegmentAudience(definition);
    result.push(toDto(row, estimatedCount));
  }
  return result;
}

export async function getSegmentById(id: string) {
  await ensureSystemSegments();
  return prisma.communicationSegment.findUnique({ where: { id } });
}

export async function recountSegmentById(id: string): Promise<number> {
  const segment = await getSegmentById(id);
  if (!segment) {
    throw new CommunicationsSegmentValidationError("Сегмент не найден");
  }
  return countSegmentAudience(segment.definition as CommSegmentDefinition);
}
