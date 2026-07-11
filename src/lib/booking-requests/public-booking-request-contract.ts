/** Минимальный публичный ответ после создания заявки — без CRM-данных. */
export type PublicBookingRequestCreateResponse = {
  ok: true;
  requestId: string;
  message: string;
};

export const PUBLIC_BOOKING_REQUEST_SUCCESS_MESSAGE =
  "Заявка отправлена. Менеджер студии свяжется с вами.";

export function toPublicBookingRequestCreateResponse(input: {
  id: string;
}): PublicBookingRequestCreateResponse {
  return {
    ok: true,
    requestId: input.id,
    message: PUBLIC_BOOKING_REQUEST_SUCCESS_MESSAGE,
  };
}

/** Запрещённые ключи в публичном ответе заявки. */
export const FORBIDDEN_PUBLIC_BOOKING_REQUEST_KEYS = [
  "client",
  "clientId",
  "possibleDuplicateClients",
  "clientPhone",
  "phone",
  "email",
  "tags",
  "comment",
  "duplicateReason",
  "hasPossibleClientDuplicates",
  "clientLinkStatus",
  "masterId",
  "status",
  "source",
  "type",
  "createdAt",
] as const;

export function collectForbiddenPublicBookingRequestKeys(
  value: Record<string, unknown>,
): string[] {
  const forbidden: string[] = [];
  for (const key of FORBIDDEN_PUBLIC_BOOKING_REQUEST_KEYS) {
    if (key in value) {
      forbidden.push(key);
    }
  }
  if ("request" in value) {
    forbidden.push("request");
  }
  return forbidden;
}
