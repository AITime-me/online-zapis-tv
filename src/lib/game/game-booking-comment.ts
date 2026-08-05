const CLIENT_GAME_MESSAGE_PREFIX =
  "Здравствуйте! Я прошла игру «Поймай своё время».";

const MANAGER_GAME_MESSAGE_PREFIX = "Клиент прошёл игру «Поймай своё время».";

const MANAGER_USER_SECTION_MARKER = "Сообщение клиента:";

export function isClientGameMessageTemplate(text: string): boolean {
  return text.trimStart().startsWith(CLIENT_GAME_MESSAGE_PREFIX);
}

export function isManagerGameMessageTemplate(text: string): boolean {
  return text.trimStart().startsWith(MANAGER_GAME_MESSAGE_PREFIX);
}

function readManagerTemplateUserSection(text: string): string | null {
  const markerIndex = text.indexOf(MANAGER_USER_SECTION_MARKER);
  if (markerIndex === -1) {
    return null;
  }

  return text.slice(markerIndex + MANAGER_USER_SECTION_MARKER.length).trim();
}

/**
 * Returns only free-form user text for game booking requests.
 * Strips legacy client/manager templates that must not be duplicated server-side.
 */
export function extractGameBookingUserMessage(
  raw: string | null | undefined,
): string | null {
  let text = raw?.trim() ?? "";
  if (!text || text === "—") {
    return null;
  }

  for (let depth = 0; depth < 5; depth += 1) {
    if (isManagerGameMessageTemplate(text)) {
      const inner = readManagerTemplateUserSection(text);
      if (!inner || inner === "—") {
        return null;
      }
      text = inner.trim();
      continue;
    }

    if (isClientGameMessageTemplate(text)) {
      return null;
    }

    return text;
  }

  return null;
}
