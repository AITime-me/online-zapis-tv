/** Extensible prize type contract for Wheel of Fortune. */

export const GAME_PRIZE_TYPES = [
  "PERCENT_DISCOUNT",
  "GIFT_SERVICE",
  "SERVICE_UPGRADE",
] as const;

export type GamePrizeType = (typeof GAME_PRIZE_TYPES)[number];

export function isGamePrizeType(value: unknown): value is GamePrizeType {
  return (
    typeof value === "string" &&
    (GAME_PRIZE_TYPES as readonly string[]).includes(value)
  );
}

export const GAME_PRIZE_TYPE_LABELS: Record<GamePrizeType, string> = {
  PERCENT_DISCOUNT: "Процентная скидка",
  GIFT_SERVICE: "Подарочная процедура",
  SERVICE_UPGRADE: "Улучшение услуги",
};
