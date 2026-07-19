import { extractGameBookingUserMessage } from "@/lib/game/game-booking-comment";
import { resolveGameDirectionLabel } from "@/lib/game/game-lead-messages";
import {
  GIFT_MANAGER_CONFIRMATION_TEXT,
  GIFT_STACKING_RULE_TEXT,
  GIFT_VALIDITY_DAYS,
} from "@/lib/game/gift-activation";
import {
  parseGiftSnapshot,
  parseRulesSnapshot,
  type GiftSnapshot,
  type RulesSnapshot,
} from "@/lib/game/session/game-session-snapshot";
import { hashOpaqueToken } from "@/lib/game/session/game-session-token";
import { isCanonicalUuid } from "@/lib/booking-requests/idempotency-contract";

export const GAME_BOOKING_UNAVAILABLE_MESSAGE =
  "Результат игры недоступен или уже использован. Пожалуйста, пройдите игру ещё раз.";

export type GameSessionStatusDto =
  | "ACTIVE"
  | "COMPLETED"
  | "CONSUMED"
  | "EXPIRED";

export type GamePlayBookingRow = {
  id: string;
  gameDirection: string;
  gameCatalogId: string | null;
  gameSessionId: string | null;
  selectedGiftId: string | null;
  leadId: string | null;
  consumedAt: Date | null;
  giftSnapshot: unknown;
  rulesSnapshot: unknown;
  selectedGift: { name: string; shortDescription: string } | null;
  gameCatalog: { id: string; slug: string; title: string } | null;
  gameSession: {
    id: string;
    gameCatalogId: string;
    tokenHash: string | null;
    status: GameSessionStatusDto;
    claimExpiresAt: Date | null;
    consumedAt: Date | null;
  } | null;
};

export type ResolvedGameGift = {
  giftName: string;
  giftDescription: string | null;
  giftSnapshot: GiftSnapshot | null;
  activationConditionText: string | null;
  validityDays: number | null;
};

export function sessionTokenMatchesHash(
  sessionToken: string | null | undefined,
  tokenHash: string | null | undefined,
): boolean {
  const token = sessionToken?.trim();
  const hash = tokenHash?.trim();
  if (!token || !hash) {
    return false;
  }
  return hashOpaqueToken(token) === hash;
}

export function resolveGameGiftFromPlay(
  play: GamePlayBookingRow,
): ResolvedGameGift | null {
  const snapshot = parseGiftSnapshot(play.giftSnapshot);
  if (snapshot) {
    return {
      giftName: snapshot.name.trim(),
      giftDescription: snapshot.shortDescription.trim() || null,
      giftSnapshot: snapshot,
      activationConditionText: snapshot.activationConditionText.trim() || null,
      validityDays: snapshot.validityDays,
    };
  }

  if (play.gameSessionId && play.selectedGift?.name?.trim()) {
    return {
      giftName: play.selectedGift.name.trim(),
      giftDescription: play.selectedGift.shortDescription?.trim() || null,
      giftSnapshot: null,
      activationConditionText: null,
      validityDays: null,
    };
  }

  return null;
}

export function buildServerGameBookingComment(input: {
  play: GamePlayBookingRow;
  gift: ResolvedGameGift;
  userMessage?: string | null;
}): string {
  const rules = parseRulesSnapshot(input.play.rulesSnapshot);
  const catalogTitle =
    rules?.catalogTitle?.trim() ||
    input.play.gameCatalog?.title?.trim() ||
    "Поймай своё время";

  const direction = resolveGameDirectionLabel(
    {
      playId: input.play.id,
      giftId: input.gift.giftSnapshot?.giftId ?? input.play.selectedGiftId,
      giftName: input.gift.giftName,
      gameDirection: input.play.gameDirection,
      skinNeed: null,
      resultType: null,
      premiumLevel: null,
    },
    null,
  );

  const condition =
    input.gift.activationConditionText?.trim() ||
    "Условие получения — по правилам подарка на момент игры";
  const validityDays =
    input.gift.validityDays && input.gift.validityDays > 0
      ? input.gift.validityDays
      : GIFT_VALIDITY_DAYS;

  const lines = [
    `Клиент прошёл игру «${catalogTitle}».`,
    "",
    "Результат игры:",
    direction,
    "",
    "Подарок (назначен сервером):",
    input.gift.giftName,
  ];

  if (input.gift.giftDescription) {
    lines.push("", "Описание подарка:", input.gift.giftDescription);
  }

  lines.push(
    "",
    "Условие получения:",
    condition,
    "",
    `Срок действия: ${validityDays} календарных дней.`,
    GIFT_STACKING_RULE_TEXT + ".",
    GIFT_MANAGER_CONFIRMATION_TEXT + ".",
  );

  const userText = input.userMessage?.trim();
  if (userText) {
    lines.push("", "Сообщение клиента:", userText);
  }

  return lines.join("\n");
}

export type GameBookingValidationContext = {
  play: GamePlayBookingRow;
  gift: ResolvedGameGift;
  session: NonNullable<GamePlayBookingRow["gameSession"]>;
  rules: RulesSnapshot | null;
};

export function validateGamePlayIdFormat(gamePlayId: string): boolean {
  return isCanonicalUuid(gamePlayId);
}

export const GAME_INVALID_REQUEST_CODE = "GAME_INVALID_REQUEST";

export type GamePlayIdResolution =
  | { kind: "absent" }
  | { kind: "game"; gamePlayId: string };

export function resolveGamePlayIdInput(
  raw: string | null | undefined,
):
  | { ok: true; resolution: GamePlayIdResolution }
  | { ok: false; code: typeof GAME_INVALID_REQUEST_CODE } {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return { ok: true, resolution: { kind: "absent" } };
  }

  if (!validateGamePlayIdFormat(trimmed)) {
    return { ok: false, code: GAME_INVALID_REQUEST_CODE };
  }

  return { ok: true, resolution: { kind: "game", gamePlayId: trimmed } };
}

export function validateGameBookingForFirstSubmit(
  play: GamePlayBookingRow | null,
  sessionToken: string | null,
  now: Date = new Date(),
):
  | { ok: true; context: GameBookingValidationContext }
  | {
      ok: false;
      code:
        | "GAME_RESULT_UNAVAILABLE"
        | "GAME_SESSION_OWNERSHIP_FAILED"
        | "GAME_SESSION_EXPIRED";
    } {
  if (!play || !validateGamePlayIdFormat(play.id)) {
    return { ok: false, code: "GAME_RESULT_UNAVAILABLE" };
  }

  if (!play.gameSessionId || !play.gameSession) {
    return { ok: false, code: "GAME_RESULT_UNAVAILABLE" };
  }

  const session = play.gameSession;

  if (!play.gameCatalog || play.gameCatalogId !== session.gameCatalogId) {
    return { ok: false, code: "GAME_RESULT_UNAVAILABLE" };
  }

  if (!sessionTokenMatchesHash(sessionToken, session.tokenHash)) {
    return { ok: false, code: "GAME_SESSION_OWNERSHIP_FAILED" };
  }

  if (session.status !== "COMPLETED") {
    return { ok: false, code: "GAME_RESULT_UNAVAILABLE" };
  }

  if (!session.claimExpiresAt || now.getTime() >= session.claimExpiresAt.getTime()) {
    return { ok: false, code: "GAME_SESSION_EXPIRED" };
  }

  if (session.consumedAt !== null) {
    return { ok: false, code: "GAME_RESULT_UNAVAILABLE" };
  }

  if (play.consumedAt !== null || play.leadId !== null) {
    return { ok: false, code: "GAME_RESULT_UNAVAILABLE" };
  }

  if (!play.selectedGiftId) {
    return { ok: false, code: "GAME_RESULT_UNAVAILABLE" };
  }

  const gift = resolveGameGiftFromPlay(play);
  if (!gift?.giftName) {
    return { ok: false, code: "GAME_RESULT_UNAVAILABLE" };
  }

  return {
    ok: true,
    context: {
      play,
      gift,
      session,
      rules: parseRulesSnapshot(play.rulesSnapshot),
    },
  };
}

export function validateGameBookingForIdempotentRetry(input: {
  play: GamePlayBookingRow | null;
  sessionToken: string | null;
  bookingRequestId: string;
  gamePlayId: string;
}):
  | { ok: true; context: GameBookingValidationContext }
  | { ok: false; code: "GAME_RESULT_UNAVAILABLE" | "GAME_SESSION_OWNERSHIP_FAILED" } {
  const { play, sessionToken, bookingRequestId, gamePlayId } = input;

  if (!play || play.id !== gamePlayId || !play.gameSessionId || !play.gameSession) {
    return { ok: false, code: "GAME_RESULT_UNAVAILABLE" };
  }

  const session = play.gameSession;

  if (!play.gameCatalog || play.gameCatalogId !== session.gameCatalogId) {
    return { ok: false, code: "GAME_RESULT_UNAVAILABLE" };
  }

  if (!sessionTokenMatchesHash(sessionToken, session.tokenHash)) {
    return { ok: false, code: "GAME_SESSION_OWNERSHIP_FAILED" };
  }

  if (play.leadId !== bookingRequestId) {
    return { ok: false, code: "GAME_RESULT_UNAVAILABLE" };
  }

  const gift = resolveGameGiftFromPlay(play);
  if (!gift?.giftName) {
    return { ok: false, code: "GAME_RESULT_UNAVAILABLE" };
  }

  return {
    ok: true,
    context: {
      play,
      gift,
      session,
      rules: parseRulesSnapshot(play.rulesSnapshot),
    },
  };
}

export function extractGameBookingCommentForPayload(
  rawComment: string | null | undefined,
): string | null {
  return extractGameBookingUserMessage(rawComment);
}
