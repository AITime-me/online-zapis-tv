import {
  parseGameCatalogSettings,
  resolveCampaignKey,
  resolveRulesVersion,
} from "@/lib/game/tier/game-catalog-settings";
import {
  assignWheelSector,
  type WheelSectorGift,
} from "@/lib/game/wheel/sector-assignment";
import type { WheelServerAssignmentV1 } from "@/lib/game/wheel/wheel-assignment-contract";

export type WheelServerAssignmentBaseV1 = Omit<
  WheelServerAssignmentV1,
  "prizeSnapshot"
>;
import {
  defaultWheelSettings,
  resolveWheelSettingsFromCatalogSettings,
} from "@/lib/game/wheel/wheel-settings";

export type BuildWheelServerAssignmentInput = {
  catalogCampaignKey: string | null;
  catalogRulesVersion: string;
  settingsRaw: unknown;
  gifts: WheelSectorGift[];
  now: Date;
  randomInt?: (maxExclusive: number) => number;
};

export function buildWheelServerAssignment(
  input: BuildWheelServerAssignmentInput,
): WheelServerAssignmentBaseV1 | null {
  const parsed = parseGameCatalogSettings(input.settingsRaw);
  const settings = parsed.settings;
  const campaignKey = resolveCampaignKey(input.catalogCampaignKey, settings);
  const rulesVersion = resolveRulesVersion(input.catalogRulesVersion, settings);
  const wheelParsed = resolveWheelSettingsFromCatalogSettings(input.settingsRaw);
  const wheel =
    wheelParsed.status === "invalid"
      ? null
      : (wheelParsed.settings ?? defaultWheelSettings());
  if (!wheel) {
    return null;
  }

  const assigned = assignWheelSector(input.gifts, {
    expectedSectorCount: wheel.expectedSectorCount,
    randomInt: input.randomInt,
  });
  if (!assigned) {
    return null;
  }

  return {
    version: 1,
    mechanicType: "WHEEL_OF_FORTUNE",
    serverResultTier: 0,
    campaignKey,
    rulesVersion,
    assignedAt: input.now.toISOString(),
    tierBucket: "tier-0",
    sectorIndex: assigned.sectorIndex,
    totalSectors: assigned.totalSectors,
    prizeSystemKey: assigned.systemKey,
    giftId: assigned.giftId,
  };
}

export function wheelAssignmentToJson(
  assignment: WheelServerAssignmentV1,
): WheelServerAssignmentV1 {
  return {
    version: 1,
    mechanicType: "WHEEL_OF_FORTUNE",
    serverResultTier: 0,
    campaignKey: assignment.campaignKey,
    rulesVersion: assignment.rulesVersion,
    assignedAt: assignment.assignedAt,
    tierBucket: "tier-0",
    sectorIndex: assignment.sectorIndex,
    totalSectors: assignment.totalSectors,
    prizeSystemKey: assignment.prizeSystemKey,
    giftId: assignment.giftId,
    prizeSnapshot: assignment.prizeSnapshot,
    ...(assignment.claimLock ? { claimLock: assignment.claimLock } : {}),
  };
}
