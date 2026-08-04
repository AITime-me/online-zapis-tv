import type { WheelPublicInterestKey } from "@/lib/game/wheel/public-interest";
import type { WheelPublicSectorLabel } from "@/lib/game/wheel/wheel-public-dto";
import {
  INTENT_LABELS,
  ZONE_LABELS,
} from "@/components/game/wheel-ui/wheel-ui.constants";
import type {
  WheelProcedureIntent,
  WheelSector,
  WheelZone,
} from "@/components/game/wheel-ui/wheel-ui.types";

export type WheelCompleteInterestPayload = {
  interest: WheelPublicInterestKey;
  confirmedZone?: WheelZone;
};

/**
 * Maps UI preferences to the existing /complete public interest contract.
 * Never sends donor intent "primary" to the API.
 */
export function mapUiPreferencesToCompletePayload(input: {
  intent: WheelProcedureIntent | null;
  zone: WheelZone | null;
}):
  | { ok: true; payload: WheelCompleteInterestPayload }
  | { ok: false; error: string } {
  const { intent, zone } = input;

  if (!intent) {
    return { ok: false, error: "Выберите тип процедуры" };
  }

  if (intent === "undecided") {
    return { ok: true, payload: { interest: "undecided" } };
  }

  if (intent === "primary") {
    if (!zone) {
      return { ok: false, error: "Выберите зону" };
    }
    return { ok: true, payload: { interest: zone } };
  }

  if (intent === "refresh" || intent === "cover") {
    if (!zone) {
      return { ok: false, error: "Выберите зону" };
    }
    return {
      ok: true,
      payload: { interest: intent, confirmedZone: zone },
    };
  }

  return { ok: false, error: "Неизвестный тип процедуры" };
}

/** Build 16 presentation sectors from production public labels. */
export function mapSectorLabelsToWheelSectors(
  labels: WheelPublicSectorLabel[],
): WheelSector[] {
  return labels.map((label) => ({
    id: String(label.sectorIndex),
    shortLabel: makeShortLabel(label.prizeDisplayName),
    fullName: label.prizeDisplayName,
  }));
}

export function makeShortLabel(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "Подарок";
  const discountMatch = trimmed.match(/^Скидка\s+\d+%/u);
  if (discountMatch) {
    return discountMatch[0];
  }
  const firstWord = trimmed.split(/\s+/)[0] ?? trimmed;
  if (firstWord.length <= 10) return firstWord;
  return `${firstWord.slice(0, 9)}…`;
}

export function buildProductionWheelShareMessage(input: {
  prizeDisplayName: string;
  intent: WheelProcedureIntent | null;
  zone: WheelZone | null;
}): string {
  const direction = input.intent
    ? INTENT_LABELS[input.intent]
    : "не указано";
  const zoneLabel =
    input.intent === "undecided"
      ? "не требуется"
      : input.zone
        ? ZONE_LABELS[input.zone]
        : "пока не выбрана";

  return [
    "Здравствуйте! Я прошла игру «Колесо фортуны».",
    "",
    `Направление: ${direction}.`,
    `Зона: ${zoneLabel}.`,
    `Мой подарок: ${input.prizeDisplayName}.`,
    "",
    "Хочу записаться и активировать подарок.",
  ].join("\n");
}

export function sectorIdFromIndex(sectorIndex: number): string {
  return String(sectorIndex);
}
