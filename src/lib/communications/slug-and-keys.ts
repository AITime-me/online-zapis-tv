/**
 * Автогенерация slug и buttonKey без PII.
 */

const TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function transliterate(value: string): string {
  return value
    .split("")
    .map((char) => {
      const lower = char.toLowerCase();
      if (TRANSLIT[lower] !== undefined) {
        return TRANSLIT[lower];
      }
      return char;
    })
    .join("");
}

export function generateCampaignSlug(name: string): string {
  const base =
    transliterate(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "campaign";

  return base;
}

export function generateUniqueCampaignSlug(
  name: string,
  existingSlugs: Iterable<string>,
): string {
  const taken = new Set(existingSlugs);
  const base = generateCampaignSlug(name);
  if (!taken.has(base)) {
    return base;
  }
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`.slice(0, 80);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}

export function generateButtonKey(input: {
  type: string;
  text: string;
  existingKeys: Iterable<string>;
  index: number;
}): string {
  const taken = new Set(input.existingKeys);
  const typePrefix = input.type.toLowerCase().replace(/_/g, "-").slice(0, 12);
  const textPart =
    transliterate(input.text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || `btn${input.index + 1}`;

  let candidate = `${typePrefix}-${textPart}`.slice(0, 48);
  if (!taken.has(candidate)) {
    return candidate;
  }
  for (let i = 2; i < 1000; i += 1) {
    const next = `${candidate}-${i}`.slice(0, 56);
    if (!taken.has(next)) {
      return next;
    }
  }
  return `${typePrefix}-${input.index}-${Date.now()}`;
}

export function assertNoPiiInTechnicalKey(value: string): void {
  const lower = value.toLowerCase();
  if (
    /phone|email|@|vk_user|peer_id|\d{10,}/.test(lower) ||
    /\+?\d[\d\s()-]{8,}\d/.test(value)
  ) {
    throw new Error("Технический ключ не должен содержать персональные данные");
  }
}
