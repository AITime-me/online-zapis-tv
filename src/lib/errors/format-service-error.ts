import { Prisma } from "@prisma/client";

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

  const firstLine = message.split("\n").find((line) => line.trim().length > 0);
  return firstLine?.trim() || DEFAULT_ERROR_MESSAGE;
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
        meta: error.meta ?? null,
      };
    }

    return {
      message: error.message || DEFAULT_ERROR_MESSAGE,
      code: error.code,
      meta: error.meta ?? null,
    };
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return {
      message: extractPrismaValidationSummary(error.message),
      code: "PRISMA_VALIDATION",
      meta: { prismaMessage: error.message },
    };
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      message: error.message || DEFAULT_ERROR_MESSAGE,
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
    message: error == null ? DEFAULT_ERROR_MESSAGE : String(error),
    code: "UNKNOWN_ERROR",
    meta: error,
  };
}

export function logServiceError(scope: string, error: unknown): FormattedServiceError {
  const formatted = formatServiceError(error);

  console.error(`[${scope}]`, {
    message: formatted.message,
    code: formatted.code,
    meta: formatted.meta,
    stack: error instanceof Error ? error.stack : undefined,
    raw: error,
  });

  return formatted;
}

export function logBookingCreateErrorRaw(error: unknown): FormattedServiceError {
  console.error("[booking create ERROR RAW]", error);
  if (error instanceof Error) {
    console.error("[booking create ERROR RAW] message:", error.message);
    console.error("[booking create ERROR RAW] stack:", error.stack);
  }
  return logServiceError("booking/create", error);
}

function safeSerializeDetail(value: unknown): unknown {
  if (value == null) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
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
