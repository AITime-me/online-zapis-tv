import type { CatchTimeServerAssignmentV1 } from "@/lib/game/tier/server-assignment-contract";
import { buildServerAssignment } from "@/lib/game/tier/server-tier-assignment";
import {
  applyPremiumTierGuard,
  buildTierBucket,
} from "@/lib/game/tier/server-tier-policy";

export type { CatchTimeServerAssignmentV1 } from "@/lib/game/tier/server-assignment-contract";
export { buildServerAssignment } from "@/lib/game/tier/server-tier-assignment";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIsoDate(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time);
}

export function parseServerAssignment(raw: unknown): CatchTimeServerAssignmentV1 | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  if (raw.version !== 1) {
    return null;
  }
  if (raw.mechanicType !== "CATCH_TIME") {
    return null;
  }
  if (typeof raw.serverResultTier !== "number" || !Number.isInteger(raw.serverResultTier)) {
    return null;
  }
  if (raw.campaignKey !== null && typeof raw.campaignKey !== "string") {
    return null;
  }
  if (typeof raw.rulesVersion !== "string" || !raw.rulesVersion.trim()) {
    return null;
  }
  if (typeof raw.assignedAt !== "string" || !isValidIsoDate(raw.assignedAt)) {
    return null;
  }
  if (typeof raw.tierBucket !== "string" || !raw.tierBucket.trim()) {
    return null;
  }

  const guardedTier = applyPremiumTierGuard(raw.serverResultTier);

  return {
    version: 1,
    mechanicType: "CATCH_TIME",
    serverResultTier: guardedTier,
    campaignKey: raw.campaignKey,
    rulesVersion: raw.rulesVersion.trim(),
    assignedAt: raw.assignedAt,
    tierBucket: buildTierBucket(guardedTier),
  };
}

export function resolveServerResultTier(rawAssignment: unknown): number {
  const parsed = parseServerAssignment(rawAssignment);
  if (!parsed) {
    return 0;
  }
  return applyPremiumTierGuard(parsed.serverResultTier);
}

export function buildFallbackTierZeroAssignment(input: {
  catalogCampaignKey: string | null;
  catalogRulesVersion: string;
  settingsRaw: unknown;
  now: Date;
}): CatchTimeServerAssignmentV1 {
  return buildServerAssignment({
    mechanicType: "CATCH_TIME",
    catalogCampaignKey: input.catalogCampaignKey,
    catalogRulesVersion: input.catalogRulesVersion,
    settingsRaw: input.settingsRaw,
    now: input.now,
  });
}

export function assignmentToJson(assignment: CatchTimeServerAssignmentV1): CatchTimeServerAssignmentV1 {
  return {
    version: assignment.version,
    mechanicType: assignment.mechanicType,
    serverResultTier: applyPremiumTierGuard(assignment.serverResultTier),
    campaignKey: assignment.campaignKey,
    rulesVersion: assignment.rulesVersion,
    assignedAt: assignment.assignedAt,
    tierBucket: buildTierBucket(applyPremiumTierGuard(assignment.serverResultTier)),
  };
}
