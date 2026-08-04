export const LEGACY_CATCH_TIME_GAME_TITLE = "Поймай своё время";

export type GameBookingRequestDisplay = {
  catalogTitle: string;
  procedure: string | null;
  zone: string | null;
  giftName: string | null;
  clientMessage: string | null;
};

/** Compact manager-facing body. Empty lines omitted. */
export function formatGameBookingRequestCompactComment(
  display: GameBookingRequestDisplay,
): string {
  const lines: string[] = [];
  if (display.procedure) {
    lines.push(`Процедура: ${display.procedure}`);
  }
  if (display.zone) {
    lines.push(`Зона: ${display.zone}`);
  }
  if (display.giftName) {
    lines.push(`Подарок: ${display.giftName}`);
  }
  if (display.clientMessage) {
    lines.push(`Сообщение клиента: ${display.clientMessage}`);
  }
  return lines.join("\n");
}

export function withoutGameClientMessage(
  display: GameBookingRequestDisplay | null | undefined,
): GameBookingRequestDisplay | null {
  if (!display) {
    return null;
  }
  return {
    catalogTitle: display.catalogTitle,
    procedure: display.procedure,
    zone: display.zone,
    giftName: display.giftName,
    clientMessage: null,
  };
}
