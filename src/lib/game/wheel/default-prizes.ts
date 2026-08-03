import type { PrizeRulesV1 } from "@/lib/game/wheel/prize-rules-contract";
import { prizeRulesToJson } from "@/lib/game/wheel/prize-rules-contract";
import type { GamePrizeType } from "@/lib/game/wheel/prize-types";

export const WHEEL_DEFAULT_SECTOR_COUNT = 16;
export const WHEEL_DEFAULT_CONFIRM_WINDOW_DAYS = 7;
export const WHEEL_DEFAULT_PROCEDURE_WINDOW_DAYS = 30;
export const WHEEL_DEFAULT_CAMPAIGN_KEY = "permanent-wheel";
export const WHEEL_DEFAULT_SLUG = "permanent-wheel";
export const WHEEL_DEFAULT_TITLE = "Колесо фортуны";

export const WHEEL_PRIZE_SYSTEM_KEYS = {
  discount10: "permanent_discount_10",
  handCare: "hand_care_gift",
  discount20: "permanent_discount_20",
  formulaShine: "formula_shine_gift",
  coldPlasmaLips: "cold_plasma_lips_gift",
  laserBiorevitalization: "laser_biorevitalization_gift",
  footMassage: "foot_massage_gift",
  lipsBiorevitalizant: "lips_biorevitalizant_upgrade",
} as const;

export type WheelPrizeSystemKey =
  (typeof WHEEL_PRIZE_SYSTEM_KEYS)[keyof typeof WHEEL_PRIZE_SYSTEM_KEYS];

export type DefaultWheelPrizeDefinition = {
  systemKey: WheelPrizeSystemKey;
  prizeType: GamePrizeType;
  name: string;
  shortDescription: string;
  /** Visual sector count / weight. */
  sectorCount: number;
  sortOrder: number;
  isActive: boolean;
  activationConditionText: string;
  prizeRules: PrizeRulesV1;
};

const COMMON_GIFT_EXCLUSIONS = [
  "correction",
  "removal",
  "lips_correction",
] as const;

function baseGiftRules(
  systemKey: WheelPrizeSystemKey,
  termsText: string,
): PrizeRulesV1 {
  return {
    version: 1,
    prizeType: "GIFT_SERVICE",
    systemKey,
    discountPercent: null,
    applicableProcedures: [
      "permanent_primary",
      "cover",
      "refresh",
      "lips_permanent_primary",
      "lips_cover",
      "lips_refresh",
    ],
    excludedProcedures: [...COMMON_GIFT_EXCLUSIONS],
    upgradeSurcharge: null,
    stackingWithOtherDiscounts: false,
    stackingWithOtherGifts: false,
    cashRedemptionForbidden: true,
    zoneRestriction: null,
    replacement: null,
    termsText,
    confirmWindowDays: null,
    procedureWindowDays: null,
  };
}

const DISCOUNT_10_TERMS =
  "Скидка 10% действует на первичный перманент, перекрытие чужой работы и рефреш. Не действует на коррекцию и удаление. Не суммируется с другими акциями и скидками.";

const DISCOUNT_20_TERMS =
  "Скидка 20% действует на первичный перманент и перекрытие чужой работы. Не действует на рефреш, коррекцию и удаление. Не суммируется с другими акциями и скидками.";

const GIFT_SERVICE_TERMS =
  "Подарочная процедура предоставляется при прохождении оплачиваемой участвующей процедуры перманентного макияжа, перекрытия или рефреша. Не действует при одной только коррекции. Не выдаётся деньгами. Возможность и время проведения определяются студией с учётом совместимости процедур.";

const BIOREVITALIZANT_TERMS =
  "Биоревитализант — улучшение услуги перманента губ (первичный, перекрытие или рефреш губ), не скидка. Доплата за биоревитализант равна 0 ₽; клиент оплачивает базовую стоимость процедуры губ. Не применяется к коррекции. Если после выигрыша выбран интерес не к губам, приз может быть заменён на «Уход для рук в подарок» только после подтверждённого выбора клиента.";

export const DEFAULT_WHEEL_PRIZE_DEFINITIONS: readonly DefaultWheelPrizeDefinition[] =
  [
    {
      systemKey: WHEEL_PRIZE_SYSTEM_KEYS.discount10,
      prizeType: "PERCENT_DISCOUNT",
      name: "Скидка 10% на перманент",
      shortDescription: "Скидка 10% на участвующие процедуры перманентного макияжа",
      sectorCount: 5,
      sortOrder: 10,
      isActive: true,
      activationConditionText: DISCOUNT_10_TERMS,
      prizeRules: {
        version: 1,
        prizeType: "PERCENT_DISCOUNT",
        systemKey: WHEEL_PRIZE_SYSTEM_KEYS.discount10,
        discountPercent: 10,
        applicableProcedures: [
          "permanent_primary",
          "cover",
          "refresh",
          "lips_permanent_primary",
          "lips_cover",
          "lips_refresh",
        ],
        excludedProcedures: [...COMMON_GIFT_EXCLUSIONS],
        upgradeSurcharge: null,
        stackingWithOtherDiscounts: false,
        stackingWithOtherGifts: false,
        cashRedemptionForbidden: true,
        zoneRestriction: null,
        replacement: null,
        termsText: DISCOUNT_10_TERMS,
        confirmWindowDays: null,
        procedureWindowDays: null,
      },
    },
    {
      systemKey: WHEEL_PRIZE_SYSTEM_KEYS.handCare,
      prizeType: "GIFT_SERVICE",
      name: "Уход для рук в подарок",
      shortDescription: "Уход для рук при прохождении участвующей процедуры",
      sectorCount: 5,
      sortOrder: 20,
      isActive: true,
      activationConditionText: GIFT_SERVICE_TERMS,
      prizeRules: {
        ...baseGiftRules(WHEEL_PRIZE_SYSTEM_KEYS.handCare, GIFT_SERVICE_TERMS),
      },
    },
    {
      systemKey: WHEEL_PRIZE_SYSTEM_KEYS.discount20,
      prizeType: "PERCENT_DISCOUNT",
      name: "Скидка 20% на перманент",
      shortDescription: "Редкий главный приз — скидка 20% на перманент",
      sectorCount: 1,
      sortOrder: 30,
      isActive: true,
      activationConditionText: DISCOUNT_20_TERMS,
      prizeRules: {
        version: 1,
        prizeType: "PERCENT_DISCOUNT",
        systemKey: WHEEL_PRIZE_SYSTEM_KEYS.discount20,
        discountPercent: 20,
        applicableProcedures: [
          "permanent_primary",
          "cover",
          "lips_permanent_primary",
          "lips_cover",
        ],
        excludedProcedures: [
          "refresh",
          "lips_refresh",
          "correction",
          "removal",
          "lips_correction",
        ],
        upgradeSurcharge: null,
        stackingWithOtherDiscounts: false,
        stackingWithOtherGifts: false,
        cashRedemptionForbidden: true,
        zoneRestriction: null,
        replacement: null,
        termsText: DISCOUNT_20_TERMS,
        confirmWindowDays: null,
        procedureWindowDays: null,
      },
    },
    {
      systemKey: WHEEL_PRIZE_SYSTEM_KEYS.formulaShine,
      prizeType: "GIFT_SERVICE",
      name: "«Формула сияния» в подарок",
      shortDescription: "Подарочная процедура «Формула сияния»",
      sectorCount: 1,
      sortOrder: 40,
      isActive: true,
      activationConditionText: GIFT_SERVICE_TERMS,
      prizeRules: {
        ...baseGiftRules(
          WHEEL_PRIZE_SYSTEM_KEYS.formulaShine,
          GIFT_SERVICE_TERMS,
        ),
      },
    },
    {
      systemKey: WHEEL_PRIZE_SYSTEM_KEYS.coldPlasmaLips,
      prizeType: "GIFT_SERVICE",
      name: "Холодная плазма губ в подарок",
      shortDescription: "Холодная плазма губ при участвующей процедуре",
      sectorCount: 1,
      sortOrder: 50,
      isActive: true,
      activationConditionText: GIFT_SERVICE_TERMS,
      prizeRules: {
        ...baseGiftRules(
          WHEEL_PRIZE_SYSTEM_KEYS.coldPlasmaLips,
          GIFT_SERVICE_TERMS,
        ),
      },
    },
    {
      systemKey: WHEEL_PRIZE_SYSTEM_KEYS.laserBiorevitalization,
      prizeType: "GIFT_SERVICE",
      name: "Лазерная биоревитализация в подарок",
      shortDescription: "Лазерная биоревитализация при участвующей процедуре",
      sectorCount: 1,
      sortOrder: 60,
      isActive: true,
      activationConditionText: GIFT_SERVICE_TERMS,
      prizeRules: {
        ...baseGiftRules(
          WHEEL_PRIZE_SYSTEM_KEYS.laserBiorevitalization,
          GIFT_SERVICE_TERMS,
        ),
      },
    },
    {
      systemKey: WHEEL_PRIZE_SYSTEM_KEYS.footMassage,
      prizeType: "GIFT_SERVICE",
      name: "Массаж ног в подарок",
      shortDescription: "Массаж ног при участвующей процедуре",
      sectorCount: 1,
      sortOrder: 70,
      isActive: true,
      activationConditionText: GIFT_SERVICE_TERMS,
      prizeRules: {
        ...baseGiftRules(WHEEL_PRIZE_SYSTEM_KEYS.footMassage, GIFT_SERVICE_TERMS),
      },
    },
    {
      systemKey: WHEEL_PRIZE_SYSTEM_KEYS.lipsBiorevitalizant,
      prizeType: "SERVICE_UPGRADE",
      name: "Биоревитализант к перманенту губ в подарок",
      shortDescription:
        "Улучшение услуги перманента губ: биоревитализант без доплаты",
      sectorCount: 1,
      sortOrder: 80,
      isActive: true,
      activationConditionText: BIOREVITALIZANT_TERMS,
      prizeRules: {
        version: 1,
        prizeType: "SERVICE_UPGRADE",
        systemKey: WHEEL_PRIZE_SYSTEM_KEYS.lipsBiorevitalizant,
        discountPercent: null,
        applicableProcedures: [
          "lips_permanent_primary",
          "lips_cover",
          "lips_refresh",
        ],
        excludedProcedures: [
          "correction",
          "removal",
          "lips_correction",
          "permanent_primary",
          "cover",
          "refresh",
        ],
        upgradeSurcharge: 0,
        stackingWithOtherDiscounts: false,
        stackingWithOtherGifts: false,
        cashRedemptionForbidden: true,
        zoneRestriction: "lips",
        replacement: {
          enabled: true,
          fallbackSystemKey: WHEEL_PRIZE_SYSTEM_KEYS.handCare,
          requiresConfirmedInterest: true,
          trigger: "interest_not_lips",
        },
        termsText: BIOREVITALIZANT_TERMS,
        confirmWindowDays: null,
        procedureWindowDays: null,
      },
    },
  ];

export function sumDefaultWheelSectors(): number {
  return DEFAULT_WHEEL_PRIZE_DEFINITIONS.reduce(
    (sum, prize) => sum + (prize.isActive ? prize.sectorCount : 0),
    0,
  );
}

export function buildDefaultWheelCatalogSettings(): Record<string, unknown> {
  return {
    version: 1,
    campaign: {
      key: WHEEL_DEFAULT_CAMPAIGN_KEY,
      rulesVersion: "1",
    },
    wheel: {
      version: 1,
      expectedSectorCount: WHEEL_DEFAULT_SECTOR_COUNT,
      confirmWindowDays: WHEEL_DEFAULT_CONFIRM_WINDOW_DAYS,
      procedureWindowDays: WHEEL_DEFAULT_PROCEDURE_WINDOW_DAYS,
    },
  };
}

export function serializeDefaultPrizeRules(
  definition: DefaultWheelPrizeDefinition,
): PrizeRulesV1 {
  return prizeRulesToJson(definition.prizeRules);
}
