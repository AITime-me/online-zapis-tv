import { Prisma } from "@prisma/client";
import { redactForLog, safeLogError } from "@/lib/logging/redact";

export type FormattedServiceError = {
  message: string;
  code: string;
  meta: unknown;
};

export type ApiErrorBody = {
  ok: false;
  error: string;
  code: string;
  detail?: unknown;
  stack?: string;
};

const DEFAULT_ERROR_MESSAGE = "Внутренняя ошибка сервера";

function extractPrismaValidationSummary(message: string): string {
  const unknownArgument = message.match(/Unknown argument `([^`]+)`/);
  if (unknownArgument) {
    const field = unknownArgument[1];
    if (field === "appliedPromotions") {
      return "Схема БД устарела: не применена миграция applied_promotions. Выполните npx prisma migrate deploy && npx prisma generate и перезапустите сервер.";
    }
    return `Ошибка схемы БД: неизвестное поле «${field}». Проверьте миграции Prisma.`;
  }

  const invalidEnum = message.match(
    /Invalid value for argument `([^`]+)`\. Expected (\w+)/,
  );
  if (invalidEnum) {
    return `Ошибка схемы: некорректное значение «${invalidEnum[1]}». Выполните npx prisma generate и перезапустите dev server.`;
  }

  const firstLine = message.split("\n").find((line) => line.trim().length > 0);
  return firstLine?.trim() || DEFAULT_ERROR_MESSAGE;
}

function sanitizePrismaMeta(meta: unknown): unknown {
  return redactForLog(meta);
}

export function formatServiceError(error: unknown): FormattedServiceError {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target.join(", ")
        : String(error.meta?.target ?? "unique field");
      return {
        message: `Конфликт уникальности (${target}). Запись уже существует.`,
        code: error.code,
        meta: sanitizePrismaMeta(error.meta ?? null),
      };
    }

    return {
      message: DEFAULT_ERROR_MESSAGE,
      code: error.code,
      meta: sanitizePrismaMeta(error.meta ?? null),
    };
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return {
      message: extractPrismaValidationSummary(error.message),
      code: "PRISMA_VALIDATION",
      meta: process.env.NODE_ENV === "production" ? null : { prismaMessage: error.message },
    };
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      message: DEFAULT_ERROR_MESSAGE,
      code: "PRISMA_INIT",
      meta: null,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message || DEFAULT_ERROR_MESSAGE,
      code: error.name || "ERROR",
      meta: null,
    };
  }

  return {
    message: error == null ? DEFAULT_ERROR_MESSAGE : DEFAULT_ERROR_MESSAGE,
    code: "UNKNOWN_ERROR",
    meta: null,
  };
}

export function logServiceError(scope: string, error: unknown): FormattedServiceError {
  const formatted = formatServiceError(error);

  safeLogError(scope, error, {
    message: formatted.message,
    code: formatted.code,
    meta: formatted.meta,
  });

  return formatted;
}

export function logBookingCreateErrorRaw(error: unknown): FormattedServiceError {
  return logServiceError("booking/create", error);
}

function safeSerializeDetail(value: unknown): unknown {
  if (value == null) {
    return null;
  }

  try {
    return redactForLog(JSON.parse(JSON.stringify(value)));
  } catch {
    return "[UNSERIALIZABLE]";
  }
}

export function toApiErrorBody(
  error: unknown,
  options?: { includeStack?: boolean },
): ApiErrorBody {
  const formatted = formatServiceError(error);
  const includeStack =
    options?.includeStack ?? process.env.NODE_ENV !== "production";

  return {
    ok: false,
    error: formatted.message,
    code: formatted.code,
    detail: safeSerializeDetail(formatted.meta),
    ...(includeStack && error instanceof Error && error.stack
      ? { stack: error.stack }
      : {}),
  };
}
