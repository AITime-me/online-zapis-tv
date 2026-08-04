import {
  extractGameBookingUserMessage,
} from "@/lib/game/game-booking-comment";
import {
  resolveGameGiftFromPlay,
  type GamePlayBookingRow,
} from "@/lib/game/game-booking-consume-rules";
import { GAME_DIRECTION_LABELS } from "@/lib/game/game-lead-messages";
import {
  parseGiftSnapshot,
  parseRulesSnapshot,
} from "@/lib/game/session/game-session-snapshot";
import { formatWheelInterestZoneDisplay } from "@/lib/game/wheel/interest-zone-labels";
import {
  LEGACY_CATCH_TIME_GAME_TITLE,
  type GameBookingRequestDisplay,
  formatGameBookingRequestCompactComment,
  withoutGameClientMessage,
} from "@/lib/schedule/game-booking-request-display-format";

export {
  LEGACY_CATCH_TIME_GAME_TITLE,
  formatGameBookingRequestCompactComment,
  withoutGameClientMessage,
  type GameBookingRequestDisplay,
};

export type GamePlayDisplaySource = Pick<
  GamePlayBookingRow,
  | "id"
  | "gameDirection"
  | "gameCatalogId"
  | "gameSessionId"
  | "selectedGiftId"
  | "leadId"
  | "consumedAt"
  | "giftSnapshot"
  | "rulesSnapshot"
  | "selectedGift"
  | "gameCatalog"
  | "gameSession"
>;

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function readLabeledBlock(comment: string, labels: string[]): string | null {
  const lines = comment.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    for (const label of labels) {
      const normalizedLabel = label.endsWith(":") ? label : `${label}:`;
      if (line === label || line === normalizedLabel) {
        const next = lines[index + 1]?.trim() ?? "";
        if (next && next !== "—") {
          return next;
        }
        continue;
      }
      if (line.startsWith(normalizedLabel)) {
        const inline = line.slice(normalizedLabel.length).trim();
        if (inline && inline !== "—") {
          return inline;
        }
      }
    }
  }
  return null;
}

function resolveWheelZoneDisplay(giftSnapshot: unknown): string | null {
  if (!giftSnapshot || typeof giftSnapshot !== "object" || Array.isArray(giftSnapshot)) {
    return null;
  }

  const raw = giftSnapshot as {
    confirmedInterest?: unknown;
    confirmedZone?: unknown;
  };

  return formatWheelInterestZoneDisplay({
    confirmedInterest: raw.confirmedInterest,
    confirmedZone: raw.confirmedZone,
  });
}

function resolveCatchTimeDirection(gameDirection: string | null | undefined): string | null {
  const key = gameDirection?.trim() ?? "";
  if (!key || key === "wheel") {
    return null;
  }
  return GAME_DIRECTION_LABELS[key] ?? null;
}

function extractGiftNameFromComment(comment: string | null): string | null {
  if (!comment) {
    return null;
  }

  return (
    readLabeledBlock(comment, [
      "Подарок (назначен сервером):",
      "Итоговый приз:",
      "Подарок:",
      "Мой подарок:",
    ]) ?? null
  );
}

function extractZoneFromComment(comment: string | null): string | null {
  if (!comment) {
    return null;
  }

  const interest = readLabeledBlock(comment, ["Интерес:"]);
  const zone = readLabeledBlock(comment, ["Зона:"]);
  const direction = readLabeledBlock(comment, ["Результат игры:"]);

  if (interest && zone && interest !== zone) {
    return `${interest} · ${zone}`;
  }
  if (interest) {
    return interest;
  }
  if (zone) {
    return zone;
  }
  if (direction && direction !== "—") {
    return direction;
  }
  return null;
}

function extractClientMessageForDisplay(comment: string | null): string | null {
  const extracted = extractGameBookingUserMessage(comment);
  if (!extracted) {
    return null;
  }

  // Nested server/manager templates must never surface as a client message.
  if (/^Клиент прошёл игру «[^»]+»\./u.test(extracted.trimStart())) {
    return null;
  }
  if (
    extracted.includes("Подарок (назначен сервером):") ||
    extracted.includes("Итоговый приз:")
  ) {
    return null;
  }

  return extracted;
}

export function resolveGameCatalogTitleForDisplay(input: {
  rulesSnapshot?: unknown;
  catalogTitle?: string | null;
}): string {
  const rules = parseRulesSnapshot(input.rulesSnapshot);
  return (
    trimOrNull(rules?.catalogTitle) ||
    trimOrNull(input.catalogTitle) ||
    LEGACY_CATCH_TIME_GAME_TITLE
  );
}

export function buildGameBookingRequestDisplay(input: {
  serviceNameSnapshot: string | null;
  comment: string | null;
  play: GamePlayDisplaySource | null;
}): GameBookingRequestDisplay | null {
  if (!input.play) {
    return null;
  }

  const gift = resolveGameGiftFromPlay(input.play);
  const giftFromSnapshot = parseGiftSnapshot(input.play.giftSnapshot);

  const catalogTitle = resolveGameCatalogTitleForDisplay({
    rulesSnapshot: input.play.rulesSnapshot,
    catalogTitle: input.play.gameCatalog?.title,
  });

  const procedure = trimOrNull(input.serviceNameSnapshot);

  const zone =
    resolveWheelZoneDisplay(input.play.giftSnapshot) ||
    resolveCatchTimeDirection(input.play.gameDirection) ||
    extractZoneFromComment(input.comment);

  // Prefer immutable snapshot, then historical comment, then live gift (legacy only).
  const giftName =
    trimOrNull(giftFromSnapshot?.name) ||
    (gift?.giftSnapshot ? trimOrNull(gift.giftName) : null) ||
    extractGiftNameFromComment(input.comment) ||
    trimOrNull(gift?.giftName);

  const clientMessage = extractClientMessageForDisplay(input.comment);

  return {
    catalogTitle,
    procedure,
    zone,
    giftName,
    clientMessage,
  };
}
