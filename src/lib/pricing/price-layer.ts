export type ParsedPriceLabel = {
  min: number;
  max: number | null;
};

export type NormalizedPrice = {
  value: number;
  currency: "RUB";
};

/** Числовые границы из БД (priceFrom / priceTo). */
export function fromPriceBounds(
  priceFrom: number | null | undefined,
  priceTo: number | null | undefined,
): ParsedPriceLabel | null {
  const from = priceFrom ?? null;
  const to = priceTo ?? null;

  if (from == null && to == null) {
    return null;
  }

  const min = from ?? to!;
  const max = from != null && to != null && from !== to ? to : null;

  return { min, max };
}

/** Парсит отображаемую строку цены в числовой диапазон. */
export function parsePriceLabel(
  label: string | null | undefined,
): ParsedPriceLabel | null {
  if (!label?.trim()) {
    return null;
  }

  const normalized = label.replace(/\u00a0/g, " ").trim();

  const rangeMatch = normalized.match(/(\d[\d\s]*)\s*[–—-]\s*(\d[\d\s]*)/);
  if (rangeMatch) {
    return {
      min: Number(rangeMatch[1]!.replace(/\s/g, "")),
      max: Number(rangeMatch[2]!.replace(/\s/g, "")),
    };
  }

  const fromMatch = normalized.match(/от\s+(\d[\d\s]*)/i);
  if (fromMatch) {
    return {
      min: Number(fromMatch[1]!.replace(/\s/g, "")),
      max: null,
    };
  }

  const singleMatch = normalized.match(/(\d[\d\s]*)/);
  if (singleMatch) {
    const value = Number(singleMatch[1]!.replace(/\s/g, ""));
    return { min: value, max: value };
  }

  return null;
}

/** Минимальная цена диапазона — базовая для расчётов. */
export function getBasePrice(parsed: ParsedPriceLabel): number {
  return parsed.min;
}

export function normalizePrice(value: number): NormalizedPrice {
  return { value, currency: "RUB" };
}

/** Форматирование цены для UI (не для бизнес-логики). */
export function formatPriceDisplay(
  min: number | null,
  max: number | null,
): string | null {
  if (min == null && max == null) {
    return null;
  }

  if (min != null && max != null && min !== max) {
    return `${min.toLocaleString("ru-RU")}–${max.toLocaleString("ru-RU")} ₽`;
  }

  const value = min ?? max!;

  if (min != null && max == null) {
    return `от ${value.toLocaleString("ru-RU")} ₽`;
  }

  return `${value.toLocaleString("ru-RU")} ₽`;
}
