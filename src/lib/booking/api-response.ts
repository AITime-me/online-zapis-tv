const DEFAULT_BOOKING_ERROR =
  "Не удалось создать запись. Попробуйте ещё раз или позвоните в студию.";

export async function readJsonResponse<T>(
  response: Response,
  emptyBodyMessage = DEFAULT_BOOKING_ERROR,
): Promise<{
  data: T | null;
  parseError: string | null;
  rawText: string;
}> {
  const rawText = await response.text();

  if (!rawText.trim()) {
    return { data: null, parseError: emptyBodyMessage, rawText };
  }

  try {
    return { data: JSON.parse(rawText) as T, parseError: null, rawText };
  } catch {
    return {
      data: null,
      parseError: `${emptyBodyMessage} (ответ сервера не JSON)`,
      rawText,
    };
  }
}

export { DEFAULT_BOOKING_ERROR };
