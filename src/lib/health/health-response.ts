export type HealthSuccessResponse = {
  ok: true;
  status: "healthy";
  timestamp: string;
};

export type HealthErrorResponse = {
  ok: false;
  status: "unhealthy";
  code: "DB_UNAVAILABLE";
  message: string;
  timestamp: string;
  detail?: string;
};

const GENERIC_DB_ERROR_MESSAGE =
  "Сервис временно недоступен. Повторите попытку позже.";

function sanitizeErrorDetail(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return "Database connection failed";
  }

  const message = error.message.trim();
  if (!message) {
    return "Database connection failed";
  }

  if (/postgres|mysql|mongodb|prisma|DATABASE_URL|connection string/i.test(message)) {
    return "Database connection failed";
  }

  return message;
}

export function buildHealthSuccessResponse(timestamp: string): HealthSuccessResponse {
  return {
    ok: true,
    status: "healthy",
    timestamp,
  };
}

export function buildHealthErrorResponse(
  isProduction: boolean,
  timestamp: string,
  error?: unknown,
): HealthErrorResponse {
  const response: HealthErrorResponse = {
    ok: false,
    status: "unhealthy",
    code: "DB_UNAVAILABLE",
    message: GENERIC_DB_ERROR_MESSAGE,
    timestamp,
  };

  if (!isProduction) {
    response.detail = sanitizeErrorDetail(error);
  }

  return response;
}
