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
  createdAt: string;
  updatedAt: string;
};

export type GameGiftWriteInput = Partial<
  Omit<GameGiftDto, "id" | "createdAt" | "updatedAt">
> & {
  name: string;
  shortDescription: string;
};

