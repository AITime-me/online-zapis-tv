import { randomInt } from "node:crypto";

export function normalizeGiftWeight(probability: number | null | undefined): number {
  return Math.max(0, Math.trunc(probability ?? 0));
}

export function weightedGiftPick<T extends { probability: number }>(
  items: T[],
): T | null {
  const weights = items.map((item) => normalizeGiftWeight(item.probability));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) {
    return null;
  }

  const roll = randomInt(total);
  let cursor = 0;
  for (let index = 0; index < items.length; index += 1) {
    cursor += weights[index]!;
    if (roll < cursor) {
      return items[index]!;
    }
  }

  return items[items.length - 1] ?? null;
}
