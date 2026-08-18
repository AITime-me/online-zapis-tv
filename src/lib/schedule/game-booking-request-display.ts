import { extractGameBookingUserMessage } from "@/lib/game/game-booking-comment";
import {
  resolveGameGiftFromPlay,
  type GamePlayBookingRow,
} from "@/lib/game/game-booking-consume-rules";
import { GAME_DIRECTION_LABELS } from "@/lib/game/game-lead-messages";
import {
  parseGiftSnapshot,
  parseRulesSnapshot,
} from "@/lib/game/session/game-session-snapshot";
import {
  resolveWheelInterestLabel,
  resolveWheelZoneLabel,
} from "@/lib/game/wheel/interest-zone-labels";
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

function resolveWheelProcedureAndZone(giftSnapshot: unknown): {
  procedure: string | null;
  zone: string | null;
} {
  if (!giftSnapshot || typeof giftSnapshot !== "object" || Array.isArray(giftSnapshot)) {
    return { procedure: null, zone: null };
  }

  const raw = giftSnapshot as {
    confirmedInterest?: unknown;
    confirmedZone?: unknown;
  };

  return {
    procedure: resolveWheelInterestLabel(raw.confirmedInterest),
    zone: resolveWheelZoneLabel(raw.confirmedZone),
  };
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
      "Итоговый подарок:",
      "Итоговый приз:",
      "Подарок (назначен сервером):",
      "Подарок:",
      "Мой подарок:",
    ]) ?? null
  );
}

function extractProcedureFromComment(comment: string | null): string | null {
  if (!comment) {
    return null;
  }
  return (
    resolveWheelInterestLabel(readLabeledBlock(comment, ["Интерес:", "Процедура:"])) ||
    readLabeledBlock(comment, ["Процедура:", "Интерес:", "Результат игры:"])
  );
}

function extractZoneFromComment(comment: string | null): string | null {
  if (!comment) {
    return null;
  }
  const raw = readLabeledBlock(comment, ["Зона:"]);
  return resolveWheelZoneLabel(raw) || (raw && raw !== "unknown" ? raw : null);
}

function extractClientMessageForDisplay(comment: string | null): string | null {
  const extracted = extractGameBookingUserMessage(comment);
  if (!extracted) {
    return null;
  }

  if (/^Клиент прошёл игру «[^»]+»\./u.test(extracted.trimStart())) {
    return null;
  }
  if (
    extracted.includes("Подарок (назначен сервером):") ||
    extracted.includes("Итоговый приз:") ||
    extracted.includes("Итоговый подарок:")
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
  const wheelFields = resolveWheelProcedureAndZone(input.play.giftSnapshot);

  const catalogTitle = resolveGameCatalogTitleForDisplay({
    rulesSnapshot: input.play.rulesSnapshot,
    catalogTitle: input.play.gameCatalog?.title,
  });

  const procedure =
    trimOrNull(input.serviceNameSnapshot) ||
    wheelFields.procedure ||
    extractProcedureFromComment(input.comment);

  const zone =
    wheelFields.zone ||
    resolveCatchTimeDirection(input.play.gameDirection) ||
    extractZoneFromComment(input.comment);

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
