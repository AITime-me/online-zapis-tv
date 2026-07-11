export const GAME_PLAY_BOOKING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const GAME_PLAY_BOOKING_REJECTED_MESSAGE =
  "Результат игры недоступен или уже использован";

export type GamePlayBookingRecord = {
  id: string;
  leadId: string | null;
  createdAt: Date;
  gameDirection: string;
  selectedGiftId: string | null;
  selectedGift: { name: string } | null;
};

export function isGamePlayWithinBookingWindow(
  createdAt: Date,
  now: Date,
  maxAgeMs = GAME_PLAY_BOOKING_MAX_AGE_MS,
): boolean {
  return now.getTime() - createdAt.getTime() <= maxAgeMs;
}

export function validateGamePlayBookingRecord(
  play: GamePlayBookingRecord | null,
  now: Date = new Date(),
):
  | { ok: true; giftName: string; gameDirection: string }
  | { ok: false; error: string } {
  if (!play) {
    return { ok: false, error: GAME_PLAY_BOOKING_REJECTED_MESSAGE };
  }

  if (!isGamePlayWithinBookingWindow(play.createdAt, now)) {
    return { ok: false, error: GAME_PLAY_BOOKING_REJECTED_MESSAGE };
  }

  if (play.leadId !== null) {
    return { ok: false, error: GAME_PLAY_BOOKING_REJECTED_MESSAGE };
  }

  if (!play.selectedGiftId || !play.selectedGift?.name?.trim()) {
    return { ok: false, error: GAME_PLAY_BOOKING_REJECTED_MESSAGE };
  }

  return {
    ok: true,
    giftName: play.selectedGift.name.trim(),
    gameDirection: play.gameDirection,
  };
}

export function buildGamePlayConsumeWhere(
  gamePlayId: string,
  minCreatedAt: Date,
) {
  return {
    id: gamePlayId,
    leadId: null,
    selectedGiftId: { not: null },
    createdAt: { gte: minCreatedAt },
  } as const;
}

export function shouldRejectGamePlayLink(linkedCount: number): boolean {
  return linkedCount !== 1;
}
