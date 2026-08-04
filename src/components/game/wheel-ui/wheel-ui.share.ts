import type {
  WheelPrizeResult,
  WheelProcedureIntent,
  WheelZone,
} from "./wheel-ui.types";
import { INTENT_LABELS, ZONE_LABELS } from "./wheel-ui.constants";

/** Builds share text. Messenger URLs are supplied separately via props. */
export function buildWheelShareMessage(options: {
  result: WheelPrizeResult;
  selectedIntent?: WheelProcedureIntent | null;
  selectedZone?: WheelZone | null;
}): string {
  const { result, selectedIntent = null, selectedZone = null } = options;
  const direction = selectedIntent
    ? INTENT_LABELS[selectedIntent]
    : "не указано";
  const zoneLabel =
    selectedIntent === "undecided"
      ? "не требуется"
      : selectedZone
        ? ZONE_LABELS[selectedZone]
        : "пока не выбрана";

  return [
    "Здравствуйте! Я прошла игру «Колесо фортуны».",
    "",
    `Направление: ${direction}.`,
    `Зона: ${zoneLabel}.`,
    `Мой подарок: ${result.fullName}.`,
    "",
    "Хочу записаться и активировать подарок.",
  ].join("\n");
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    if (typeof document === "undefined") return false;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

export async function copyAndOpenUrl(
  text: string,
  url: string,
): Promise<boolean> {
  const copied = await copyTextToClipboard(text);
  if (typeof window !== "undefined" && url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
  return copied;
}
