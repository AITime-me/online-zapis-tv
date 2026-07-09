export const AUTO_CLIENT_TAGS = new Set([
  "игра",
  "подарок",
  "онлайн-запись",
]);

export type ClientTagKind = "manual" | "auto" | "bot";

export type ClientTagDisplay = {
  label: string;
  kind: ClientTagKind;
  suffix: string | null;
};

export function normalizeTagValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function mergeClientTags(
  existing: string[],
  incoming: string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of [...existing, ...incoming]) {
    const trimmed = normalizeTagValue(tag);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

export function isBotClientTag(tag: string): boolean {
  const normalized = tag.trim().toLowerCase();
  return normalized.startsWith("бот:") || normalized.startsWith("bot:");
}

export function isAutoClientTag(tag: string): boolean {
  return AUTO_CLIENT_TAGS.has(tag.trim().toLowerCase());
}

export function getClientTagDisplay(tag: string): ClientTagDisplay {
  const trimmed = normalizeTagValue(tag);
  if (isBotClientTag(trimmed)) {
    const withoutPrefix = trimmed.replace(/^(бот|bot):\s*/i, "").trim();
    return {
      label: withoutPrefix || trimmed,
      kind: "bot",
      suffix: null,
    };
  }

  if (isAutoClientTag(trimmed)) {
    return {
      label: trimmed,
      kind: "auto",
      suffix: "авто",
    };
  }

  return {
    label: trimmed,
    kind: "manual",
    suffix: null,
  };
}

export function clientMatchesTagSearch(
  tags: string[],
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
}

export function canRemoveClientTagInline(tag: string): boolean {
  const display = getClientTagDisplay(tag);
  return display.kind === "manual";
}
