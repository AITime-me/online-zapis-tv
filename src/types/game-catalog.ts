export type GameCatalogTypeDto = "catch_time" | "wheel_of_fortune";

export type GameCatalogStatusDto =
  | "draft"
  | "active"
  | "disabled"
  | "archived";

export type GameCatalogSettingsStatusDto = "valid" | "safe-default" | "invalid";

export type GameCatalogServerPolicyDto = "tier-0-only";

export type GameCatalogServerReadinessDto = {
  settingsStatus: GameCatalogSettingsStatusDto;
  serverPolicy: GameCatalogServerPolicyDto;
  premiumDisabledNotice: string;
};

export type GameCatalogDto = {
  id: string;
  slug: string;
  title: string;
  type: GameCatalogTypeDto;
  status: GameCatalogStatusDto;
  description: string | null;
  settings: Record<string, unknown> | null;
  externalUrl: string | null;
  legacyConfigId: string | null;
  publicPath: string;
  publicUrl: string;
  campaignKey: string | null;
  rulesVersion: string;
  isPrimaryPublic: boolean;
  publicPriority: number;
  activeFrom: string | null;
  activeTo: string | null;
  serverReadiness: GameCatalogServerReadinessDto;
  createdAt: string;
  updatedAt: string;
};

export type GameCatalogWriteInput = {
  slug?: string;
  title?: string;
  type?: GameCatalogTypeDto;
  status?: GameCatalogStatusDto;
  description?: string | null;
  settings?: Record<string, unknown> | null;
  externalUrl?: string | null;
};

export const GAME_CATALOG_TYPE_LABELS: Record<GameCatalogTypeDto, string> = {
  catch_time: "Поймай своё время",
  wheel_of_fortune: "Колесо фортуны",
};

export const GAME_CATALOG_STATUS_LABELS: Record<GameCatalogStatusDto, string> = {
  draft: "Черновик",
  active: "Активна",
  disabled: "Выключена",
  archived: "Архив",
};

export const GAME_TYPES_WITHOUT_PUBLIC_RENDERER: GameCatalogTypeDto[] = [
  "wheel_of_fortune",
];

export function isGameTypePubliclyRenderable(type: GameCatalogTypeDto): boolean {
  return !GAME_TYPES_WITHOUT_PUBLIC_RENDERER.includes(type);
}

export function canActivateGameCatalog(
  type: GameCatalogTypeDto,
  status: GameCatalogStatusDto,
): boolean {
  if (status !== "active") {
    return true;
  }
  return isGameTypePubliclyRenderable(type);
}

export function getGameCatalogActivationBlockReason(
  type: GameCatalogTypeDto,
): string | null {
  if (isGameTypePubliclyRenderable(type)) {
    return null;
  }
  return "Эта игровая механика пока не подключена. Активация и публичный показ недоступны.";
}
