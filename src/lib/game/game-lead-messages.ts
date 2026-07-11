export const GAME_DIRECTION_LABELS: Record<string, string> = {
  faceCare: "Уход за кожей лица",
  faceMassage: "Массаж лица и уход",
  recovery: "Массаж и восстановление",
  toneCare: "Упругость и сияние кожи",
};

export type GameLeadSession = {
  playId: string | null;
  giftId: string | null;
  giftName: string | null;
  gameDirection: string | null;
  skinNeed: string | null;
  resultType: string | null;
  premiumLevel: number | null;
};

export function resolveGameDirectionLabel(
  session: GameLeadSession | null,
  domLabel?: string | null,
): string {
  const fromDom = domLabel?.trim();
  if (fromDom) {
    return fromDom;
  }

  if (session?.gameDirection && GAME_DIRECTION_LABELS[session.gameDirection]) {
    return GAME_DIRECTION_LABELS[session.gameDirection];
  }

  return "—";
}

export function buildClientGameMessage(
  session: GameLeadSession | null,
  domDirectionLabel?: string | null,
): string {
  const direction = resolveGameDirectionLabel(session, domDirectionLabel);
  const gift = session?.giftName?.trim() || "—";

  return [
    "Здравствуйте! Я прошла игру «Поймай своё время».",
    "",
    "Мой результат:",
    direction,
    "",
    "Мой подарок:",
    gift,
    "",
    "Хочу узнать подробнее и получить подарок к записи.",
  ].join("\n");
}

export function buildManagerGameComment(
  session: GameLeadSession,
  clientMessage: string,
  domDirectionLabel?: string | null,
): string {
  const direction = resolveGameDirectionLabel(session, domDirectionLabel);
  const gift = session.giftName?.trim() || "—";
  const userText = clientMessage.trim() || "—";

  return [
    "Клиент прошёл игру «Поймай своё время».",
    "",
    "Результат игры:",
    direction,
    "",
    "Подарок:",
    gift,
    "",
    "Сообщение клиента:",
    userText,
  ].join("\n");
}

export function buildServerGameManagerComment(input: {
  gameDirection: string;
  giftName: string;
  userMessage?: string | null;
}): string {
  const direction =
    (GAME_DIRECTION_LABELS[input.gameDirection] ?? input.gameDirection.trim()) ||
    "—";
  const gift = input.giftName.trim() || "—";

  const lines = [
    "Клиент прошёл игру «Поймай своё время».",
    "",
    "Результат игры:",
    direction,
    "",
    "Подарок (назначен сервером):",
    gift,
  ];

  const userText = input.userMessage?.trim();
  if (userText) {
    lines.push("", "Сообщение клиента:", userText);
  }

  return lines.join("\n");
}
