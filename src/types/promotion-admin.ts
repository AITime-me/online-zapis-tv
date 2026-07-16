import type {
  DiscountUnit,
  PromotionSource,
  PromotionStatus,
  PromotionType,
} from "@prisma/client";

export type PromotionTypeDto =
  | "gift"
  | "seasonal"
  | "game"
  | "bundle"
  | "consultation"
  | "custom"
  | "discount";

export type PromotionStatusDto = "draft" | "active" | "archived";

export type PromotionSourceDto =
  | "manual"
  | "game"
  | "vk"
  | "bot"
  | "seasonal";

export type DiscountUnitDto = "percent" | "fixed";

export type PromotionDto = {
  id: string;
  title: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  type: PromotionTypeDto;
  status: PromotionStatusDto;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  giftTitle: string | null;
  giftDescription: string | null;
  discountValue: number | null;
  discountUnit: DiscountUnitDto | null;
  discountDescription: string | null;
  conditions: string | null;
  ctaText: string | null;
  ctaLink: string | null;
  imageUrl: string | null;
  priority: number;
  source: PromotionSourceDto;
  showOnHomepage: boolean;
  serviceIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type PromotionWriteInput = {
  title?: string;
  slug?: string;
  shortDescription?: string | null;
  description?: string | null;
  type?: PromotionTypeDto;
  status?: PromotionStatusDto;
  isActive?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  giftTitle?: string | null;
  giftDescription?: string | null;
  discountValue?: number | null;
  discountUnit?: DiscountUnitDto | null;
  discountDescription?: string | null;
  conditions?: string | null;
  ctaText?: string | null;
  ctaLink?: string | null;
  imageUrl?: string | null;
  priority?: number;
  source?: PromotionSourceDto;
  showOnHomepage?: boolean;
  serviceIds?: string[];
  restoreFromArchive?: boolean;
};

export type PromotionServiceOption = {
  id: string;
  publicName: string;
  isActive: boolean;
  unavailableReason?: string | null;
};

export const PROMOTION_TYPE_LABELS: Record<PromotionTypeDto, string> = {
  gift: "Подарок",
  seasonal: "Сезонная",
  game: "Игра",
  bundle: "Набор / бонус",
  consultation: "Консультация",
  custom: "Спецпредложение",
  discount: "Скидка",
};

export const DISCOUNT_UNIT_LABELS: Record<DiscountUnitDto, string> = {
  percent: "%",
  fixed: "₽",
};

export const PROMOTION_STATUS_LABELS: Record<PromotionStatusDto, string> = {
  draft: "Черновик",
  active: "Активна",
  archived: "Архив",
};

export const PROMOTION_SOURCE_LABELS: Record<PromotionSourceDto, string> = {
  manual: "Вручную",
  game: "Игра",
  vk: "VK",
  bot: "Бот",
  seasonal: "Сезон",
};

const TYPE_TO_DB: Record<PromotionTypeDto, PromotionType> = {
  gift: "GIFT",
  seasonal: "SEASONAL",
  game: "GAME",
  bundle: "BUNDLE",
  consultation: "CONSULTATION",
  custom: "CUSTOM",
  discount: "DISCOUNT",
};

const TYPE_FROM_DB: Record<PromotionType, PromotionTypeDto> = {
  GIFT: "gift",
  SEASONAL: "seasonal",
  GAME: "game",
  BUNDLE: "bundle",
  CONSULTATION: "consultation",
  CUSTOM: "custom",
  DISCOUNT: "discount",
};

const DISCOUNT_UNIT_TO_DB: Record<DiscountUnitDto, DiscountUnit> = {
  percent: "PERCENT",
  fixed: "FIXED",
};

const DISCOUNT_UNIT_FROM_DB: Record<DiscountUnit, DiscountUnitDto> = {
  PERCENT: "percent",
  FIXED: "fixed",
};

const STATUS_TO_DB: Record<PromotionStatusDto, PromotionStatus> = {
  draft: "DRAFT",
  active: "ACTIVE",
  archived: "ARCHIVED",
};

const STATUS_FROM_DB: Record<PromotionStatus, PromotionStatusDto> = {
  DRAFT: "draft",
  ACTIVE: "active",
  ARCHIVED: "archived",
};

const SOURCE_TO_DB: Record<PromotionSourceDto, PromotionSource> = {
  manual: "MANUAL",
  game: "GAME",
  vk: "VK",
  bot: "BOT",
  seasonal: "SEASONAL",
};

const SOURCE_FROM_DB: Record<PromotionSource, PromotionSourceDto> = {
  MANUAL: "manual",
  GAME: "game",
  VK: "vk",
  BOT: "bot",
  SEASONAL: "seasonal",
};

export function promotionTypeToDb(type: PromotionTypeDto): PromotionType {
  return TYPE_TO_DB[type];
}

export function promotionTypeFromDb(type: PromotionType): PromotionTypeDto {
  return TYPE_FROM_DB[type];
}

export function promotionStatusToDb(status: PromotionStatusDto): PromotionStatus {
  return STATUS_TO_DB[status];
}

export function promotionStatusFromDb(
  status: PromotionStatus,
): PromotionStatusDto {
  return STATUS_FROM_DB[status];
}

export function promotionSourceToDb(source: PromotionSourceDto): PromotionSource {
  return SOURCE_TO_DB[source];
}

export function promotionSourceFromDb(
  source: PromotionSource,
): PromotionSourceDto {
  return SOURCE_FROM_DB[source];
}

export function discountUnitToDb(unit: DiscountUnitDto): DiscountUnit {
  return DISCOUNT_UNIT_TO_DB[unit];
}

export function discountUnitFromDb(unit: DiscountUnit): DiscountUnitDto {
  return DISCOUNT_UNIT_FROM_DB[unit];
}

export function formatPromotionOffer(
  promotion: Pick<
    PromotionDto,
    | "type"
    | "giftTitle"
    | "discountValue"
    | "discountUnit"
    | "discountDescription"
    | "conditions"
    | "shortDescription"
  >,
): string {
  if (promotion.type === "discount") {
    if (promotion.discountValue != null && promotion.discountUnit) {
      if (promotion.discountUnit === "percent") {
        const value = Number.isInteger(promotion.discountValue)
          ? promotion.discountValue
          : promotion.discountValue;
        return `−${value}%`;
      }
      return `−${promotion.discountValue} ₽`;
    }
    if (promotion.discountDescription?.trim()) {
      return promotion.discountDescription.trim();
    }
    if (promotion.shortDescription?.trim()) {
      return promotion.shortDescription.trim();
    }
    if (promotion.conditions?.trim()) {
      return promotion.conditions.trim();
    }
    return "—";
  }

  return promotion.giftTitle?.trim() || "—";
}

export function slugifyPromotionTitle(title: string): string {
  const map: Record<string, string> = {
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

  const transliterated = title
    .trim()
    .toLowerCase()
    .split("")
    .map((char) => map[char] ?? char)
    .join("");

  const slug = transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "promo";
}
