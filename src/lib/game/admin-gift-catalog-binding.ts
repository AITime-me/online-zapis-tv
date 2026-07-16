import { isCanonicalUuid } from "@/lib/booking-requests/idempotency-contract";

export const GAME_GIFT_CATALOG_REQUIRED_ERROR =
  "Подарок должен быть привязан к каталогу игры";

export const GAME_GIFT_CATALOG_MISMATCH_ERROR =
  "Нельзя изменить привязку подарка к другой игре";

export const GAME_GIFT_CATALOG_NOT_FOUND_ERROR =
  "Каталог игры для подарка не найден";

export const GAME_GIFT_ORPHAN_FORBIDDEN_ERROR =
  "Подарок без привязки к каталогу недопустим";

export function normalizeRequiredGameCatalogId(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  if (!isCanonicalUuid(trimmed)) {
    return null;
  }
  return trimmed;
}

export function assertCreateGiftCatalogId(
  gameCatalogId: string | null | undefined,
): string {
  const normalized = normalizeRequiredGameCatalogId(gameCatalogId);
  if (!normalized) {
    throw new Error(GAME_GIFT_CATALOG_REQUIRED_ERROR);
  }
  return normalized;
}

export function assertGiftBelongsToCatalog(input: {
  giftCatalogId: string | null | undefined;
  expectedCatalogId: string;
}): void {
  const expected = assertCreateGiftCatalogId(input.expectedCatalogId);
  const current = normalizeRequiredGameCatalogId(input.giftCatalogId);
  if (!current) {
    throw new Error(GAME_GIFT_ORPHAN_FORBIDDEN_ERROR);
  }
  if (current !== expected) {
    throw new Error(GAME_GIFT_CATALOG_MISMATCH_ERROR);
  }
}

export function rejectClientCatalogRebind(
  bodyCatalogId: unknown,
  routeCatalogId: string,
): void {
  if (bodyCatalogId === undefined || bodyCatalogId === null) {
    return;
  }
  if (typeof bodyCatalogId !== "string") {
    throw new Error(GAME_GIFT_CATALOG_MISMATCH_ERROR);
  }
  const normalized = normalizeRequiredGameCatalogId(bodyCatalogId);
  if (!normalized || normalized !== routeCatalogId) {
    throw new Error(GAME_GIFT_CATALOG_MISMATCH_ERROR);
  }
}
