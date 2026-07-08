export { STUDIO_LOGO, type StudioLogoVariant } from "@/components/brand/studio-logo";

/** @deprecated Используйте STUDIO_LOGO из @/components/brand/studio-logo */
export { STUDIO_LOGO as HOME_LOGO } from "@/components/brand/studio-logo";

/** Тип акции на главной: обычная, подарочная, игровая. */
export type HomePromotionKind = "standard" | "gift" | "game";

/** Маршруты акций — заготовки для будущих страниц и игры. */
export const HOME_PROMO_ROUTES = {
  procedureGiftGame: "/promo/procedure-gift",
} as const;

export type HomePromotion = {
  id: string;
  kind: HomePromotionKind;
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  /** Короткая метка на карточке (например «Подарок»). */
  badgeLabel?: string;
  /** URL изображения карточки (если задано — вместо логотипа). */
  imageUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
};

export const HOME_PROMOTION_KIND_LABELS: Record<HomePromotionKind, string> = {
  standard: "Акция",
  gift: "Подарок",
  game: "Подарок к процедуре",
};

export const HOME_PROMOTIONS: readonly HomePromotion[] = [
  {
    id: "cold-plasma-first-visit",
    kind: "standard",
    title: "Первый визит на холодную плазму — со скидкой 30%",
    description:
      "В прайсе указана полная стоимость. Если это Ваш первый визит на холодную плазму, мы применим скидку и подтвердим итоговую цену.",
    ctaLabel: "Записаться онлайн",
    ctaHref: "/booking",
    badgeLabel: "Акция",
    sortOrder: 1,
    isActive: true,
  },
];

export const HOME_FEATURES = [
  {
    title: "Выберите процедуру",
    description: "Найдите направление, которое подходит именно Вам.",
  },
  {
    title: "Выберите специалиста",
    description:
      "Если процедуру выполняют несколько мастеров, выберите подходящего специалиста.",
  },
  {
    title: "Выберите время",
    description: "Посмотрите доступные варианты записи.",
  },
  {
    title: "Оставьте контакты",
    description: "Введите имя и телефон для оформления записи.",
  },
] as const;

export const HOME_DIRECTIONS = [
  {
    title: "Холодная плазма",
    description:
      "Работа с качеством кожи: рельефом, тонусом, плотностью и ухоженным видом.",
  },
  {
    title: "Уходовые процедуры",
    description:
      "Для поддержания красоты, увлажнения и здоровья кожи.",
  },
  {
    title: "Массаж лица",
    description: "Для расслабления, тонуса и ухода за кожей.",
  },
  {
    title: "Массаж тела",
    description: "Для восстановления и телесного комфорта.",
  },
  {
    title: "Брови и ресницы",
    description: "Оформление бровей, ресниц и реконструкция Velvet.",
  },
  {
    title: "Перманентный макияж",
    description: "Для выразительности и удобства в ежедневном уходе.",
  },
  {
    title: "Удаление старого татуажа",
    description: "Для коррекции и обновления прежних результатов.",
  },
] as const;

export const HOME_STEPS = [
  "Выберите процедуру",
  "Выберите специалиста",
  "Выберите время",
  "Оставьте контакты",
] as const;

export const HOME_NAV = [
  { label: "Направления", href: "#directions" },
  { label: "Как записаться", href: "#steps" },
  { label: "Акция", href: "#promo" },
] as const;

export const HOME_FOOTER_LEGAL_LINKS = [
  { label: "Пользовательское соглашение", href: "/offer" },
  { label: "Политика конфиденциальности", href: "/privacy" },
  { label: "Договор публичной оферты", href: "/terms" },
] as const;
