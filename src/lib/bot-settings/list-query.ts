import "server-only";

import type { Prisma } from "@prisma/client";
import { isValidDateKey } from "@/lib/datetime/date-layer";
import {
  BOT_EVENT_LOG_PAGE_SIZES,
  DEFAULT_BOT_EVENT_LOG_PAGE_SIZE,
  type BotEventLogLevelFilter,
  type BotEventLogListQuery,
} from "@/lib/bot-settings/list-contract";

function parsePositiveInt(
  value: string | null,
  fallback: number,
  allowed?: readonly number[],
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  if (allowed && !allowed.includes(parsed)) {
    return fallback;
  }

  return parsed;
}

function parseLevelFilter(value: string | null): BotEventLogLevelFilter {
  if (value === "errors" || value === "events") {
    return value;
  }
  return "all";
}

export function parseBotEventLogListQuery(
  searchParams: URLSearchParams,
): Required<BotEventLogListQuery> {
  return {
    page: parsePositiveInt(searchParams.get("page"), 1),
    pageSize: parsePositiveInt(
      searchParams.get("pageSize"),
      DEFAULT_BOT_EVENT_LOG_PAGE_SIZE,
      BOT_EVENT_LOG_PAGE_SIZES,
    ),
    levelFilter: parseLevelFilter(searchParams.get("levelFilter")),
    dateFrom: searchParams.get("dateFrom")?.trim() ?? "",
    dateTo: searchParams.get("dateTo")?.trim() ?? "",
  };
}

export function buildBotEventLogListWhere(
  query: Required<BotEventLogListQuery>,
): Prisma.BotEventLogWhereInput {
  const where: Prisma.BotEventLogWhereInput = {};

  if (query.levelFilter === "errors") {
    where.level = "error";
  } else if (query.levelFilter === "events") {
    where.level = { not: "error" };
  }

  if (query.dateFrom && isValidDateKey(query.dateFrom)) {
    const from = new Date(`${query.dateFrom}T00:00:00+05:00`);
    where.createdAt = {
      ...(typeof where.createdAt === "object" ? where.createdAt : {}),
      gte: from,
    };
  }

  if (query.dateTo && isValidDateKey(query.dateTo)) {
    const to = new Date(`${query.dateTo}T23:59:59.999+05:00`);
    where.createdAt = {
      ...(typeof where.createdAt === "object" ? where.createdAt : {}),
      lte: to,
    };
  }

  return where;
}
