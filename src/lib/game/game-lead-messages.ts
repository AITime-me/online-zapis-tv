import {
  GIFT_MANAGER_CONFIRMATION_TEXT,
  GIFT_STACKING_RULE_TEXT,
  GIFT_VALIDITY_DAYS,
} from "@/lib/game/gift-activation";

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
  activationConditionText?: string | null;
  validityDays?: number | null;
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
  const condition =
    session?.activationConditionText?.trim() ||
    "Условие получения сообщит менеджер";
  const validityDays =
    session?.validityDays && session.validityDays > 0
      ? session.validityDays
      : GIFT_VALIDITY_DAYS;

  return [
    "Здравствуйте! Я прошла игру «Поймай своё время».",
    "",
    "Мой результат:",
    direction,
    "",
    "Мой подарок:",
    gift,
    "",
    "Условие получения:",
    condition,
    "",
    `Срок действия подарка: ${validityDays} календарных дней.`,
    GIFT_STACKING_RULE_TEXT + ".",
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
  const condition =
    session.activationConditionText?.trim() ||
    "Условие получения — по правилам подарка на момент игры";
  const validityDays =
    session.validityDays && session.validityDays > 0
      ? session.validityDays
      : GIFT_VALIDITY_DAYS;

  return [
    "Клиент прошёл игру «Поймай своё время».",
    "",
    "Результат игры:",
    direction,
    "",
    "Подарок:",
    gift,
    "",
    "Условие получения:",
    condition,
    "",
    `Срок действия: ${validityDays} календарных дней.`,
    GIFT_STACKING_RULE_TEXT + ".",
    GIFT_MANAGER_CONFIRMATION_TEXT + ".",
    "",
    "Сообщение клиента:",
    userText,
  ].join("\n");
}

export function buildServerGameManagerComment(input: {
  gameDirection: string;
  giftName: string;
  userMessage?: string | null;
  activationConditionText?: string | null;
  validityDays?: number | null;
}): string {
  const direction =
    (GAME_DIRECTION_LABELS[input.gameDirection] ?? input.gameDirection.trim()) ||
    "—";
  const gift = input.giftName.trim() || "—";
  const condition =
    input.activationConditionText?.trim() ||
    "Условие получения — по правилам подарка на момент игры";
  const validityDays =
    input.validityDays && input.validityDays > 0
      ? input.validityDays
      : GIFT_VALIDITY_DAYS;

  const lines = [
    "Клиент прошёл игру «Поймай своё время».",
    "",
    "Результат игры:",
    direction,
    "",
    "Подарок (назначен сервером):",
    gift,
    "",
    "Условие получения:",
    condition,
    "",
    `Срок действия: ${validityDays} календарных дней.`,
    GIFT_STACKING_RULE_TEXT + ".",
    GIFT_MANAGER_CONFIRMATION_TEXT + ".",
  ];

  const userText = input.userMessage?.trim();
  if (userText) {
    lines.push("", "Сообщение клиента:", userText);
  }

  return lines.join("\n");
}
