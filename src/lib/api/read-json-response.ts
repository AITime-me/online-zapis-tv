export async function readApiJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(
      response.ok
        ? "Сервер вернул пустой ответ"
        : `Ошибка сервера (${response.status}). Обновите страницу или перезапустите dev server.`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Некорректный ответ сервера (${response.status}).${
        response.ok
          ? ""
          : " Проверьте логи сервера и выполните npx prisma generate, если недавно менялась схема."
      }`,
    );
  }
}
