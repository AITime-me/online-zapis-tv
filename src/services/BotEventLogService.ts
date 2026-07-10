import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  BOT_EVENT_LEVEL_LABELS,
  BOT_EVENT_TYPE_LABELS,
  type BotEventLevel,
  type BotEventType,
} from "@/lib/bot-settings/event-log";
import type { BotEventLogListQuery } from "@/lib/bot-settings/list-contract";
import { buildBotEventLogListWhere } from "@/lib/bot-settings/list-query";
import type { BotEventLogDto } from "@/types/bot-event-log";

export type { BotEventLogDto };

const SENSITIVE_METADATA_KEYS = new Set([
  "token",
  "apikey",
  "api_key",
  "password",
  "secret",
  "authorization",
  "phone",
  "email",
  "normalizedphone",
  "clientphone",
]);

function isBotEventLevel(value: string): value is BotEventLevel {
  return value === "info" || value === "warning" || value === "error";
}

function getTypeLabel(type: string): string {
  if (type in BOT_EVENT_TYPE_LABELS) {
    return BOT_EVENT_TYPE_LABELS[type as BotEventType];
  }
  return type;
}

function sanitizeMetadata(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const sanitized: Record<string, Prisma.JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_METADATA_KEYS.has(key.toLowerCase())) {
      continue;
    }
    if (typeof entry === "string" && entry.length > 500) {
      sanitized[key] = `${entry.slice(0, 497)}…`;
      continue;
    }
    sanitized[key] = entry as Prisma.JsonValue;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function mapBotEventLog(
  row: Awaited<ReturnType<typeof prisma.botEventLog.findMany>>[number],
): BotEventLogDto {
  const level = isBotEventLevel(row.level) ? row.level : "info";

  return {
    id: row.id,
    level,
    levelLabel: BOT_EVENT_LEVEL_LABELS[level],
    type: row.type,
    typeLabel: getTypeLabel(row.type),
    channel: row.channel,
    title: row.title,
    message: row.message,
    clientId: row.clientId,
    bookingRequestId: row.bookingRequestId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listBotEventLogsPaginated(
  query: Required<BotEventLogListQuery>,
): Promise<{
  events: BotEventLogDto[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = query.pageSize ?? 25;
  const where = buildBotEventLogListWhere(query);

  const [rows, total] = await Promise.all([
    prisma.botEventLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        level: true,
        type: true,
        channel: true,
        title: true,
        message: true,
        clientId: true,
        bookingRequestId: true,
        metadata: true,
        createdAt: true,
      },
    }),
    prisma.botEventLog.count({ where }),
  ]);

  return {
    events: rows.map((row) => {
      const mapped = mapBotEventLog(row);
      const metadata = sanitizeMetadata(row.metadata);
      if (metadata && !mapped.message) {
        mapped.message = JSON.stringify(metadata);
      }
      return mapped;
    }),
    total,
    page,
    pageSize,
  };
}
