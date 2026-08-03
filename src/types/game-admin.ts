export type GameConfigDto = {
  id: string;
  isActive: boolean;
  title: string;
  description: string;
  image: string | null;
  resultHeaderText: string;
  directionLabelText: string;
  giftLabelText: string;
  ctaButtonText: string;
  ctaButtonLink: string;
  managerMessageHeader: string;
  managerMessageFooter: string;
  updatedAt: string;
};

export type GameConfigWriteInput = Partial<
  Omit<GameConfigDto, "id" | "updatedAt">
>;

export type GameGiftDto = {
  id: string;
  name: string;
  shortDescription: string;
  image: string | null;
  isActive: boolean;
  probability: number;
  priority: string;
  cardStyle: string;
  allowedGameDirections: string[];
  allowedResultTypes: string[];
  requiredPremiumLevel: number;
  activationMode: "SINGLE_PAID_SERVICE" | "COURSE_MIN_SESSIONS";
  minCourseSessions: number | null;
  activationConditionText: string;
  systemKey: string | null;
  prizeType: "PERCENT_DISCOUNT" | "GIFT_SERVICE" | "SERVICE_UPGRADE" | null;
  prizeRules: Record<string, unknown> | null;
  sortOrder: number;
  gameCatalogId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GameGiftWriteInput = Partial<
  Omit<GameGiftDto, "id" | "createdAt" | "updatedAt" | "gameCatalogId">
> & {
  name: string;
  shortDescription: string;
};

export type WheelCatalogConfigDto = {
  expectedSectorCount: number;
  confirmWindowDays: number;
  procedureWindowDays: number;
  activeSectorSum: number;
  sectorConfigOk: boolean;
  sectorConfigError: string | null;
};
